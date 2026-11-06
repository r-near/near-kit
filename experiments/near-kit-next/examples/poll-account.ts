/** Application polling: no owned/background runtime and no subscription guarantee. */
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import * as Near from "@near-kit/next"
import type * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Schedule from "effect/Schedule"
import * as Stream from "effect/Stream"

/** Each sample reads current final state. Repeated block hashes are possible. */
export const accountSamples = (
  client: Near.Client,
  accountId: string,
  spacing: Duration.Input = "5 seconds",
) =>
  Stream.fromEffectSchedule(
    Near.account(client, accountId).pipe(
      Effect.retry({
        times: 2,
        schedule: Schedule.exponential("100 millis"),
        while: (error) => error._tag === "TransportError",
      }),
    ),
    Schedule.spaced(spacing),
  )

export async function main(args: readonly string[]) {
  const [url, accountId] = args
  if (args.length !== 2 || !url || !accountId) {
    console.error("Usage: poll-account.ts RPC_URL ACCOUNT_ID")
    return 2
  }
  const controller = new AbortController()
  const stop = () => controller.abort()
  process.once("SIGINT", stop)
  try {
    controller.signal.throwIfAborted()
    await Effect.runPromise(
      accountSamples(Near.make({ url }), accountId).pipe(
        Stream.take(5), // A bounded application sample, not a complete history.
        Stream.runForEach((value) =>
          Effect.sync(() =>
            console.log(
              JSON.stringify({
                amount: value.amount.toString(),
                blockHash: value.blockHash,
                blockHeight: value.blockHeight.toString(),
              }),
            ),
          ),
        ),
        Effect.timeout("1 minute"),
        Effect.provide(Near.fetchLayer),
      ),
      { signal: controller.signal },
    )
    return 0
  } catch {
    console.error(
      controller.signal.aborted ? "Polling stopped" : "Polling failed",
    )
    return controller.signal.aborted ? 130 : 1
  } finally {
    process.removeListener("SIGINT", stop)
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  process.exitCode = await main(process.argv.slice(2))
