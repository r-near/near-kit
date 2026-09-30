import * as Effect from "effect/Effect"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import {
  DecodeError,
  type Operation,
  RequestError,
  RpcError,
} from "./errors.js"
import {
  blockParams,
  nonempty,
  prepare,
  selection,
  snapshotConfig,
  viewInput,
} from "./input.js"
import type { At, BlockMetadata, Client, Config, ViewOptions } from "./types.js"
import { decode, parseJson, request } from "./wire.js"

export type {
  Account,
  At,
  Block,
  BlockMetadata,
  Client,
  Config,
  JsonObject,
  JsonValue,
  Status,
  ViewOptions,
  ViewResult,
} from "./types.js"

/** Standard platform fetch, configured at construction to reject redirects.
 * Explicit caller overrides and borrowed clients retain their own policy.
 */
export const fetchLayer = FetchHttpClient.layer.pipe(
  Layer.provide(
    Layer.succeed(FetchHttpClient.RequestInit, { redirect: "error" }),
  ),
)

const U128 = "340282366920938463463374607431768211455"
const U64 = "18446744073709551615"
const decimal = (maximum: string) =>
  Schema.String.check(
    Schema.makeFilter(
      (value) =>
        value.length <= maximum.length &&
        /^(0|[1-9][0-9]*)$/.test(value) &&
        (value.length < maximum.length || value <= maximum),
    ),
  )
const u128 = decimal(U128)
const u64 = decimal(U64)
const metadata = {
  block_hash: Schema.NonEmptyString,
  block_height: Schema.Natural,
}
const optionalString = Schema.optionalKey(Schema.NullOr(Schema.NonEmptyString))
const AccountResponse = Schema.Struct({
  ...metadata,
  amount: u128,
  locked: u128,
  storage_usage: Schema.Natural,
  code_hash: Schema.NonEmptyString,
  global_contract_hash: optionalString,
  global_contract_account_id: optionalString,
})
const BlockResponse = Schema.Struct({
  header: Schema.Struct({
    hash: Schema.NonEmptyString,
    height: Schema.Natural,
    timestamp_nanosec: u64,
  }),
})
const StatusResponse = Schema.Struct({
  chain_id: Schema.NonEmptyString,
  protocol_version: Schema.Natural,
  sync_info: Schema.Struct({
    latest_block_hash: Schema.NonEmptyString,
    latest_block_height: Schema.Natural,
  }),
})
const ViewResponse = Schema.Struct({
  ...metadata,
  logs: Schema.Array(Schema.String),
  result: Schema.optionalKey(
    Schema.Array(Schema.Natural.check(Schema.isLessThanOrEqualTo(255))),
  ),
  error: Schema.optionalKey(Schema.String),
})

function checkBlock(metadata: BlockMetadata, at: At, operation: Operation) {
  if (
    typeof at !== "string" &&
    ("hash" in at
      ? at.hash !== metadata.blockHash
      : at.height !== metadata.blockHeight)
  ) {
    return Effect.fail(new DecodeError({ operation, reason: "BlockMismatch" }))
  }
  return Effect.void
}

/** A pure configuration value. Every read resolves its HttpClient at execution. */
export function make(config: Config): Client {
  const snapshot = snapshotConfig(config)

  const account: Client["account"] = Effect.fnUntraced(
    function* (accountId, options) {
      const input = yield* prepare(() => {
        const id = nonempty(accountId, "account", "AccountId")
        const at = selection(options?.at, "account")
        return {
          id,
          at,
          params: {
            request_type: "view_account",
            account_id: id,
            ...blockParams(at),
          },
        }
      })
      const raw = yield* request(
        snapshot,
        "account",
        "query",
        input.params,
        input.id,
      )
      const account = yield* decode(AccountResponse, raw, "account")
      const result = {
        amount: BigInt(account.amount),
        locked: BigInt(account.locked),
        storageUsage: account.storage_usage,
        codeHash: account.code_hash,
        blockHash: account.block_hash,
        blockHeight: account.block_height,
        ...(account.global_contract_hash == null
          ? {}
          : { globalContractHash: account.global_contract_hash }),
        ...(account.global_contract_account_id == null
          ? {}
          : { globalContractAccountId: account.global_contract_account_id }),
      }
      yield* checkBlock(result, input.at, "account")
      return result
    },
  )

  const block: Client["block"] = Effect.fnUntraced(function* (at) {
    const selected = yield* prepare(() => selection(at, "block"))
    const raw = yield* request(
      snapshot,
      "block",
      "block",
      blockParams(selected),
    )
    const block = yield* decode(BlockResponse, raw, "block")
    const result = {
      blockHash: block.header.hash,
      blockHeight: block.header.height,
      timestampNanoseconds: BigInt(block.header.timestamp_nanosec),
    }
    yield* checkBlock(result, selected, "block")
    return result
  })

  const status: Client["status"] = Effect.fnUntraced(function* () {
    const raw = yield* request(snapshot, "status", "status", [])
    const status = yield* decode(StatusResponse, raw, "status")
    return {
      chainId: status.chain_id,
      protocolVersion: status.protocol_version,
      latestBlockHash: status.sync_info.latest_block_hash,
      latestBlockHeight: status.sync_info.latest_block_height,
    }
  })

  const readView = Effect.fnUntraced(function* (
    input: ReturnType<typeof viewInput>,
    operation: "view" | "viewBytes",
  ) {
    const raw = yield* request(snapshot, operation, "query", input.params)
    const response = yield* decode(ViewResponse, raw, operation)
    if (
      Object.hasOwn(response, "result") === Object.hasOwn(response, "error")
    ) {
      return yield* new DecodeError({ operation, reason: "InvalidResponse" })
    }
    const metadata = {
      blockHash: response.block_hash,
      blockHeight: response.block_height,
    }
    yield* checkBlock(metadata, input.at, operation)
    if (response.error !== undefined)
      return yield* new RpcError({ operation, kind: "ContractExecution" })
    if (response.result === undefined)
      return yield* new DecodeError({ operation, reason: "InvalidResponse" })
    return {
      ...metadata,
      logs: response.logs,
      value: new Uint8Array(response.result),
    }
  })

  const viewBytes: Client["viewBytes"] = Effect.fnUntraced(function* (options) {
    const input = yield* prepare(() => viewInput(options, "viewBytes"))
    return yield* readView(input, "viewBytes")
  })

  const view = <S extends Schema.Constraint>(
    options: ViewOptions & { readonly schema: S },
  ) =>
    Effect.gen(function* () {
      const input = yield* prepare(() => {
        const input = viewInput(options, "view")
        if (!Schema.isSchema(options.schema))
          throw new RequestError({ operation: "view", reason: "ResultSchema" })
        return { ...input, schema: options.schema }
      })
      const result = yield* readView(input, "view")
      const json = yield* parseJson(result.value, "view")
      const value = yield* decode(input.schema, json, "view", "ResultSchema")
      return { ...result, value }
    })

  return Object.freeze({ account, block, status, view, viewBytes })
}
