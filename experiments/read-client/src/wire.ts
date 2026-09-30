import { Effect, Schema, Stream } from "effect"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import { AccountNotFound, DecodeError, HttpError, RequestError, RpcError, TransportError, type Operation } from "./errors.js"
import type { Snapshot } from "./input.js"

/** Internal decoder: never return the schema issue (which contains untrusted input). */
export function decode<S extends Schema.Constraint>(
  schema: S,
  value: unknown,
  operation: Operation,
  reason: DecodeError["reason"] = "InvalidResponse",
) {
  return Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError(() => new DecodeError({ operation, reason })),
  )
}

export function parseJson(bytes: Uint8Array, operation: Operation) {
  return Effect.gen(function* () {
    const text = yield* Effect.try({
      try: () => new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      catch: (error) => {
        if (error instanceof TypeError) return new DecodeError({ operation, reason: "InvalidUtf8" })
        throw error
      },
    })
    return yield* Effect.try({
      try: (): unknown => JSON.parse(text),
      catch: (error) => {
        if (error instanceof SyntaxError) return new DecodeError({ operation, reason: "InvalidJson" })
        throw error
      },
    })
  })
}

const Envelope = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  id: Schema.Unknown,
  result: Schema.optionalKey(Schema.Unknown),
  error: Schema.optionalKey(Schema.Unknown),
})

const RpcFailure = Schema.Struct({
  code: Schema.Int,
  message: Schema.String,
  // These are NEAR extensions, not JSON-RPC's required shape. Unknown
  // extensions remain opaque unless they identify a supported branch below.
  name: Schema.optionalKey(Schema.Unknown),
  cause: Schema.optionalKey(Schema.Unknown),
})

const AbsentAccount = Schema.Struct({
  requested_account_id: Schema.NonEmptyString,
  block_height: Schema.Natural,
  block_hash: Schema.NonEmptyString,
})

const ContractFailure = Schema.Struct({
  vm_error: Schema.String,
  block_height: Schema.Natural,
  block_hash: Schema.NonEmptyString,
})

const unwrap = Effect.fnUntraced(function* (input: unknown, id: string, operation: Operation, accountId?: string) {
  const envelope = yield* decode(Envelope, input, operation, "InvalidEnvelope")
  if (envelope.id !== id) return yield* new DecodeError({ operation, reason: "MismatchedId" })
  if (Object.hasOwn(envelope, "result") === Object.hasOwn(envelope, "error")) {
    return yield* new DecodeError({ operation, reason: "InvalidEnvelope" })
  }
  if (Object.hasOwn(envelope, "result")) return envelope.result
  const error = yield* decode(RpcFailure, envelope.error, operation, "InvalidEnvelope")
  const cause = error.cause
  if (error.name === "HANDLER_ERROR" && typeof cause === "object" && cause !== null && "name" in cause) {
    const details = "info" in cause ? cause.info : undefined
    if (cause.name === "UNKNOWN_ACCOUNT" && operation === "account") {
      const info = yield* decode(AbsentAccount, details, operation, "InvalidEnvelope")
      if (info.requested_account_id !== accountId) return yield* new DecodeError({ operation, reason: "AccountMismatch" })
      return yield* new AccountNotFound({ operation, accountId: info.requested_account_id })
    }
    if (cause.name === "CONTRACT_EXECUTION_ERROR") {
      yield* decode(ContractFailure, details, operation, "InvalidEnvelope")
      return yield* new RpcError({ operation, code: error.code, kind: "ContractExecution" })
    }
  }
  return yield* new RpcError({ operation, code: error.code, kind: "Unknown" })
})

/** One exchange. The nested scope includes headers, every body chunk and decoding. */
export const request = Effect.fnUntraced(function* (
  config: Snapshot | undefined,
  operation: Operation,
  method: "query" | "block" | "status",
  params: object,
  accountId?: string,
) {
  if (config === undefined) return yield* new RequestError({ operation, reason: "Configuration" })
  const id = crypto.getRandomValues(new Uint32Array(4)).join("-")
  const body = JSON.stringify({ jsonrpc: "2.0", id, method, params })
  return yield* Effect.gen(function* () {
    const client = HttpClient.withScope(yield* HttpClient.HttpClient)
    const response = yield* client.execute(
      HttpClientRequest.post(config.url).pipe(
        HttpClientRequest.setHeaders(config.headers),
        HttpClientRequest.bodyText(body, "application/json"),
      ),
    ).pipe(Effect.mapError(() => new TransportError({ operation, phase: "Request" })))
    if (response.status < 200 || response.status >= 300) return yield* new HttpError({ operation, status: response.status })
    const chunks: Uint8Array[] = []
    let size = 0
    yield* response.stream.pipe(
      Stream.mapError((error) => error.reason._tag === "EmptyBodyError"
        ? new DecodeError({ operation, reason: "InvalidEnvelope" })
        : new TransportError({ operation, phase: "Body" })),
      Stream.runForEach((chunk) => Effect.suspend(() => {
        if (chunk.byteLength > config.maxResponseBytes - size) {
          return Effect.fail(new DecodeError({ operation, reason: "BodyTooLarge" }))
        }
        if (chunk.byteLength > 0) {
          chunks.push(new Uint8Array(chunk))
          size += chunk.byteLength
        }
        return Effect.void
      })),
    )
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    const json = yield* parseJson(bytes, operation)
    return yield* unwrap(json, id, operation, accountId)
  }).pipe(
    Effect.scoped,
    // No automatic library spans: neither successful values nor error exits
    // should hand application data to a tracer. Borrowed middleware owns its logs.
    Effect.provideService(HttpClient.TracerDisabledWhen, () => true),
  )
})
