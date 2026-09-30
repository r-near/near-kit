/* oxlint-disable effecttsgo/unstable-api-usage -- Exercises the same pinned platform HTTP layer used by the sandbox. */
import { watch } from "node:fs"
import * as fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Deferred, Effect, Exit, Fiber, FileSystem, Layer, Scope } from "effect"
import { FetchHttpClient } from "effect/http"
import { ChildProcessSpawner } from "effect/process"
import { afterEach, describe, expect, test } from "vitest"
import { makeSandbox } from "../../src/effect/sandbox.js"
import { Sandbox } from "../../src/sandbox/sandbox.js"

const fixtures: string[] = []
const homes: string[] = []
const platform = Layer.merge(NodeServices.layer, FetchHttpClient.layer)

afterEach(async () => {
  await Promise.all(
    [...fixtures, ...homes].map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  )
  fixtures.length = 0
  homes.length = 0
})

async function executable(
  mode: "fail-init" | "hang-init" | "fail-run" | "normal",
) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "sandbox-effect-fixture-"),
  )
  fixtures.push(directory)
  const binary = path.join(directory, "sandbox.cjs")
  await fs.writeFile(
    binary,
    `#!${process.execPath}
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const home = process.argv[process.argv.indexOf('--home') + 1]
const directory = ${JSON.stringify(directory)}
const mode = ${JSON.stringify(mode)}
const command = process.argv[4]
const write = (name, value) => fs.writeFileSync(path.join(directory, name), JSON.stringify(value))
if (command === 'init') {
  write('init.json', { home, pid: process.pid })
  if (mode === 'fail-init') process.exit(17)
  if (mode === 'hang-init') setInterval(() => {}, 1000)
  else {
    fs.writeFileSync(path.join(home, 'genesis.json'), JSON.stringify({ records: [], total_supply: '0' }))
    fs.writeFileSync(path.join(home, 'validator_key.json'), JSON.stringify({ account_id: 'test.near', public_key: 'ed25519:test', secret_key: 'ed25519:test' }))
  }
} else if (command === 'run') {
  write('run.json', { home, pid: process.pid, genesis: JSON.parse(fs.readFileSync(path.join(home, 'genesis.json'))) })
  if (mode === 'fail-run') process.exit(18)
  let height = 0
  const port = Number(process.argv[process.argv.indexOf('--rpc-addr') + 1].split(':').pop())
  http.createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => { body += chunk })
    request.on('end', () => {
      const rpc = JSON.parse(body)
      if (rpc.method === 'sandbox_fast_forward') height += rpc.params.delta_height
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ result: rpc.method === 'status' ? { sync_info: { latest_block_height: ++height } } : {} }))
    })
  }).listen(port, '127.0.0.1')
} else if (command === 'view-state') {
  fs.writeFileSync(path.join(home, 'output.json'), fs.readFileSync(path.join(home, 'genesis.json')))
}
`,
  )
  await fs.chmod(binary, 0o755)
  return { directory, binary }
}

function waitForRecord(
  directory: string,
  name: string,
): Promise<{ home: string; pid: number }> {
  return new Promise((resolve, reject) => {
    const watcher = watch(directory, () => {
      void read()
    })
    const read = async () => {
      try {
        const value = JSON.parse(
          await fs.readFile(path.join(directory, name), "utf8"),
        ) as { home: string; pid: number }
        watcher.close()
        resolve(value)
      } catch (error) {
        if (
          error instanceof SyntaxError ||
          (error instanceof Error && "code" in error && error.code === "ENOENT")
        )
          return
        watcher.close()
        reject(error)
      }
    }
    watcher.on("error", (error) => {
      watcher.close()
      reject(error)
    })
    void read()
  })
}

const absent = async (directory: string) =>
  expect(fs.stat(directory)).rejects.toMatchObject({ code: "ENOENT" })
const stopped = (pid: number) => expect(() => process.kill(pid, 0)).toThrow()

describe("sandbox scoped resource ownership", () => {
  test("snapshot loading preserves gas-key and future permission fields", async () => {
    const fixture = await executable("normal")
    const sandbox = await Sandbox.start({
      binaryPath: fixture.binary,
      detached: false,
    })
    const records = [
      {
        AccessKey: {
          account_id: "test.near",
          public_key: "ed25519:test",
          access_key: {
            nonce: 0,
            permission: {
              GasKeyFullAccess: {
                balance: "100",
                num_nonces: 4,
                future_field: "preserve",
              },
            },
            future_key_field: 7,
          },
        },
      },
      { FutureRecord: { value: "keep" } },
    ]
    const snapshot = path.join(fixture.directory, "gas-key.json")
    await fs.writeFile(snapshot, JSON.stringify({ records, timestamp: 1 }))
    try {
      expect((await sandbox.loadSnapshot(snapshot)).records).toEqual(records)
    } finally {
      await sandbox.stop()
    }
  })

  // New owner-boundary regression: the old start() leaked its temp home whenever
  // init failed. Existing binary-path tests checked only the rejection message.
  test("removes the temporary home when init fails", async () => {
    const fixture = await executable("fail-init")
    await expect(Sandbox.start({ binaryPath: fixture.binary })).rejects.toThrow(
      "Sandbox init failed with code 17",
    )
    const { home, pid } = await waitForRecord(fixture.directory, "init.json")
    homes.push(home)
    await absent(home)
    stopped(pid)
  })

  test("interrupting init waits for process termination and temporary cleanup", async () => {
    const fixture = await executable("hang-init")
    const controller = new AbortController()
    const started = waitForRecord(fixture.directory, "init.json")
    const run = Effect.runPromise(
      makeSandbox({ binaryPath: fixture.binary }).pipe(
        Effect.provide(platform),
        Effect.scoped,
      ),
      { signal: controller.signal },
    )
    const rejection = expect(run).rejects.toBeDefined()
    const { home, pid } = await started
    homes.push(home)
    controller.abort()
    await rejection
    stopped(pid)
    await absent(home)
  })

  test("startup exit fails promptly and removes its home", async () => {
    const fixture = await executable("fail-run")
    await expect(
      Sandbox.start({ binaryPath: fixture.binary, detached: false }),
    ).rejects.toThrow("Sandbox exited before RPC was ready with code 18")
    const { home, pid } = await waitForRecord(fixture.directory, "run.json")
    homes.push(home)
    stopped(pid)
    await absent(home)
  })

  test("closing the native scope kills an unreferenced detached sandbox", async () => {
    const fixture = await executable("normal")
    const result = await Effect.runPromise(
      makeSandbox({ binaryPath: fixture.binary }).pipe(
        Effect.provide(platform),
        Effect.scoped,
      ),
    )
    expect(result.networkId).toBe("localnet")
    const { home, pid } = await waitForRecord(fixture.directory, "run.json")
    homes.push(home)
    stopped(pid)
    await absent(home)
  })

  test("interrupting a download cancels its body and removes partial archive files", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "sandbox-effect-download-"),
    )
    fixtures.push(directory)
    let cancelled = false
    const temporaryDirectories: string[] = []
    await Effect.runPromise(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem
        const reading = yield* Deferred.make<void>()
        const fetch: typeof globalThis.fetch = async () =>
          new Response(
            new ReadableStream<Uint8Array>(
              {
                pull() {
                  Deferred.doneUnsafe(reading, Effect.void)
                },
                cancel() {
                  cancelled = true
                },
              },
              { highWaterMark: 0 },
            ),
          )
        const download = yield* makeSandbox({
          version: `interrupted-${path.basename(directory)}`,
        }).pipe(
          Effect.provideService(FileSystem.FileSystem, {
            ...fileSystem,
            makeTempDirectoryScoped: (options) =>
              fileSystem
                .makeTempDirectoryScoped({ ...options, directory })
                .pipe(
                  Effect.tap((created) =>
                    Effect.sync(() => {
                      temporaryDirectories.push(created)
                    }),
                  ),
                ),
          }),
          Effect.provideService(FetchHttpClient.Fetch, fetch),
          Effect.forkChild,
        )
        yield* Deferred.await(reading)
        yield* Fiber.interrupt(download)
      }).pipe(Effect.provide(platform), Effect.scoped),
    )
    expect(cancelled).toBe(true)
    expect(temporaryDirectories).toHaveLength(1)
    for (const temporary of temporaryDirectories) await absent(temporary)
    expect(await fs.readdir(directory)).toEqual([])
  })

  test("stop interrupts a restart suspended in process acquisition", async () => {
    const fixture = await executable("normal")
    await Effect.runPromise(
      Effect.gen(function* () {
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
        const acquiring = yield* Deferred.make<void>()
        const released = yield* Deferred.make<void>()
        const blocked = yield* Deferred.make<void>()
        const owner = yield* Scope.make()
        let runs = 0
        const service = yield* makeSandbox({
          binaryPath: fixture.binary,
          detached: false,
        }).pipe(
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, {
            ...spawner,
            spawn: Effect.fn("Test.spawn")(function* (command) {
              if (
                command._tag === "StandardCommand" &&
                command.args.includes("run") &&
                ++runs === 2
              ) {
                yield* Effect.gen(function* () {
                  yield* Deferred.succeed(acquiring, undefined)
                  yield* Deferred.await(blocked)
                }).pipe(Effect.ensuring(Deferred.succeed(released, undefined)))
              }
              return yield* spawner.spawn(command)
            }),
          }),
          Scope.provide(owner),
        )
        const restart = yield* service.restart().pipe(Effect.forkChild)
        yield* Deferred.await(acquiring)
        yield* Scope.close(owner, Exit.void)
        // Scope closure must finish cancellation of the in-flight acquisition,
        // without needing the external process boundary to make progress.
        expect(yield* Deferred.isDone(released)).toBe(true)
        expect(Exit.isFailure(yield* Fiber.await(restart))).toBe(true)
        const error = yield* service.restart().pipe(Effect.flip)
        expect(error.cause).toEqual(new Error("Sandbox is not running"))
      }).pipe(Effect.provide(platform), Effect.scoped),
    )
    const { home, pid } = await waitForRecord(fixture.directory, "run.json")
    homes.push(home)
    stopped(pid)
    await absent(home)
  })

  test("restart replaces the process, restores clean genesis, and stop is idempotent", async () => {
    const fixture = await executable("normal")
    const sandbox = await Sandbox.start({
      binaryPath: fixture.binary,
      detached: false,
    })
    const original = await waitForRecord(fixture.directory, "run.json")
    homes.push(original.home)
    try {
      const snapshot = {
        timestamp: 1,
        records: [
          {
            Account: {
              account_id: "alice.test.near",
              account: {
                amount: "10",
                locked: "5",
                code_hash: "11111111111111111111111111111111",
                storage_usage: 0,
              },
            },
          },
        ],
      }
      await sandbox.restart(snapshot)
      stopped(original.pid)
      const restarted = await waitForRecord(fixture.directory, "run.json")
      expect(restarted.pid).not.toBe(original.pid)
      const genesis = JSON.parse(
        await fs.readFile(path.join(original.home, "genesis.json"), "utf8"),
      )
      expect(genesis.records).toEqual(snapshot.records)
      expect(genesis.total_supply).toBe("15")
      await sandbox.fastForward(3)
      await sandbox.patchState([])
      expect((await sandbox.dumpState()).records).toEqual(snapshot.records)
      expect(
        (await sandbox.loadSnapshot(await sandbox.saveSnapshot())).records,
      ).toEqual(snapshot.records)
      await sandbox.restart()
      stopped(restarted.pid)
      expect(
        JSON.parse(
          await fs.readFile(path.join(original.home, "genesis.json"), "utf8"),
        ),
      ).toEqual({ records: [], total_supply: "0" })
    } finally {
      await sandbox.stop()
    }
    await sandbox.stop()
    await expect(sandbox.restart()).rejects.toThrow("Sandbox is not running")
    const last = await waitForRecord(fixture.directory, "run.json")
    stopped(last.pid)
    await absent(original.home)
  })
})
