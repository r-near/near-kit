import * as Near from "@near-kit/next"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import { begin, line } from "./common.mjs"
export function make(url) {
  const client = Near.make({ url })
  return async (id, signal) => {
    signal?.throwIfAborted()
    return Effect.runPromise(
      Effect.gen(function* () {
        const lines = [line(begin(id))]
        const block = yield* Near.block(client, "final"),
          at = { hash: block.blockHash }
        const [account, keys, code, gasPrice] = yield* Effect.all(
          [
            Near.account(client, id, { at }),
            Near.accessKeys(client, id, { at }),
            Near.code(client, id, { at }),
            Near.gasPrice(client, at),
          ],
          { concurrency: 4 },
        )
        lines.push(
          line({
            type: "header",
            block,
            account,
            keys,
            accountCode: { status: "available", code },
            gasPrice,
          }),
        )
        let pages = 0n,
          entries = 0n
        yield* Near.statePages(client, id, { at, pageSize: 100 }).pipe(
          Stream.runForEach((page) =>
            Effect.sync(() => {
              lines.push(line({ type: "state-page", page }))
              pages++
              entries += BigInt(page.entries.length)
            }),
          ),
        )
        lines.push(
          line({ type: "end", blockHash: block.blockHash, pages, entries }),
        )
        return lines.join("")
      }).pipe(Effect.provide(Near.fetchLayer)),
      { signal },
    )
  }
}
