/* oxlint-disable effecttsgo/unstable-api-usage -- Effect 4 platform HTTP/process APIs are deliberately pinned to 4.0.0-rc.118. */
/** Scoped sandbox resources and native operations. */
import { STATUS_CODES } from "node:http"
import { createServer, type Server } from "node:net"
import os from "node:os"
import path from "node:path"
import * as Clock from "effect/Clock"
import * as Config from "effect/Config"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as FileSystem from "effect/FileSystem"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as PlatformError from "effect/PlatformError"
import * as Ref from "effect/Ref"
import * as Schedule from "effect/Schedule"
import * as Schema from "effect/Schema"
import * as Scope from "effect/Scope"
import * as Semaphore from "effect/Semaphore"
import * as Stream from "effect/Stream"
import { HttpClient, HttpClientRequest } from "effect/http"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import * as tar from "tar"
import { getPlatformId } from "../sandbox/platform.js"
import type {
  SandboxOptions,
  StateRecord,
  StateSnapshot,
} from "../sandbox/types.js"
import { ExternalError, fromPromise } from "./runtime.js"

const DEFAULT_VERSION = "2.13.4"
const BINARY_NAME = "near-sandbox"
const ARCHIVE_NAME = "near-sandbox.tar.gz"
const DOWNLOAD_BASE =
  "https://s3-us-west-1.amazonaws.com/build.nearprotocol.com/nearcore"
const STARTUP_TIMEOUT = 60_000
const DOWNLOAD_TIMEOUT = 120_000

const sandboxError =
  (operation: string) =>
  (cause: unknown): ExternalError =>
    cause instanceof ExternalError
      ? cause
      : new ExternalError({
          operation,
          cause: PlatformError.isPlatformError(cause)
            ? (cause.reason.cause ?? cause)
            : cause,
        })
const failure = (operation: string, message: string) =>
  Effect.fail(sandboxError(operation)(new Error(message)))

const ValidatorKey = Schema.Struct({
  account_id: Schema.String,
  public_key: Schema.String,
  secret_key: Schema.optionalKey(Schema.String),
  private_key: Schema.optionalKey(Schema.String),
})
const Status = Schema.Struct({
  result: Schema.optionalKey(
    Schema.Struct({
      sync_info: Schema.optionalKey(
        Schema.Struct({
          latest_block_height: Schema.optionalKey(Schema.Finite),
        }),
      ),
    }),
  ),
})
const RpcResult = Schema.Struct({
  error: Schema.optionalKey(Schema.Struct({ message: Schema.String })),
})
// Keep additional nearcore fields and future record variants intact in snapshots.
const extensible = <const Fields extends Schema.Struct.Fields>(
  fields: Fields,
) =>
  Schema.StructWithRest(Schema.Struct(fields), [
    Schema.Record(Schema.String, Schema.Unknown),
  ])
const account = extensible({
  amount: Schema.String,
  locked: Schema.String,
  code_hash: Schema.String,
  storage_usage: Schema.Finite,
  version: Schema.optionalKey(Schema.String),
})

const RecordSchema = extensible({
  Account: Schema.optionalKey(
    extensible({ account_id: Schema.String, account }),
  ),
  AccessKey: Schema.optionalKey(
    extensible({
      account_id: Schema.String,
      public_key: Schema.String,
      access_key: extensible({
        nonce: Schema.Finite,
        // Snapshots archive nearcore data, including gas-key permissions and future
        // fields. Validate the JSON envelope without deleting
        // fields or imposing a stale SDK permission model on the archive.
        permission: Schema.Union([
          Schema.Literal("FullAccess"),
          extensible({
            FunctionCall: extensible({
              allowance: Schema.optional(Schema.NullOr(Schema.String)),
              receiver_id: Schema.String,
              method_names: Schema.mutable(Schema.Array(Schema.String)),
            }),
          }),
          extensible({
            GasKeyFullAccess: extensible({
              balance: Schema.String,
              num_nonces: Schema.Finite,
            }),
          }),
          extensible({
            GasKeyFunctionCall: extensible({
              balance: Schema.String,
              num_nonces: Schema.Finite,
              allowance: Schema.optional(Schema.NullOr(Schema.String)),
              receiver_id: Schema.String,
              method_names: Schema.mutable(Schema.Array(Schema.String)),
            }),
          }),
        ]),
      }),
    }),
  ),
  Contract: Schema.optionalKey(
    extensible({ account_id: Schema.String, code: Schema.String }),
  ),
  Data: Schema.optionalKey(
    extensible({
      account_id: Schema.String,
      data_key: Schema.String,
      value: Schema.String,
    }),
  ),
})
const Genesis = extensible({
  records: Schema.optionalKey(Schema.mutable(Schema.Array(RecordSchema))),
  total_supply: Schema.optionalKey(Schema.String),
})

export interface SandboxService {
  readonly rpcUrl: string
  readonly networkId: string
  readonly rootAccount: { id: string; secretKey: string }
  readonly patchState: (
    records: StateRecord[],
  ) => Effect.Effect<void, ExternalError>
  readonly fastForward: (
    numBlocks: number,
  ) => Effect.Effect<void, ExternalError>
  // oxlint-disable-next-line effecttsgo/lazy-effect -- Kit service operations remain named Effect.fn functions, including zero-argument methods.
  readonly dumpState: () => Effect.Effect<StateSnapshot, ExternalError>
  readonly restoreState: (
    snapshot: StateSnapshot,
  ) => Effect.Effect<void, ExternalError>
  // oxlint-disable-next-line effecttsgo/lazy-effect -- Kit service operations remain named Effect.fn functions, including zero-argument methods.
  readonly saveSnapshot: () => Effect.Effect<string, ExternalError>
  readonly loadSnapshot: (
    snapshotPath: string,
  ) => Effect.Effect<StateSnapshot, ExternalError>
  readonly restart: (
    snapshot?: StateSnapshot,
  ) => Effect.Effect<void, ExternalError>
}

/** A running sandbox is acquired by its layer and stopped when that scope closes. */
// oxlint-disable-next-line effecttsgo/lazy-effect -- Kit service operations remain named Effect.fn functions, including zero-argument methods.
export class Sandbox extends Context.Service<Sandbox, SandboxService>()(
  "near-kit/Sandbox",
) {
  static layer = (options: SandboxOptions = {}) =>
    Layer.effect(Sandbox, makeSandbox(options))
}

const closeServer = (server: Server) =>
  Effect.callback<void>((resume) => {
    server.close(() => resume(Effect.void))
  })

/** Reserve both sockets together so the OS cannot give the same port twice. */
const availablePorts = Effect.fn("Sandbox.availablePorts")(function* () {
  const acquirePort = Effect.gen(function* () {
    const server = yield* Effect.acquireRelease(
      Effect.sync(() => createServer()),
      closeServer,
    )
    return yield* Effect.callback<number, ExternalError>((resume) => {
      const onError = (cause: Error) =>
        resume(Effect.fail(sandboxError("Sandbox.port")(cause)))
      server.once("error", onError)
      server.listen(0, "127.0.0.1", () => {
        const address = server.address()
        resume(
          address && typeof address !== "string"
            ? Effect.succeed(address.port)
            : failure("Sandbox.port", "Failed to get port"),
        )
      })
      return Effect.sync(() => {
        server.removeListener("error", onError)
      })
    })
  })
  const rpc = yield* acquirePort
  const network = yield* acquirePort
  return { rpc, network }
}, Effect.scoped)

const decodeJson = <S extends Schema.Constraint>(schema: S, value: string) =>
  Schema.decodeEffect(Schema.fromJsonString(schema))(value)

const ensureBinary = Effect.fn("Sandbox.ensureBinary")(
  function* (options: SandboxOptions) {
    const fs = yield* FileSystem.FileSystem
    const client = HttpClient.withScope(yield* HttpClient.HttpClient)
    const envPath = yield* Config.String("NEAR_SANDBOX_BIN_PATH").pipe(
      Config.withDefault(""),
    )
    const explicit = options.binaryPath || envPath
    if (explicit) {
      if (!(yield* fs.exists(explicit)))
        return yield* failure(
          "Sandbox.binary",
          `${options.binaryPath ? "Sandbox" : "NEAR_SANDBOX_BIN_PATH"} binary not found: ${explicit}`,
        )
      return explicit
    }
    const version = options.version ?? DEFAULT_VERSION
    const { system, arch } = yield* Effect.try({
      try: () => getPlatformId(),
      catch: sandboxError("Sandbox.platform"),
    })
    const dest = path.join(
      os.homedir(),
      ".near-kit",
      "sandbox",
      "bin",
      `${BINARY_NAME}-${version}`,
    )
    if (yield* fs.exists(dest)) return dest
    const url = `${DOWNLOAD_BASE}/${system}-${arch}/${version}/${ARCHIVE_NAME}`
    return yield* Effect.gen(function* () {
      const temporary = yield* fs.makeTempDirectoryScoped({
        prefix: "near-sandbox-download-",
      })
      const archive = path.join(temporary, ARCHIVE_NAME)
      yield* Effect.gen(function* () {
        const response = yield* client.get(url)
        if (response.status < 200 || response.status >= 300)
          return yield* failure(
            "Sandbox.download",
            `Download failed: ${response.status} ${STATUS_CODES[response.status] ?? ""}`,
          )
        yield* Stream.run(response.stream, fs.sink(archive))
      }).pipe(Effect.scoped, Effect.timeout(DOWNLOAD_TIMEOUT))
      // tar is the archive FFI boundary; keep extraction and cleanup ordered even
      // when the caller is interrupted, since tar cannot accept an AbortSignal.
      yield* fromPromise(
        () => tar.x({ file: archive, cwd: temporary, strip: 1 }),
        "Sandbox.extract",
      ).pipe(Effect.uninterruptible)
      const extracted = path.join(temporary, BINARY_NAME)
      if (!(yield* fs.exists(extracted)))
        return yield* failure(
          "Sandbox.download",
          `Binary ${BINARY_NAME} not found in archive`,
        )
      yield* fs.makeDirectory(path.dirname(dest), { recursive: true })
      // Publish only the executable file, never a partial download or chmod race.
      yield* fs.chmod(extracted, 0o755)
      yield* fs.rename(extracted, dest)
      return dest
    }).pipe(
      Effect.scoped,
      Effect.mapError((cause) =>
        sandboxError("Sandbox.download")(
          new Error(
            `Failed to download binary from ${url}: ${String(cause instanceof ExternalError ? cause.cause : cause)}`,
          ),
        ),
      ),
    )
  },
  Effect.mapError(sandboxError("Sandbox.binary")),
)

const commandFailure = (
  operation: "init" | "command",
  code: number,
  stderr: string,
) => {
  let message = `Sandbox ${operation} failed with code ${code}: ${stderr}`
  if (operation === "init" && stderr.includes("file descriptor limit")) {
    message +=
      "\n\nThe sandbox requires at least 65,535 file descriptors.\nCurrent limit can be checked with: ulimit -n\n\nTo fix on Linux, add to /etc/security/limits.conf:\n  * soft nofile 65535\n  * hard nofile 65535\n\nTo fix on macOS:\n  sudo launchctl limit maxfiles 65536 200000\n\nFor Docker, add: --ulimit nofile=65535:65535\n\nSee: https://github.com/r-near/near-kit/blob/main/src/sandbox/README.md"
  }
  return failure(`Sandbox.${operation}`, message)
}

const runCommand = Effect.fn("Sandbox.command")(
  function* (
    spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
    binary: string,
    home: string,
    args: string[],
    operation: "init" | "command" = "command",
  ) {
    const child = yield* spawner.spawn(
      ChildProcess.make(binary, ["--home", home, ...args], {
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        forceKillAfter: "2 seconds",
      }),
    )
    const result = yield* Effect.all(
      {
        code: child.exitCode,
        stderr: Stream.mkString(Stream.decodeText(child.stderr)),
        stdout: Stream.runDrain(child.stdout),
      },
      { concurrency: "unbounded" },
    )
    if (result.code !== 0)
      return yield* commandFailure(operation, result.code, result.stderr)
  },
  Effect.scoped,
  Effect.mapError(sandboxError("Sandbox.command")),
)

/** The only sandbox implementation; public Promises are evaluated at the edge. */
export const makeSandbox = Effect.fn("Sandbox.make")(
  function* (options: SandboxOptions) {
    const owner = yield* Scope.Scope
    const lifetime = yield* Scope.fork(owner, "sequential")
    return yield* Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const client = HttpClient.withScope(yield* HttpClient.HttpClient)
      const binary = yield* ensureBinary(options)
      const home = yield* fs.makeTempDirectoryScoped({
        prefix: "near-sandbox-",
      })
      const genesisPath = path.join(home, "genesis.json")
      const originalGenesis = path.join(home, "genesis.original.json")
      yield* runCommand(
        spawner,
        binary,
        home,
        ["init", "--chain-id", "localnet"],
        "init",
      )
      yield* fs.copyFile(genesisPath, originalGenesis)
      const keyPath = path.join(home, "validator_key.json")
      const validator = yield* fs.readFileString(keyPath).pipe(
        Effect.flatMap((value) => decodeJson(ValidatorKey, value)),
        Effect.mapError((cause) =>
          sandboxError("Sandbox.validator")(
            new Error(
              `Failed to read validator key from ${keyPath}: ${String(cause)}`,
            ),
          ),
        ),
      )
      const ports = yield* availablePorts()
      const rpcUrl = `http://127.0.0.1:${ports.rpc}`
      const running = yield* Ref.make<Scope.Closeable | undefined>(undefined)
      const closed = yield* Ref.make(false)
      const lock = yield* Semaphore.make(1)

      const request = Effect.fn("Sandbox.request")(
        function* (
          id: string,
          method: string,
          params: unknown,
          errorPrefix: string,
        ) {
          const req = yield* HttpClientRequest.bodyJson(
            HttpClientRequest.post(rpcUrl),
            { jsonrpc: "2.0", id, method, params },
          )
          const response = yield* client.execute(req)
          if (response.status < 200 || response.status >= 300)
            return yield* failure(
              "Sandbox.rpc",
              `${errorPrefix}: ${response.status}${method === "status" ? "" : ` ${STATUS_CODES[response.status] ?? ""}`}`,
            )
          return yield* response.json
        },
        Effect.scoped,
        Effect.mapError(sandboxError("Sandbox.rpc")),
      )

      const blockHeight = Effect.fn("Sandbox.blockHeight")(
        function* () {
          const data = yield* request(
            "status",
            "status",
            [],
            "Failed to get status",
          )
          const result = yield* Schema.decodeUnknownEffect(Status)(data)
          return result.result?.sync_info?.latest_block_height ?? 0
        },
        Effect.mapError(sandboxError("Sandbox.status")),
      )

      const nextBlock = Effect.fn("Sandbox.nextBlock")(function* () {
        const height = yield* blockHeight()
        yield* blockHeight().pipe(
          Effect.repeat({
            schedule: Schedule.spaced("100 millis"),
            until: (next) => next > height,
          }),
          Effect.timeoutOrElse({
            duration: "10 seconds",
            orElse: () =>
              failure(
                "Sandbox.nextBlock",
                `Timed out waiting for next block after 10000ms (stuck at height ${height})`,
              ),
          }),
        )
      })

      const startProcess = Effect.fn("Sandbox.startProcess")(
        function* (networkPort: number) {
          const processScope = yield* Scope.fork(lifetime, "sequential")
          yield* Effect.gen(function* () {
            const child = yield* spawner.spawn(
              ChildProcess.make(
                binary,
                [
                  "--home",
                  home,
                  "run",
                  "--rpc-addr",
                  `0.0.0.0:${ports.rpc}`,
                  "--network-addr",
                  `0.0.0.0:${networkPort}`,
                ],
                {
                  detached: options.detached ?? true,
                  stdin: "ignore",
                  stdout: "ignore",
                  stderr: options.detached === false ? "pipe" : "ignore",
                  forceKillAfter: "2 seconds",
                },
              ),
            )
            if (options.detached !== false) {
              const reref = yield* child.unref
              // Node's unref intentionally relinquishes cleanup. Re-reference first
              // during finalization so the process scope still owns termination.
              yield* Effect.addFinalizer(() => reref.pipe(Effect.ignore))
            }
            const stderr = yield* Ref.make("")
            yield* Stream.runForEach(Stream.decodeText(child.stderr), (chunk) =>
              Ref.update(stderr, (previous) => (previous + chunk).slice(-2000)),
            ).pipe(Effect.forkScoped)
            const ready = Effect.gen(function* () {
              const req = yield* HttpClientRequest.bodyJson(
                HttpClientRequest.post(rpcUrl),
                { jsonrpc: "2.0", id: "status", method: "status", params: [] },
              )
              const response = yield* client.execute(req)
              return response.status >= 200 && response.status < 300
            }).pipe(
              Effect.scoped,
              Effect.timeout("1 second"),
              Effect.orElseSucceed(() => false),
              Effect.repeat({
                schedule: Schedule.spaced("500 millis"),
                until: (ready) => ready,
              }),
              Effect.timeoutOrElse({
                duration: STARTUP_TIMEOUT,
                orElse: () =>
                  failure(
                    "Sandbox.start",
                    `Sandbox failed to start within ${STARTUP_TIMEOUT}ms`,
                  ),
              }),
            )
            const exited = child.exitCode.pipe(
              Effect.flatMap((code) =>
                failure(
                  "Sandbox.start",
                  `Sandbox exited before RPC was ready with code ${code}`,
                ),
              ),
            )
            yield* Effect.raceFirst(ready, exited).pipe(
              Effect.mapError((cause) => sandboxError("Sandbox.start")(cause)),
              Effect.catch((error) =>
                Effect.gen(function* () {
                  const output = yield* Ref.get(stderr)
                  return yield* output
                    ? failure(
                        "Sandbox.start",
                        `${String(error.cause instanceof Error ? error.cause.message : error.cause)}\nSandbox stderr:\n${output}`,
                      )
                    : Effect.fail(error)
                }),
              ),
            )
            yield* Ref.set(running, processScope)
          }).pipe(
            Scope.provide(processScope),
            Effect.onExit((exit) =>
              Exit.isFailure(exit)
                ? Scope.close(processScope, exit)
                : Effect.void,
            ),
          )
        },
        Effect.mapError(sandboxError("Sandbox.start")),
      )

      yield* startProcess(ports.network)
      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          yield* Ref.set(closed, true)
          yield* Ref.set(running, undefined)
        }),
      )

      const patchState = Effect.fn("Sandbox.patchState")(
        function* (records: StateRecord[]) {
          const data = yield* request(
            "patch-state",
            "sandbox_patch_state",
            { records },
            "Failed to patch state",
          )
          const response = yield* Schema.decodeUnknownEffect(RpcResult)(data)
          if (response.error)
            return yield* failure(
              "Sandbox.patchState",
              `Failed to patch state: ${response.error.message}`,
            )
          yield* nextBlock()
        },
        Effect.mapError(sandboxError("Sandbox.patchState")),
      )

      const snapshotAt = Effect.fn("Sandbox.snapshotAt")(
        function* (file: string) {
          const data = yield* fs.readFileString(file)
          const parsed = yield* decodeJson(Genesis, data)
          return {
            records: parsed.records ?? [],
            timestamp: yield* Clock.currentTimeMillis,
          }
        },
        Effect.mapError(sandboxError("Sandbox.snapshot")),
      )

      const dumpStateFile = Effect.gen(function* () {
        yield* nextBlock()
        yield* runCommand(spawner, binary, home, ["view-state", "dump-state"])
        return path.join(home, "output.json")
      })

      return Sandbox.of({
        rpcUrl,
        networkId: "localnet",
        rootAccount: {
          id: validator.account_id,
          secretKey: validator.secret_key ?? validator.private_key ?? "",
        },
        patchState,
        restoreState: Effect.fn("Sandbox.restoreState")(
          (snapshot: StateSnapshot) => patchState(snapshot.records),
        ),
        fastForward: Effect.fn("Sandbox.fastForward")(
          function* (numBlocks: number) {
            if (
              !Number.isFinite(numBlocks) ||
              !Number.isInteger(numBlocks) ||
              numBlocks <= 0
            )
              return yield* failure(
                "Sandbox.fastForward",
                "numBlocks must be a positive integer",
              )
            const heightBefore = yield* blockHeight()
            const data = yield* request(
              "fast-forward",
              "sandbox_fast_forward",
              { delta_height: numBlocks },
              "Failed to fast forward",
            )
            const response = yield* Schema.decodeUnknownEffect(RpcResult)(data)
            if (response.error)
              return yield* failure(
                "Sandbox.fastForward",
                `Failed to fast forward: ${response.error.message}`,
              )
            const target = heightBefore + numBlocks
            yield* blockHeight().pipe(
              Effect.repeat({
                schedule: Schedule.spaced("200 millis"),
                until: (height) => height >= target,
              }),
              Effect.timeoutOrElse({
                duration: Math.max(30_000, numBlocks * 100),
                orElse: () =>
                  Effect.gen(function* () {
                    const finalHeight = yield* blockHeight()
                    if (finalHeight < target)
                      return yield* failure(
                        "Sandbox.fastForward",
                        `Fast forward did not reach target height ${target} (currently at ${finalHeight})`,
                      )
                    return finalHeight
                  }),
              }),
            )
          },
          Effect.mapError(sandboxError("Sandbox.fastForward")),
        ),
        dumpState: Effect.fn("Sandbox.dumpState")(() =>
          Effect.flatMap(dumpStateFile, snapshotAt),
        ),
        saveSnapshot: Effect.fn("Sandbox.saveSnapshot")(
          function* () {
            const directory = path.join(home, "snapshots")
            yield* fs.makeDirectory(directory, { recursive: true })
            const file = path.join(
              directory,
              `snapshot-${yield* Clock.currentTimeMillis}.json`,
            )
            yield* fs.copyFile(yield* dumpStateFile, file)
            return file
          },
          Effect.mapError(sandboxError("Sandbox.saveSnapshot")),
        ),
        loadSnapshot: snapshotAt,
        restart: Effect.fn("Sandbox.restart")(
          function* (snapshot?: StateSnapshot) {
            // Ownership cannot be dropped between clearing the Ref and closing
            // the previous process scope, even if restart is interrupted.
            yield* Effect.gen(function* () {
              const previous = yield* Ref.getAndSet(running, undefined)
              if (!previous)
                return yield* failure(
                  "Sandbox.restart",
                  "Sandbox is not running",
                )
              yield* Scope.close(previous, Exit.void)
            }).pipe(Effect.uninterruptible)
            yield* fs.copyFile(originalGenesis, genesisPath)
            if (snapshot && snapshot.records.length > 0) {
              const genesis = yield* fs
                .readFileString(genesisPath)
                .pipe(Effect.flatMap((value) => decodeJson(Genesis, value)))
              const identifiers = new Set(
                snapshot.records.map(recordId).filter((id) => id !== undefined),
              )
              const records = [
                ...(genesis.records ?? []).filter((record) => {
                  const id = recordId(record)
                  return id === undefined || !identifiers.has(id)
                }),
                ...snapshot.records,
              ]
              const totalSupply = yield* Effect.try({
                try: () =>
                  records
                    .reduce(
                      (sum, record) =>
                        record.Account
                          ? sum +
                            BigInt(record.Account.account.amount) +
                            BigInt(record.Account.account.locked)
                          : sum,
                      0n,
                    )
                    .toString(),
                catch: sandboxError("Sandbox.restart"),
              })
              yield* fs.writeFileString(
                genesisPath,
                yield* Effect.try({
                  try: () =>
                    JSON.stringify(
                      { ...genesis, records, total_supply: totalSupply },
                      null,
                      2,
                    ),
                  catch: sandboxError("Sandbox.restart.encoding"),
                }),
              )
            }
            yield* fs.remove(path.join(home, "data"), {
              recursive: true,
              force: true,
            })
            const ports = yield* availablePorts()
            yield* startProcess(ports.network)
          },
          Semaphore.withPermits(lock, 1),
          (restart) =>
            Effect.gen(function* () {
              if (yield* Ref.get(closed))
                return yield* failure(
                  "Sandbox.restart",
                  "Sandbox is not running",
                )
              // Every restart belongs to the sandbox lifetime, including process
              // acquisition and readiness. Closing the scope cancels and awaits
              // it before returning; caller interruption does the same.
              return yield* Effect.acquireUseRelease(
                Effect.forkIn(restart, lifetime),
                Fiber.join,
                Fiber.interrupt,
              )
            }),
          Effect.mapError(sandboxError("Sandbox.restart")),
        ),
      })
    }).pipe(
      Scope.provide(lifetime),
      Effect.onExit((exit) =>
        Exit.isFailure(exit) ? Scope.close(lifetime, exit) : Effect.void,
      ),
    )
  },
  Effect.mapError(sandboxError("Sandbox.make")),
)

function recordId(record: StateRecord): string | undefined {
  if (record.Account) return `${record.Account.account_id}:Account`
  if (record.AccessKey) return `${record.AccessKey.account_id}:AccessKey`
  if (record.Contract) return `${record.Contract.account_id}:Contract`
  if (record.Data) return `${record.Data.account_id}:Data`
  return undefined
}
