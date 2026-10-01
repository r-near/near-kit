import * as Effect from "effect/Effect"
import type { HttpClient } from "effect/http/HttpClient"
import * as Schema from "effect/Schema"
import type { At, BlockMetadata, Client } from "../client.js"
import { DecodeError, type ReadError, RpcError } from "../errors.js"
import {
  checkBlock,
  decode,
  metadata,
  projectMetadata,
} from "../internal/decode.js"
import {
  accountId,
  argumentsBase64,
  blockParams,
  invalid,
  type JsonObject,
  plainRecord,
  prepare,
  selection,
} from "../internal/input.js"
import { parseJson } from "../internal/json.js"
import { request } from "../internal/wire.js"

export type { JsonObject, JsonValue } from "../internal/input.js"
export interface ViewOptions {
  readonly accountId: string
  readonly method: string
  readonly args?: JsonObject | Uint8Array
  readonly at?: At
}
export interface ViewResult<A> extends BlockMetadata {
  readonly value: A
  readonly logs: readonly string[]
}
const Response = Schema.Struct({
  ...metadata,
  logs: Schema.Array(Schema.String),
  result: Schema.optionalKey(
    Schema.Array(Schema.Natural.check(Schema.isLessThanOrEqualTo(255))),
  ),
  error: Schema.optionalKey(Schema.String),
})
const read = Effect.fnUntraced(function* (
  client: Client,
  options: ViewOptions,
  operation: "view" | "viewBytes",
) {
  const reply = yield* request(client, operation, "query", () => {
    if (!plainRecord(options)) return invalid(operation, "Arguments")
    const id = accountId(options.accountId, operation)
    const at = selection(options.at, operation)
    const method = options.method
    if (typeof method !== "string" || method.length === 0)
      return invalid(operation, "Method")
    return {
      params: {
        request_type: "call_function",
        account_id: id,
        method_name: method,
        args_base64: argumentsBase64(options.args, operation),
        ...blockParams(at),
      },
      context: { accountId: id, at },
    }
  })
  const response = yield* decode(Response, reply.value, operation)
  if (Object.hasOwn(response, "result") === Object.hasOwn(response, "error"))
    return yield* new DecodeError({ operation, reason: "InvalidResponse" })
  const meta = projectMetadata(response)
  yield* checkBlock(meta, reply.context.at, operation)
  if (response.error !== undefined)
    return yield* new RpcError({ operation, kind: "ContractExecution" })
  if (response.result === undefined)
    return yield* new DecodeError({ operation, reason: "InvalidResponse" })
  return {
    ...meta,
    logs: response.logs,
    value: new Uint8Array(response.result),
  }
})
export function viewBytes(
  client: Client,
  options: ViewOptions,
): Effect.Effect<ViewResult<Uint8Array>, ReadError, HttpClient> {
  return read(client, options, "viewBytes")
}
export function view<S extends Schema.Constraint>(
  client: Client,
  options: ViewOptions & { readonly schema: S },
): Effect.Effect<
  ViewResult<S["Type"]>,
  ReadError,
  HttpClient | S["DecodingServices"]
> {
  return Effect.gen(function* () {
    const schema = yield* prepare(() => {
      if (!plainRecord(options)) return invalid("view", "Arguments")
      const schema = options.schema
      if (!Schema.isSchema(schema)) return invalid("view", "ResultSchema")
      return schema
    })
    const result = yield* read(client, options, "view")
    const json = yield* parseJson(result.value, "view")
    const value = yield* decode(schema, json, "view", "ResultSchema")
    return { ...result, value }
  })
}
