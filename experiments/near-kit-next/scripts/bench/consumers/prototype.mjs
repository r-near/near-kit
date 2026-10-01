import { Near } from "@near-kit/read-experiment"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

const Output = Schema.Struct({ count: Schema.Number })
export const supportsCancellation = true
export function make(url) {
  const near = Near.make({ url })
  const at = (block) => (block === "final" ? "final" : { hash: block })
  const run = (effect, signal) => {
    signal?.throwIfAborted()
    return Effect.runPromise(effect.pipe(Effect.provide(Near.fetchLayer)), {
      signal,
    })
  }
  return {
    account: (id, block = "final", signal) =>
      run(near.account(id, { at: at(block) }), signal),
    view: (id, block = "final", signal) =>
      run(
        near.view({
          accountId: id,
          method: "count",
          args: {},
          schema: Output,
          at: at(block),
        }),
        signal,
      ),
    bytes: (id, block = "final", signal) =>
      run(
        near.viewBytes({
          accountId: id,
          method: "count",
          args: {},
          at: at(block),
        }),
        signal,
      ),
    four: (hash) =>
      run(
        Effect.all(
          [
            near.account("alice.testnet", { at: at(hash) }),
            near.account("bob.testnet", { at: at(hash) }),
            near.view({
              accountId: "contract.testnet",
              method: "count",
              args: {},
              schema: Output,
              at: at(hash),
            }),
            near.view({
              accountId: "contract.testnet",
              method: "count",
              args: {},
              schema: Output,
              at: at(hash),
            }),
          ],
          { concurrency: 4 },
        ),
      ),
  }
}
