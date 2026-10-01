import * as Effect from "effect/Effect"
import type { HttpClient } from "effect/http/HttpClient"
import * as Schema from "effect/Schema"
import type { At, BlockMetadata, Client } from "../client.js"
import { DecodeError, type ReadError } from "../errors.js"
import {
  bytes,
  checkBlock,
  decode,
  hash,
  metadata,
  projectMetadata,
} from "../internal/decode.js"
import {
  accountId,
  blockParams,
  codeHash,
  invalid,
  plainRecord,
  selection,
} from "../internal/input.js"
import { request } from "../internal/wire.js"

export interface Code extends BlockMetadata {
  readonly bytes: Uint8Array
  readonly codeHash: string
}
export type GlobalReference =
  | { readonly hash: string }
  | { readonly publisher: string }
const Response = Schema.Struct({
  ...metadata,
  code_base64: Schema.String,
  hash,
})
const project = Effect.fnUntraced(function* (
  reply: { value: unknown; context: { at?: At } },
  operation: "code" | "globalCode",
) {
  const value = yield* decode(Response, reply.value, operation)
  const meta = projectMetadata(value)
  yield* checkBlock(meta, reply.context.at, operation)
  return {
    ...meta,
    bytes: yield* bytes(value.code_base64, operation),
    codeHash: value.hash,
  }
})
/** Node-resolved account code; view_code can resolve global references. */
export const code = Effect.fnUntraced(function* (
  client: Client,
  id: string,
  options?: { readonly at?: At },
): Effect.fn.Return<Code, ReadError, HttpClient> {
  const reply = yield* request(client, "code", "query", () => {
    const account = accountId(id, "code")
    const at = selection(options?.at, "code")
    return {
      params: {
        request_type: "view_code",
        account_id: account,
        ...blockParams(at),
      },
      context: { accountId: account, at },
    }
  })
  return yield* project(reply, "code")
})
export const globalCode = Effect.fnUntraced(function* (
  client: Client,
  reference: GlobalReference,
  options?: { readonly at?: At },
): Effect.fn.Return<Code, ReadError, HttpClient> {
  const reply = yield* request(client, "globalCode", "query", () => {
    if (!plainRecord(reference) || Reflect.ownKeys(reference).length !== 1)
      return invalid("globalCode", "Arguments")
    const at = selection(options?.at, "globalCode")
    if ("hash" in reference && typeof reference.hash === "string") {
      const hash = codeHash(reference.hash, "globalCode")
      return {
        params: {
          request_type: "view_global_contract_code",
          code_hash: hash,
          ...blockParams(at),
        },
        context: { at, global: { hash } },
      }
    }
    if ("publisher" in reference && typeof reference.publisher === "string") {
      const publisher = accountId(reference.publisher, "globalCode")
      return {
        params: {
          request_type: "view_global_contract_code_by_account_id",
          account_id: publisher,
          ...blockParams(at),
        },
        context: { at, accountId: publisher, global: { publisher } },
      }
    }
    return invalid("globalCode", "Arguments")
  })
  const result = yield* project(reply, "globalCode")
  const requested = reply.context.global
  if (
    requested !== undefined &&
    "hash" in requested &&
    requested.hash !== result.codeHash
  )
    return yield* new DecodeError({
      operation: "globalCode",
      reason: "IdentifierMismatch",
    })
  return result
})
