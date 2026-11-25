import { base64 } from "@scure/base"
import * as Effect from "effect/Effect"
import type { HttpClient } from "effect/http/HttpClient"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import type { At, BlockMetadata, Client } from "../client.js"
import { DecodeError, type ReadError } from "../errors.js"
import {
  bytes,
  checkBlock,
  decode,
  metadata,
  projectMetadata,
} from "../internal/decode.js"
import {
  accountId,
  blockParams,
  byteOrder,
  copyBytes,
  hasPrefix,
  invalid,
  plainRecord,
  prepare,
  selection,
} from "../internal/input.js"
import { request } from "../internal/wire.js"

export type StateOptions = {
  readonly at?: At
  readonly prefix?: Uint8Array
} & (
  | { readonly proof: true; readonly pageSize?: never; readonly after?: never }
  | {
      readonly proof?: false
      readonly pageSize?: number
      readonly after?: Uint8Array
    }
)
export interface StatePagesOptions {
  readonly at?: At
  readonly prefix?: Uint8Array
  readonly pageSize?: number
}
export interface StateEntry {
  readonly key: Uint8Array
  readonly value: Uint8Array
}
export interface StatePage extends BlockMetadata {
  readonly entries: readonly StateEntry[]
  readonly nextCursor?: Uint8Array
  readonly proof?: readonly Uint8Array[]
}
interface Input {
  readonly id: string
  readonly at: At
  readonly prefix: Uint8Array
  readonly proof: boolean
  readonly pageSize: number
  readonly after: Uint8Array | undefined
}
function input(
  id: string,
  options: StateOptions | undefined,
  operation: "statePage" | "statePages",
): Input {
  if (options !== undefined && !plainRecord(options))
    return invalid(operation, "Arguments")
  const prefix =
    options?.prefix === undefined
      ? new Uint8Array()
      : copyBytes(options.prefix, operation)
  const after =
    options?.after === undefined
      ? undefined
      : copyBytes(options.after, operation, "Pagination")
  const proof = options?.proof === true
  if (
    options?.proof !== undefined &&
    options.proof !== true &&
    options.proof !== false
  )
    return invalid(operation, "Arguments")
  if (proof && (options?.pageSize !== undefined || after !== undefined))
    return invalid(operation, "Pagination")
  const pageSize = options?.pageSize === undefined ? 100 : options.pageSize
  if (
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 10000 ||
    (after !== undefined && !hasPrefix(after, prefix))
  )
    return invalid(operation, "Pagination")
  return {
    id: accountId(id, operation),
    at: selection(options?.at, operation),
    prefix,
    after,
    proof,
    pageSize,
  }
}
const Response = Schema.Struct({
  ...metadata,
  values: Schema.Array(
    Schema.Struct({ key: Schema.String, value: Schema.String }),
  ),
  last_key: Schema.optionalKey(Schema.String),
  proof: Schema.optionalKey(Schema.Array(Schema.String)),
})
export const statePage = Effect.fnUntraced(function* (
  client: Client,
  id: string,
  options?: StateOptions,
): Effect.fn.Return<StatePage, ReadError, HttpClient> {
  let selected: Input | undefined
  const reply = yield* request(client, "statePage", "query", () => {
    const value = input(id, options, "statePage")
    selected = value
    return {
      params: {
        request_type: "view_state",
        account_id: value.id,
        prefix_base64: base64.encode(value.prefix),
        ...blockParams(value.at),
        ...(value.proof ? { include_proof: true } : { limit: value.pageSize }),
        ...(value.after === undefined
          ? {}
          : { after_key_base64: base64.encode(value.after) }),
      },
      context: { at: value.at, accountId: value.id },
    }
  })
  if (selected === undefined)
    return yield* new DecodeError({
      operation: "statePage",
      reason: "InvalidResponse",
    })
  const value = yield* decode(Response, reply.value, "statePage")
  const meta = projectMetadata(value)
  yield* checkBlock(meta, selected.at, "statePage")
  if (!selected.proof && value.values.length > selected.pageSize)
    return yield* new DecodeError({
      operation: "statePage",
      reason: "Pagination",
    })
  const entries: StateEntry[] = []
  let previous = selected.after
  for (const row of value.values) {
    const key = yield* bytes(row.key, "statePage")
    const data = yield* bytes(row.value, "statePage")
    if (
      !hasPrefix(key, selected.prefix) ||
      (previous !== undefined && byteOrder(key, previous) <= 0)
    )
      return yield* new DecodeError({
        operation: "statePage",
        reason: "Pagination",
      })
    entries.push({ key, value: data })
    previous = key
  }
  const nextCursor =
    value.last_key === undefined
      ? undefined
      : yield* bytes(value.last_key, "statePage")
  if (
    nextCursor !== undefined &&
    (selected.proof ||
      entries.length === 0 ||
      previous === undefined ||
      byteOrder(nextCursor, previous) !== 0 ||
      (selected.after !== undefined &&
        byteOrder(nextCursor, selected.after) <= 0))
  )
    return yield* new DecodeError({
      operation: "statePage",
      reason: "Pagination",
    })
  const decodedProof = yield* Effect.forEach(value.proof ?? [], (item) =>
    bytes(item, "statePage"),
  )
  const proof = selected.proof ? decodedProof : undefined
  return {
    ...meta,
    entries,
    ...(nextCursor === undefined ? {} : { nextCursor }),
    ...(proof === undefined ? {} : { proof }),
  }
})
/** Pull-based pages from one snapshot; native Stream operators own total budgets. */
export function statePages(
  client: Client,
  id: string,
  options?: StatePagesOptions,
): Stream.Stream<StatePage, ReadError, HttpClient> {
  return Stream.unwrap(
    Effect.gen(function* () {
      const initial = yield* prepare(() => {
        if (
          options !== undefined &&
          (!plainRecord(options) ||
            Object.hasOwn(options, "after") ||
            Object.hasOwn(options, "proof"))
        )
          return invalid("statePages", "Pagination")
        return input(id, options, "statePages")
      })
      interface Cursor {
        readonly at: At
        readonly after?: Uint8Array
        readonly height?: bigint
      }
      return Stream.paginate<Cursor, StatePage, ReadError, HttpClient>(
        { at: initial.at },
        (cursor) =>
          Effect.gen(function* () {
            const page = yield* statePage(client, initial.id, {
              at: cursor.at,
              prefix: initial.prefix,
              pageSize: initial.pageSize,
              ...(cursor.after === undefined ? {} : { after: cursor.after }),
            })
            if (
              cursor.height !== undefined &&
              cursor.height !== page.blockHeight
            )
              return yield* new DecodeError({
                operation: "statePages",
                reason: "BlockMismatch",
              })
            // Copy before yielding: the result's mutable buffers belong to its consumer.
            const next =
              page.nextCursor === undefined
                ? Option.none<Cursor>()
                : Option.some<Cursor>({
                    at: { hash: page.blockHash },
                    height: page.blockHeight,
                    after: new Uint8Array(page.nextCursor),
                  })
            return [[page], next] as const
          }),
      )
    }),
  )
}
