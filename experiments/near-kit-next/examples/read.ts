import * as Near from "@near-kit/next"
import * as Effect from "effect/Effect"

const [url, accountId] = process.argv.slice(2)
if (!url || !accountId) throw new Error("Usage: read.ts RPC_URL ACCOUNT_ID")
const near = Near.make({ url })
const controller = new AbortController()
const interrupt = () => controller.abort()
process.once("SIGINT", interrupt)
try {
  controller.signal.throwIfAborted()
  const account = await Effect.runPromise(
    Effect.gen(function* () {
      const block = yield* Near.block(near, "final")
      return yield* Near.account(near, accountId, {
        at: { hash: block.blockHash },
      })
    }).pipe(Effect.timeout("10 seconds"), Effect.provide(Near.fetchLayer)),
    { signal: controller.signal },
  )
  console.log(
    JSON.stringify({
      amount: account.amount.toString(),
      blockHash: account.blockHash,
      blockHeight: account.blockHeight.toString(),
    }),
  )
} finally {
  process.removeListener("SIGINT", interrupt)
}
