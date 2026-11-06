import * as Near from "@near-kit/next"
import * as Effect from "effect/Effect"
export const supportsCancellation = true
export function make(url) {
  const client = Near.make({ url })
  return async (id, at = "final", signal) => {
    signal?.throwIfAborted()
    return Effect.runPromise(
      Near.account(client, id, { at: at === "final" ? at : { hash: at } }).pipe(
        Effect.provide(Near.fetchLayer),
      ),
      { signal },
    )
  }
}
