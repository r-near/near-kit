import * as Near from "@near-kit/next"
import { deterministicAccountId, type StateInit } from "@near-kit/next/address"
import * as Effect from "effect/Effect"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import * as Schema from "effect/Schema"
import { platformChecks } from "./platform.js"

const state: StateInit = { code: { accountId: "publisher.near" } }
if (
  deterministicAccountId(state) !== "0s2293da2d32cd0a067950616036ff973884abab0a"
)
  throw new Error("Packed public address calculation failed")
const near = Near.make({ url: "https://fixture.invalid" })
const account = Near.account(near, "fixture")
const view = Near.view(near, {
  accountId: "fixture",
  method: "read",
  schema: Schema.Struct({ count: Schema.Number }),
})
type Count = Effect.Success<typeof view>["value"]["count"]
const count: Count = 7
const typeErrors = () => {
  // @ts-expect-error Code references are exclusive.
  deterministicAccountId({ code: { hash: "hash", accountId: "aa" } })
  deterministicAccountId({
    code: { accountId: "aa" },
    // @ts-expect-error Initial storage is bytes, not JSON strings.
    data: [["key", "value"]],
  })
  // @ts-expect-error Transport must still be supplied.
  Effect.runPromise(account)
  // @ts-expect-error The schema-inferred result is a number.
  const wrong: string = count
  void wrong
  // @ts-expect-error Protocol height is bigint, not number.
  const height: number = null as unknown as Effect.Success<
    typeof account
  >["blockHeight"]
  // @ts-expect-error A plain record cannot impersonate the opaque client.
  Near.account({}, "fixture")
  // @ts-expect-error Heights must use bigint.
  Near.account(near, "fixture", { at: { height: 1 } })
  void height
}
void typeErrors
const fetch: typeof globalThis.fetch = async (_input, init) => {
  const request = JSON.parse(String(init?.body)) as {
    id: unknown
  }
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
if (result.amount !== 1234567890123456789012345n || result.blockHeight !== 0n)
  throw new Error("Packed consumer failed")
console.log("Packed browser-types and runtime consumer passed")

await platformChecks()
