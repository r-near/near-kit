import * as Effect from "effect/Effect"
import type { HttpClient } from "effect/http/HttpClient"
import * as Schema from "effect/Schema"
import type { At, BlockId, BlockMetadata, Client } from "../client.js"
import type { ReadError } from "../errors.js"
import {
  checkBlock,
  decimalU64,
  decode,
  hash,
  u32,
  u64,
  u128,
} from "../internal/decode.js"
import { blockParams, invalid, selection } from "../internal/input.js"
import { rawHeight } from "../internal/json.js"
import { request } from "../internal/wire.js"

export interface Block extends BlockMetadata {
  readonly previousHash: string
  readonly timestampNanoseconds: bigint
  readonly gasPrice: bigint
}
export interface Status {
  readonly chainId: string
  readonly protocolVersion: number
  readonly latestBlockHash: string
  readonly latestBlockHeight: bigint
  readonly syncing: boolean
}
const BlockResponse = Schema.Struct({
  header: Schema.Struct({
    hash,
    prev_hash: hash,
    height: u64,
    timestamp_nanosec: decimalU64,
    gas_price: u128,
  }),
})
const StatusResponse = Schema.Struct({
  chain_id: Schema.NonEmptyString,
  protocol_version: u32,
  sync_info: Schema.Struct({
    latest_block_hash: hash,
    latest_block_height: u64,
    syncing: Schema.Boolean,
  }),
})
export const block = Effect.fnUntraced(function* (
  client: Client,
  at?: At,
): Effect.fn.Return<Block, ReadError, HttpClient> {
  const reply = yield* request(client, "block", "block", () => {
    const selected = selection(at, "block")
    return { params: blockParams(selected), context: { at: selected } }
  })
  const { header } = yield* decode(BlockResponse, reply.value, "block")
  const result = {
    blockHash: header.hash,
    blockHeight: BigInt(header.height),
    previousHash: header.prev_hash,
    timestampNanoseconds: BigInt(header.timestamp_nanosec),
    gasPrice: BigInt(header.gas_price),
  }
  yield* checkBlock(result, reply.context.at, "block")
  return result
})
export const status = Effect.fnUntraced(function* (
  client: Client,
): Effect.fn.Return<Status, ReadError, HttpClient> {
  const reply = yield* request(client, "status", "status", () => ({
    params: [],
  }))
  const value = yield* decode(StatusResponse, reply.value, "status")
  return {
    chainId: value.chain_id,
    protocolVersion: value.protocol_version,
    latestBlockHash: value.sync_info.latest_block_hash,
    latestBlockHeight: BigInt(value.sync_info.latest_block_height),
    syncing: value.sync_info.syncing,
  }
})
/** Explicit selection: gas_price has no finality input or returned block provenance. */
export const gasPrice = Effect.fnUntraced(function* (
  client: Client,
  at: BlockId | "latest",
): Effect.fn.Return<bigint, ReadError, HttpClient> {
  const reply = yield* request(client, "gasPrice", "gas_price", () => {
    if (at === "latest") return { params: [null] }
    const selected = selection(at, "gasPrice")
    if (typeof selected === "string")
      return invalid("gasPrice", "BlockSelector")
    return {
      params: ["hash" in selected ? selected.hash : rawHeight(selected.height)],
      context: { at: selected },
    }
  })
  const value = yield* decode(
    Schema.Struct({ gas_price: u128 }),
    reply.value,
    "gasPrice",
  )
  return BigInt(value.gas_price)
})
