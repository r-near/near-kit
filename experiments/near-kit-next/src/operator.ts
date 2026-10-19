import * as Effect from "effect/Effect"
import type { HttpClient } from "effect/http/HttpClient"
import * as Schema from "effect/Schema"
import type { Client } from "./client.js"
import { isAccountId } from "./data.js"
import { DecodeError, type ReadError } from "./errors.js"
import { decode, hash, u32, u64, u128 } from "./internal/decode.js"
import { accountId, codeHash, invalid, plainRecord } from "./internal/input.js"
import { request } from "./internal/wire.js"

export interface GenesisSummary {
  readonly chainId: string
  readonly protocolVersion: number
  readonly genesisHeight: bigint
  readonly epochLength: bigint
  readonly totalSupply: bigint
  readonly genesisTime?: string
}
export interface MaintenanceWindow {
  readonly start: bigint
  readonly end: bigint
}
export interface BlockEffect {
  readonly accountId: string
  readonly kind:
    | "account_touched"
    | "access_key_touched"
    | "data_touched"
    | "contract_code_touched"
}
export interface BlockEffects {
  readonly blockHash: string
  readonly changes: readonly BlockEffect[]
}
export const genesisSummary = Effect.fnUntraced(function* (
  client: Client,
): Effect.fn.Return<GenesisSummary, ReadError, HttpClient> {
  const reply = yield* request(
    client,
    "genesisSummary",
    "genesis_config",
    () => ({ params: [] }),
  )
  const value = yield* decode(
    Schema.Struct({
      chain_id: Schema.NonEmptyString,
      protocol_version: u32,
      genesis_height: u64,
      epoch_length: u64,
      total_supply: u128,
      genesis_time: Schema.optionalKey(Schema.NonEmptyString),
    }),
    reply.value,
    "genesisSummary",
  )
  return {
    chainId: value.chain_id,
    protocolVersion: value.protocol_version,
    genesisHeight: BigInt(value.genesis_height),
    epochLength: BigInt(value.epoch_length),
    totalSupply: BigInt(value.total_supply),
    ...(value.genesis_time === undefined
      ? {}
      : { genesisTime: value.genesis_time }),
  }
})
export const maintenanceWindows = Effect.fnUntraced(function* (
  client: Client,
  id: string,
): Effect.fn.Return<readonly MaintenanceWindow[], ReadError, HttpClient> {
  const reply = yield* request(
    client,
    "maintenanceWindows",
    "maintenance_windows",
    () => ({ params: { account_id: accountId(id, "maintenanceWindows") } }),
  )
  const values = yield* decode(
    Schema.Array(Schema.Struct({ start: u64, end: u64 })),
    reply.value,
    "maintenanceWindows",
  )
  const windows = values.map((value) => ({
    start: BigInt(value.start),
    end: BigInt(value.end),
  }))
  if (windows.some((value) => value.start > value.end))
    return yield* new DecodeError({
      operation: "maintenanceWindows",
      reason: "InvalidResponse",
    })
  return windows
})
export const blockEffects = Effect.fnUntraced(function* (
  client: Client,
  at: { readonly hash: string },
): Effect.fn.Return<BlockEffects, ReadError, HttpClient> {
  const reply = yield* request(client, "blockEffects", "block_effects", () => {
    if (
      !plainRecord(at) ||
      Reflect.ownKeys(at).length !== 1 ||
      typeof at.hash !== "string"
    )
      return invalid("blockEffects", "BlockSelector")
    const selected = codeHash(at.hash, "blockEffects")
    return {
      params: { block_id: selected },
      context: { at: { hash: selected } },
    }
  })
  const value = yield* decode(
    Schema.Struct({
      block_hash: hash,
      changes: Schema.Array(
        Schema.Struct({
          type: Schema.Literals([
            "account_touched",
            "access_key_touched",
            "data_touched",
            "contract_code_touched",
          ]),
          account_id: Schema.String.check(Schema.makeFilter(isAccountId)),
        }),
      ),
    }),
    reply.value,
    "blockEffects",
  )
  if (
    typeof reply.context.at !== "object" ||
    !("hash" in reply.context.at) ||
    value.block_hash !== reply.context.at.hash
  )
    return yield* new DecodeError({
      operation: "blockEffects",
      reason: "BlockMismatch",
    })
  return {
    blockHash: value.block_hash,
    changes: value.changes.map((change) => ({
      kind: change.type,
      accountId: change.account_id,
    })),
  }
})
