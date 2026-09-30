import { Near } from "@near-kit/read-experiment"
import * as Effect from "effect/Effect"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import * as Schema from "effect/Schema"

const near = Near.make({ url: "https://fixture.invalid" })
const account = near.account("fixture")
const view = near.view({
  accountId: "fixture",
  method: "read",
  schema: Schema.Struct({ count: Schema.Number }),
})
type Count = Effect.Success<typeof view>["value"]["count"]
const count: Count = 7
const typeErrors = () => {
  // @ts-expect-error Transport must still be supplied.
  Effect.runPromise(account)
  // @ts-expect-error The schema-inferred result is a number.
  const wrong: string = count
  void wrong
}

void typeErrors

const fetch: typeof globalThis.fetch = async (_input, init) => {
  const request = JSON.parse(String(init?.body)) as { id: unknown }
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        amount: "1234567890123456789012345",
        locked: "0",
        storage_usage: 0,
        code_hash: "11111111111111111111111111111111",
        block_height: 0,
        block_hash: "11111111111111111111111111111111",
      },
    }),
  )
}
const result = await Effect.runPromise(
  account.pipe(
    Effect.provide(Near.fetchLayer),
    Effect.provideService(FetchHttpClient.Fetch, fetch),
  ),
)
if (result.amount !== 1234567890123456789012345n || result.blockHeight !== 0)
  throw new Error("Packed consumer failed")
console.log("Packed browser-types and runtime consumer passed")
