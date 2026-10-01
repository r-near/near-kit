import { base64 } from "@scure/base"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import type { At, BlockMetadata } from "../client.js"
import { formatHash, parseHash } from "../data.js"
import { DecodeError, type Operation } from "../errors.js"

export const U64_MAX = 18446744073709551615n
export const U128_MAX = 340282366920938463463374607431768211455n
export const u64 = Schema.Union([Schema.Natural, Schema.BigInt]).check(
  Schema.makeFilter((value) => value >= 0 && value <= U64_MAX),
)
export const u32 = Schema.Natural.check(Schema.isLessThanOrEqualTo(4294967295))
export const u16 = Schema.Natural.check(Schema.isLessThanOrEqualTo(65535))
export const decimal = (max: bigint) =>
  Schema.String.check(
    Schema.makeFilter((value) => {
      const bound = max.toString()
      return (
        value.length <= bound.length &&
        /^(0|[1-9][0-9]*)$/.exec(value)?.[0] === value &&
        (value.length < bound.length || value <= bound)
      )
    }),
  )
export const u128 = decimal(U128_MAX)
export const decimalU64 = decimal(U64_MAX)
export const hash = Schema.String.check(
  Schema.makeFilter((value) => {
    try {
      return formatHash(parseHash(value)) === value
    } catch {
      return false
    }
  }),
)
export const metadata = { block_hash: hash, block_height: u64 }
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
export function projectMetadata(value: {
  readonly block_hash: string
  readonly block_height: number | bigint
}): BlockMetadata {
  return {
    blockHash: value.block_hash,
    blockHeight: BigInt(value.block_height),
  }
}
export function checkBlock(
  value: BlockMetadata,
  at: At | undefined,
  operation: Operation,
) {
  if (
    at !== undefined &&
    typeof at !== "string" &&
    ("hash" in at
      ? at.hash !== value.blockHash
      : at.height !== value.blockHeight)
  )
    return Effect.fail(new DecodeError({ operation, reason: "BlockMismatch" }))
  return Effect.void
}
export function bytes(
  value: string,
  operation: Operation,
): Effect.Effect<Uint8Array, DecodeError> {
  return Effect.try({
    try: () => base64.decode(value),
    catch: () => new DecodeError({ operation, reason: "InvalidResponse" }),
  })
}
