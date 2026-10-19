import type { Client } from "@near-kit/next"
import * as Near from "@near-kit/next"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
export const tokenBalance = (
  client: Client,
  contractId: string,
  accountId: string,
) =>
  Near.view(client, {
    accountId: contractId,
    method: "ft_balance_of",
    args: { account_id: accountId },
    schema: Schema.String,
  })
export async function accountsAtOneBlock(
  client: Client,
  accountIds: ReadonlyArray<string>,
  signal: AbortSignal,
) {
  signal.throwIfAborted()
  return Effect.runPromise(
    Effect.gen(function* () {
      const block = yield* Near.block(client)
      return yield* Effect.all(
        accountIds.map((id) =>
          Near.account(client, id, { at: { hash: block.blockHash } }),
        ),
        { concurrency: 4 },
      )
    }).pipe(Effect.timeout("5 seconds"), Effect.provide(Near.fetchLayer)),
    { signal },
  )
}
