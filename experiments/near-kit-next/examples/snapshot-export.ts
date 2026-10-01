/**
 * Node application recipe. Run after building the package:
 * node --experimental-strip-types examples/snapshot-export.ts RPC_URL ACCOUNT_ID OUTPUT.ndjson
 *
 * OUTPUT.ndjson.partial is always partial, even if it has an end record. Only a
 * published OUTPUT.ndjson with an end record is complete. Both paths must be new.
 * Failure/interruption preserves the partial file; it may end with a torn line.
 * Publication uses a same-directory hard link, so an existing export is never
 * overwritten. This requires a filesystem supporting hard links. No resume or
 * global-code resolution is implied by this local-code/account-state snapshot.
 */
import { promises as fs } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import * as Near from "@near-kit/next"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"

export class OutputError extends Error {
  readonly _tag = "OutputError"
  readonly operation:
    | "open"
    | "write"
    | "sync"
    | "close"
    | "publish"
    | "cleanup"
  constructor(operation: OutputError["operation"]) {
    super(`Snapshot output ${operation} failed`)
    this.operation = operation
  }
}

export type LocalCode =
  | { readonly status: "available"; readonly code: Near.Code }
  | { readonly status: "unavailable"; readonly reason: "CodeUnavailable" }

const io = <A>(operation: OutputError["operation"], run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: () => new OutputError(operation) })

// Application serialization, not a global BigInt.toJSON hook. Key handles retain
// their discriminant; bytes are never guessed to be UTF-8 (including state keys).
const line = (value: unknown) =>
  `${JSON.stringify(value, (_key, value: unknown) =>
    typeof value === "bigint"
      ? value.toString(10)
      : value instanceof Uint8Array
        ? { encoding: "base64", data: Buffer.from(value).toString("base64") }
        : value,
  )}\n`

/** Borrows the caller's immutable Client and execution-time HttpClient service. */
export const exportSnapshot = (
  client: Near.Client,
  accountId: string,
  outputPath: string,
) =>
  Effect.gen(function* () {
    const partialPath = `${outputPath}.partial`
    const summary = yield* Effect.acquireUseRelease(
      io("open", () => fs.open(partialPath, "wx", 0o600)),
      (file) =>
        Effect.gen(function* () {
          // Await every write: no detached writes, page buffering, or read-ahead.
          const write = (record: unknown) =>
            io("write", () => file.writeFile(line(record)))
          yield* write({
            type: "begin",
            format: "near-kit-snapshot-v1",
            accountId,
            bigints: "decimal-string",
            bytes: "tagged-base64",
          })
          const block = yield* Near.block(client, "final")
          const at = { hash: block.blockHash }
          const localCode = Near.code(client, accountId, { at }).pipe(
            Effect.map((code): LocalCode => ({ status: "available", code })),
            Effect.catchTag("RpcError", (error) =>
              error.kind === "CodeUnavailable"
                ? Effect.succeed<LocalCode>({
                    status: "unavailable",
                    reason: "CodeUnavailable",
                  })
                : Effect.fail(error),
            ),
          )
          const [account, keys, code, gasPrice] = yield* Effect.all(
            [
              Near.account(client, accountId, { at }),
              Near.accessKeys(client, accountId, { at }),
              localCode,
              Near.gasPrice(client, at),
            ],
            { concurrency: 4 },
          )
          yield* write({
            type: "header",
            block,
            account,
            keys,
            localCode: code,
            gasPrice,
          })
          let pages = 0n
          let entries = 0n
          yield* Near.statePages(client, accountId, { at, pageSize: 100 }).pipe(
            Stream.runForEach((page) =>
              Effect.gen(function* () {
                yield* write({ type: "state-page", page })
                pages++
                entries += BigInt(page.entries.length)
              }),
            ),
          )
          // Only natural stream exhaustion reaches this record. An end record alone
          // does not publish a complete export: sync and close must also succeed.
          yield* write({
            type: "end",
            blockHash: block.blockHash,
            pages,
            entries,
          })
          yield* io("sync", () => file.sync())
          return { outputPath, blockHash: block.blockHash, pages, entries }
        }),
      (file) => io("close", () => file.close()),
    )
    // Commit only after the scoped writer has closed. Atomic exclusive publication
    // prevents clobbering another export. The short commit/cleanup is not canceled.
    yield* Effect.uninterruptible(
      Effect.gen(function* () {
        yield* io("publish", () => fs.link(partialPath, outputPath))
        yield* io("cleanup", () => fs.unlink(partialPath))
      }),
    )
    return summary
  })

export async function main(args: readonly string[]): Promise<number> {
  const [url, accountId, outputPath] = args
  if (args.length !== 3 || !url || !accountId || !outputPath) {
    console.error("Usage: snapshot-export.ts RPC_URL ACCOUNT_ID OUTPUT.ndjson")
    return 2
  }
  const controller = new AbortController()
  const interrupt = () => controller.abort()
  process.once("SIGINT", interrupt)
  process.once("SIGTERM", interrupt)
  try {
    controller.signal.throwIfAborted()
    await Effect.runPromise(
      exportSnapshot(Near.make({ url }), accountId, outputPath).pipe(
        Effect.timeout("60 seconds"),
        Effect.provide(Near.fetchLayer),
      ),
      { signal: controller.signal },
    )
    console.log(`Snapshot complete: ${outputPath}`)
    return 0
  } catch {
    // Avoid printing provider text, endpoint credentials, or raw filesystem errors.
    console.error(
      `Snapshot failed or interrupted. Any ${outputPath}.partial is partial; a published ${outputPath} is complete. Existing files are preserved.`,
    )
    return controller.signal.aborted ? 130 : 1
  } finally {
    process.removeListener("SIGINT", interrupt)
    process.removeListener("SIGTERM", interrupt)
  }
}

// Importing the recipe starts no network, file, signal-listener, or runtime work.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  process.exitCode = await main(process.argv.slice(2))
}
