import { Effect } from "effect"
import { Near } from "@near-kit/read-experiment"

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
      const block = yield* near.block("final")
      return yield* near.account(accountId, { at: { hash: block.blockHash } })
    }).pipe(Effect.timeout("10 seconds"), Effect.provide(Near.fetchLayer)),
    { signal: controller.signal },
  )
  console.log({ amount: account.amount.toString(), blockHash: account.blockHash, blockHeight: account.blockHeight })
} finally {
  process.removeListener("SIGINT", interrupt)
}
