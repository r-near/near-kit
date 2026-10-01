import * as Effect from "effect/Effect"
import type { HttpClient } from "effect/http/HttpClient"
import * as Schema from "effect/Schema"
import type { At, BlockMetadata, Client } from "../client.js"
import { type PublicKeyReference, parsePublicKey } from "../data.js"
import {
  DecodeError,
  type Operation,
  type ReadError,
  UnsupportedError,
} from "../errors.js"
import {
  checkBlock,
  decode,
  metadata,
  projectMetadata,
  u16,
  u64,
  u128,
} from "../internal/decode.js"
import {
  accountId,
  blockParams,
  plainRecord,
  publicKey,
  selection,
} from "../internal/input.js"
import { request } from "../internal/wire.js"

export interface FunctionCallPermission {
  readonly allowance: bigint | null
  readonly receiverId: string
  readonly methodNames: readonly string[]
}
export interface GasKeyInfo {
  readonly balance: bigint
  readonly numNonces: number
}
export type AccessKeyPermission =
  | { readonly kind: "FullAccess" }
  | ({ readonly kind: "FunctionCall" } & FunctionCallPermission)
  | ({ readonly kind: "GasKeyFullAccess" } & GasKeyInfo)
  | ({ readonly kind: "GasKeyFunctionCall" } & GasKeyInfo &
      FunctionCallPermission)
export interface AccessKey {
  readonly nonce: bigint
  readonly permission: AccessKeyPermission
}
export interface KeyEntry {
  readonly publicKey: PublicKeyReference
  readonly accessKey: AccessKey
}
export interface AccessKeys extends BlockMetadata {
  readonly keys: readonly KeyEntry[]
}
export interface GasKeyNonces extends BlockMetadata {
  readonly nonces: readonly bigint[]
}
const fnFields = {
  allowance: Schema.NullOr(u128),
  receiver_id: Schema.String,
  method_names: Schema.Array(Schema.String),
}
const gasFields = { balance: u128, num_nonces: u16 }
const wireKey = { nonce: u64, permission: Schema.Unknown }
const permission = Effect.fnUntraced(function* (
  value: unknown,
  operation: Operation,
): Effect.fn.Return<AccessKeyPermission, DecodeError> {
  if (value === "FullAccess") return { kind: "FullAccess" }
  if (!plainRecord(value) || Reflect.ownKeys(value).length !== 1)
    return yield* new DecodeError({ operation, reason: "InvalidResponse" })
  if (Object.hasOwn(value, "FunctionCall")) {
    const info = yield* decode(
      Schema.Struct(fnFields),
      value.FunctionCall,
      operation,
    )
    return {
      kind: "FunctionCall",
      allowance: info.allowance === null ? null : BigInt(info.allowance),
      receiverId: info.receiver_id,
      methodNames: info.method_names,
    }
  }
  if (Object.hasOwn(value, "GasKeyFullAccess")) {
    const info = yield* decode(
      Schema.Struct(gasFields),
      value.GasKeyFullAccess,
      operation,
    )
    return {
      kind: "GasKeyFullAccess",
      balance: BigInt(info.balance),
      numNonces: info.num_nonces,
    }
  }
  if (Object.hasOwn(value, "GasKeyFunctionCall")) {
    const info = yield* decode(
      Schema.Struct({ ...gasFields, ...fnFields }),
      value.GasKeyFunctionCall,
      operation,
    )
    return {
      kind: "GasKeyFunctionCall",
      balance: BigInt(info.balance),
      numNonces: info.num_nonces,
      allowance: info.allowance === null ? null : BigInt(info.allowance),
      receiverId: info.receiver_id,
      methodNames: info.method_names,
    }
  }
  return yield* new DecodeError({ operation, reason: "InvalidResponse" })
})
const parsedKey = (value: string, operation: Operation) =>
  Effect.try({
    try: () => parsePublicKey(value),
    catch: () => new DecodeError({ operation, reason: "InvalidResponse" }),
  })
export const accessKey = Effect.fnUntraced(function* (
  client: Client,
  id: string,
  key: string,
  options?: { readonly at?: At },
): Effect.fn.Return<AccessKey & BlockMetadata, ReadError, HttpClient> {
  const reply = yield* request(client, "accessKey", "query", () => {
    const account = accountId(id, "accessKey")
    const encoded = publicKey(key, "accessKey")
    const at = selection(options?.at, "accessKey")
    return {
      params: {
        request_type: "view_access_key",
        account_id: account,
        public_key: encoded,
        ...blockParams(at),
      },
      context: { accountId: account, publicKey: encoded, at },
    }
  })
  const value = yield* decode(
    Schema.Struct({ ...metadata, ...wireKey }),
    reply.value,
    "accessKey",
  )
  const meta = projectMetadata(value)
  yield* checkBlock(meta, reply.context.at, "accessKey")
  return {
    ...meta,
    nonce: BigInt(value.nonce),
    permission: yield* permission(value.permission, "accessKey"),
  }
})
/** Legacy full-list profile. A continuation is never silently discarded. */
export const accessKeys = Effect.fnUntraced(function* (
  client: Client,
  id: string,
  options?: { readonly at?: At },
): Effect.fn.Return<AccessKeys, ReadError, HttpClient> {
  const reply = yield* request(client, "accessKeys", "query", () => {
    const account = accountId(id, "accessKeys")
    const at = selection(options?.at, "accessKeys")
    return {
      params: {
        request_type: "view_access_key_list",
        account_id: account,
        ...blockParams(at),
      },
      context: { accountId: account, at },
    }
  })
  const value = yield* decode(
    Schema.Struct({
      ...metadata,
      keys: Schema.Array(
        Schema.Struct({
          public_key: Schema.String,
          access_key: Schema.Struct(wireKey),
        }),
      ),
      last_key: Schema.optionalKey(Schema.Unknown),
    }),
    reply.value,
    "accessKeys",
  )
  const meta = projectMetadata(value)
  yield* checkBlock(meta, reply.context.at, "accessKeys")
  if (value.last_key != null) {
    return yield* new UnsupportedError({
      operation: "accessKeys",
      feature: "AccessKeyPagination",
    })
  }
  const keys = yield* Effect.forEach(value.keys, (item) =>
    Effect.gen(function* () {
      return {
        publicKey: yield* parsedKey(item.public_key, "accessKeys"),
        accessKey: {
          nonce: BigInt(item.access_key.nonce),
          permission: yield* permission(
            item.access_key.permission,
            "accessKeys",
          ),
        },
      }
    }),
  )
  return { ...meta, keys }
})
export const gasKeyNonces = Effect.fnUntraced(function* (
  client: Client,
  id: string,
  key: string,
  options?: { readonly at?: At },
): Effect.fn.Return<GasKeyNonces, ReadError, HttpClient> {
  const reply = yield* request(client, "gasKeyNonces", "query", () => {
    const account = accountId(id, "gasKeyNonces")
    const encoded = publicKey(key, "gasKeyNonces")
    const at = selection(options?.at, "gasKeyNonces")
    return {
      params: {
        request_type: "view_gas_key_nonces",
        account_id: account,
        public_key: encoded,
        ...blockParams(at),
      },
      context: { accountId: account, publicKey: encoded, at },
    }
  })
  const value = yield* decode(
    Schema.Struct({ ...metadata, nonces: Schema.Array(u64) }),
    reply.value,
    "gasKeyNonces",
  )
  const meta = projectMetadata(value)
  yield* checkBlock(meta, reply.context.at, "gasKeyNonces")
  return { ...meta, nonces: value.nonces.map((nonce) => BigInt(nonce)) }
})
