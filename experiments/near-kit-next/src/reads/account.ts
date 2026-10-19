import * as Effect from "effect/Effect"
import type { HttpClient } from "effect/http/HttpClient"
import * as Schema from "effect/Schema"
import type { At, BlockMetadata, Client } from "../client.js"
import { isAccountId } from "../data.js"
import { DecodeError, type ReadError } from "../errors.js"
import {
  checkBlock,
  decode,
  hash,
  metadata,
  projectMetadata,
  u64,
  u128,
} from "../internal/decode.js"
import {
  blockParams,
  accountId as inputAccount,
  selection,
} from "../internal/input.js"
import { request } from "../internal/wire.js"

export interface Account extends BlockMetadata {
  readonly amount: bigint
  readonly locked: bigint
  readonly storageUsage: bigint
  readonly codeHash: string
  readonly globalContractHash?: string
  readonly globalContractAccountId?: string
}
const Response = Schema.Struct({
  ...metadata,
  amount: u128,
  locked: u128,
  storage_usage: u64,
  code_hash: hash,
  global_contract_hash: Schema.optionalKey(Schema.NullOr(hash)),
  global_contract_account_id: Schema.optionalKey(
    Schema.NullOr(Schema.String.check(Schema.makeFilter(isAccountId))),
  ),
})
export const account = Effect.fnUntraced(function* (
  client: Client,
  accountId: string,
  options?: { readonly at?: At },
): Effect.fn.Return<Account, ReadError, HttpClient> {
  const reply = yield* request(client, "account", "query", () => {
    const id = inputAccount(accountId, "account")
    const at = selection(options?.at, "account")
    return {
      params: {
        request_type: "view_account",
        account_id: id,
        ...blockParams(at),
      },
      context: { accountId: id, at },
    }
  })
  const value = yield* decode(Response, reply.value, "account")
  const globalHash = value.global_contract_hash ?? undefined
  const globalAccount = value.global_contract_account_id ?? undefined
  if (
    (globalHash !== undefined && globalAccount !== undefined) ||
    ((globalHash !== undefined || globalAccount !== undefined) &&
      value.code_hash !== "11111111111111111111111111111111")
  )
    return yield* new DecodeError({
      operation: "account",
      reason: "InvalidResponse",
    })
  const result: Account = {
    ...projectMetadata(value),
    amount: BigInt(value.amount),
    locked: BigInt(value.locked),
    storageUsage: BigInt(value.storage_usage),
    codeHash: value.code_hash,
    ...(globalHash === undefined ? {} : { globalContractHash: globalHash }),
    ...(globalAccount === undefined
      ? {}
      : { globalContractAccountId: globalAccount }),
  }
  yield* checkBlock(result, reply.context.at, "account")
  return result
})
