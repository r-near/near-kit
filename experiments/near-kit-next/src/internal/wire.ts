import * as Effect from "effect/Effect"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import { type At, type Client, getSnapshot } from "../client.js"
import {
  AccessKeyNotFound,
  AccountNotFound,
  DecodeError,
  HttpError,
  type Operation,
  RequestError,
  RpcError,
  TransportError,
} from "../errors.js"
import {
  checkBlock,
  decode,
  hash,
  metadata,
  projectMetadata,
  u64,
} from "./decode.js"
import { plainRecord, prepare } from "./input.js"
import { parseJson, requireNativeJson } from "./json.js"

export interface Context {
  readonly at?: At
  readonly accountId?: string
  readonly publicKey?: string
  readonly global?: { readonly hash: string } | { readonly publisher: string }
}
interface Request {
  readonly params: object
  readonly context?: Context
}
type Method =
  | "query"
  | "block"
  | "status"
  | "gas_price"
  | "genesis_config"
  | "maintenance_windows"
  | "block_effects"
const Envelope = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  id: Schema.Unknown,
  result: Schema.optionalKey(Schema.Unknown),
  error: Schema.optionalKey(Schema.Unknown),
})
const Failure = Schema.Struct({
  code: Schema.Int,
  message: Schema.String,
  name: Schema.optionalKey(Schema.Unknown),
  cause: Schema.optionalKey(Schema.Unknown),
})
const BlockReference = Schema.Union([
  Schema.Struct({ block_id: Schema.Union([hash, u64]) }),
  Schema.Struct({
    finality: Schema.Literals(["final", "near-final", "optimistic"]),
  }),
  Schema.Struct({
    sync_checkpoint: Schema.Literals(["genesis", "earliest_available"]),
  }),
])
const errorMetadata = Schema.Struct(metadata)
const accountError = Schema.Struct({
  ...metadata,
  requested_account_id: Schema.String,
})
const keyError = Schema.Struct({ ...metadata, public_key: Schema.String })
const contractError = Schema.Struct({
  ...metadata,
  contract_account_id: Schema.String,
})
const executionError = Schema.Struct({ ...metadata, vm_error: Schema.String })
const globalError = Schema.Struct({
  ...metadata,
  identifier: Schema.Union([
    Schema.Struct({ hash }),
    Schema.Struct({ account_id: Schema.String }),
  ]),
})
const match = (yes: boolean, operation: Operation) =>
  yes
    ? Effect.void
    : Effect.fail(new DecodeError({ operation, reason: "IdentifierMismatch" }))

const rpcFailure = Effect.fnUntraced(function* (
  input: unknown,
  operation: Operation,
  context: Context,
) {
  const error = yield* decode(Failure, input, operation, "InvalidEnvelope")
  if (error.code === -32601)
    return yield* new RpcError({
      operation,
      code: error.code,
      kind: "MethodNotFound",
    })
  let kind: RpcError["kind"] = "Unknown"
  const cause = error.cause
  if (error.name === "HANDLER_ERROR" && plainRecord(cause)) {
    const info = cause.info
    switch (cause.name) {
      case "UNKNOWN_ACCOUNT": {
        if (context.accountId === undefined) break
        const value = yield* decode(
          accountError,
          info,
          operation,
          "InvalidEnvelope",
        )
        yield* checkBlock(projectMetadata(value), context.at, operation)
        yield* match(
          value.requested_account_id === context.accountId,
          operation,
        )
        return yield* new AccountNotFound({
          operation,
          accountId: context.accountId,
        })
      }
      case "UNKNOWN_ACCESS_KEY":
      case "UNKNOWN_GAS_KEY": {
        if (context.publicKey === undefined || context.accountId === undefined)
          break
        const value = yield* decode(
          keyError,
          info,
          operation,
          "InvalidEnvelope",
        )
        yield* checkBlock(projectMetadata(value), context.at, operation)
        yield* match(value.public_key === context.publicKey, operation)
        if (cause.name === "UNKNOWN_ACCESS_KEY")
          return yield* new AccessKeyNotFound({
            operation,
            accountId: context.accountId,
            publicKey: context.publicKey,
          })
        kind = "GasKeyUnavailable"
        break
      }
      case "NO_CONTRACT_CODE":
      case "TOO_LARGE_CONTRACT_STATE": {
        if (context.accountId === undefined) break
        const value = yield* decode(
          contractError,
          info,
          operation,
          "InvalidEnvelope",
        )
        yield* checkBlock(projectMetadata(value), context.at, operation)
        yield* match(value.contract_account_id === context.accountId, operation)
        kind =
          cause.name === "NO_CONTRACT_CODE"
            ? "CodeUnavailable"
            : "StateTooLarge"
        break
      }
      case "NO_GLOBAL_CONTRACT_CODE": {
        if (context.global === undefined) break
        if (
          !plainRecord(info) ||
          !plainRecord(info.identifier) ||
          Reflect.ownKeys(info.identifier).length !== 1
        )
          return yield* new DecodeError({
            operation,
            reason: "InvalidEnvelope",
          })
        const value = yield* decode(
          globalError,
          info,
          operation,
          "InvalidEnvelope",
        )
        yield* checkBlock(projectMetadata(value), context.at, operation)
        const expected = context.global
        yield* match(
          "hash" in expected
            ? "hash" in value.identifier &&
                value.identifier.hash === expected.hash
            : "account_id" in value.identifier &&
                value.identifier.account_id === expected.publisher,
          operation,
        )
        kind = "GlobalCodeUnavailable"
        break
      }
      case "CONTRACT_EXECUTION_ERROR": {
        const value = yield* decode(
          executionError,
          info,
          operation,
          "InvalidEnvelope",
        )
        yield* checkBlock(projectMetadata(value), context.at, operation)
        kind = "ContractExecution"
        break
      }
      case "GARBAGE_COLLECTED_BLOCK": {
        const value = yield* decode(
          errorMetadata,
          info,
          operation,
          "InvalidEnvelope",
        )
        yield* checkBlock(projectMetadata(value), context.at, operation)
        kind = "PrunedBlock"
        break
      }
      case "UNKNOWN_BLOCK": {
        // These handlers skip their diagnostic field when serializing info.
        const directBlock =
          operation === "block" ||
          operation === "gasPrice" ||
          operation === "blockEffects"
        if (
          !plainRecord(info) ||
          (!directBlock && !Object.hasOwn(info, "block_reference"))
        )
          return yield* new DecodeError({
            operation,
            reason: "InvalidEnvelope",
          })
        if (!directBlock) {
          const rawReference = info.block_reference
          if (
            !plainRecord(rawReference) ||
            Reflect.ownKeys(rawReference).length !== 1
          )
            return yield* new DecodeError({
              operation,
              reason: "InvalidEnvelope",
            })
          const reference = yield* decode(
            BlockReference,
            rawReference,
            operation,
            "InvalidEnvelope",
          )
          const at = context.at
          if (at !== undefined) {
            const equal =
              typeof at === "string"
                ? "finality" in reference && reference.finality === at
                : "block_id" in reference &&
                  ("hash" in at
                    ? typeof reference.block_id === "string" &&
                      reference.block_id === at.hash
                    : typeof reference.block_id !== "string" &&
                      BigInt(reference.block_id) === at.height)
            if (!equal)
              return yield* new DecodeError({
                operation,
                reason: "BlockMismatch",
              })
          }
        }
        kind = "UnknownBlock"
        break
      }
      case "NO_SYNCED_BLOCKS":
        kind = "NodeNotSynced"
        break
      case "NOT_SYNCED_YET":
        if (operation === "block" || operation === "blockEffects")
          kind = "NodeNotSynced"
        break
      case "SHARD_NOT_APPLIED":
        if (operation === "blockEffects") {
          yield* decode(
            Schema.Struct({ shard_id: u64 }),
            info,
            operation,
            "InvalidEnvelope",
          )
          kind = "ShardUnavailable"
        }
        break
      case "UNAVAILABLE_SHARD":
        yield* decode(
          Schema.Struct({ requested_shard_id: u64 }),
          info,
          operation,
          "InvalidEnvelope",
        )
        kind = "ShardUnavailable"
        break
    }
  }
  return yield* new RpcError({ operation, code: error.code, kind })
})

const unwrap = Effect.fnUntraced(function* (
  input: unknown,
  id: string,
  operation: Operation,
  context: Context,
) {
  const envelope = yield* decode(Envelope, input, operation, "InvalidEnvelope")
  if (envelope.id !== id)
    return yield* new DecodeError({ operation, reason: "MismatchedId" })
  if (Object.hasOwn(envelope, "result") === Object.hasOwn(envelope, "error"))
    return yield* new DecodeError({ operation, reason: "InvalidEnvelope" })
  return Object.hasOwn(envelope, "result")
    ? envelope.result
    : yield* rpcFailure(envelope.error, operation, context)
})

/** One attempt; scope covers request, full streamed body and envelope decoding. */
export const request = Effect.fnUntraced(function* (
  client: Client,
  operation: Operation,
  method: Method,
  build: () => Request,
) {
  const config = getSnapshot(client)
  if (config === undefined)
    return yield* new RequestError({ operation, reason: "Configuration" })
  yield* requireNativeJson(operation)
  const input = yield* prepare(build)
  const context = input.context ?? {}
  const id = crypto.getRandomValues(new Uint32Array(4)).join("-")
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id,
    method,
    params: input.params,
  })
  const value = yield* Effect.gen(function* () {
    const http = HttpClient.withScope(yield* HttpClient.HttpClient)
    const response = yield* http
      .execute(
        HttpClientRequest.post(config.url).pipe(
          HttpClientRequest.setHeaders(config.headers),
          HttpClientRequest.bodyText(body, "application/json"),
        ),
      )
      .pipe(
        Effect.mapError(
          () => new TransportError({ operation, phase: "Request" }),
        ),
      )
    if (response.status < 200 || response.status >= 300)
      return yield* new HttpError({ operation, status: response.status })
    let bytes = new Uint8Array(Math.min(4096, config.maxResponseBytes))
    let size = 0
    yield* response.stream.pipe(
      Stream.mapError((error) =>
        error.reason._tag === "EmptyBodyError"
          ? new DecodeError({ operation, reason: "InvalidEnvelope" })
          : new TransportError({ operation, phase: "Body" }),
      ),
      Stream.runForEach((chunk) =>
        Effect.suspend(() => {
          if (chunk.byteLength > config.maxResponseBytes - size)
            return Effect.fail(
              new DecodeError({ operation, reason: "BodyTooLarge" }),
            )
          const needed = size + chunk.byteLength
          if (needed > bytes.byteLength) {
            const grown = new Uint8Array(
              Math.min(
                config.maxResponseBytes,
                Math.max(needed, bytes.byteLength * 2),
              ),
            )
            grown.set(bytes)
            bytes = grown
          }
          bytes.set(chunk, size)
          size = needed
          return Effect.void
        }),
      ),
    )
    const json = yield* parseJson(bytes.subarray(0, size), operation, true)
    return yield* unwrap(json, id, operation, context)
  }).pipe(
    Effect.scoped,
    Effect.provideService(HttpClient.TracerDisabledWhen, () => true),
  )
  return { value, context }
})
