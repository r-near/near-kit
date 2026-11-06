import { base64 } from "@scure/base"
import * as Effect from "effect/Effect"
import type { At } from "../client.js"
import { parseAccountId, parseHash, parsePublicKey } from "../data.js"
import { type Operation, RequestError } from "../errors.js"
import { U64_MAX } from "./decode.js"
import { isJsonResourceError, isRawJson, rawHeight } from "./json.js"

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonObject
  | readonly JsonValue[]
export interface JsonObject {
  readonly [key: string]: JsonValue
}
export function plainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  )
}
export function prepare<A>(run: () => A): Effect.Effect<A, RequestError> {
  return Effect.try({
    try: run,
    catch: (error) => {
      if (error instanceof RequestError) return error
      throw error
    },
  })
}
export function invalid(
  operation: Operation,
  reason: RequestError["reason"],
): never {
  throw new RequestError({ operation, reason })
}
function publicInput<A>(
  operation: Operation,
  reason: RequestError["reason"],
  run: () => A,
): A {
  try {
    return run()
  } catch (error) {
    if (error instanceof TypeError || error instanceof RangeError)
      return invalid(operation, reason)
    throw error
  }
}
export function accountId(value: string, operation: Operation) {
  return publicInput(operation, "AccountId", () => parseAccountId(value))
}
export function codeHash(value: string, operation: Operation) {
  publicInput(operation, "Hash", () => parseHash(value))
  return value
}
export function publicKey(value: string, operation: Operation) {
  const parsed = publicInput(operation, "PublicKey", () =>
    parsePublicKey(value),
  )
  if (parsed.kind === "ml-dsa-65-hash") return invalid(operation, "PublicKey")
  return value
}
export function selection(value: unknown, operation: Operation): At {
  if (value === undefined) return "final"
  if (value === "final" || value === "near-final" || value === "optimistic")
    return value
  if (plainRecord(value) && Reflect.ownKeys(value).length === 1) {
    if (Object.hasOwn(value, "hash") && typeof value.hash === "string")
      return { hash: codeHash(value.hash, operation) }
    if (
      Object.hasOwn(value, "height") &&
      typeof value.height === "bigint" &&
      value.height >= 0n &&
      value.height <= U64_MAX
    )
      return { height: value.height }
  }
  return invalid(operation, "BlockSelector")
}
export function blockParams(at: At): object {
  return typeof at === "string"
    ? { finality: at }
    : { block_id: "hash" in at ? at.hash : rawHeight(at.height) }
}
function validateJson(
  value: unknown,
  active: Set<object>,
  operation: Operation,
): void {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return
  if (typeof value === "number" && Number.isFinite(value)) return
  if (
    typeof value !== "object" ||
    value === null ||
    active.has(value) ||
    isRawJson(value)
  )
    invalid(operation, "Arguments")
  if (!Array.isArray(value) && !plainRecord(value))
    invalid(operation, "Arguments")
  active.add(value)
  const keys = Reflect.ownKeys(value)
  if (Array.isArray(value) && keys.length !== value.length + 1)
    invalid(operation, "Arguments")
  for (const key of keys) {
    if (Array.isArray(value) && key === "length") continue
    if (typeof key !== "string") invalid(operation, "Arguments")
    const property = Object.getOwnPropertyDescriptor(value, key)
    if (!property?.enumerable || !Object.hasOwn(property, "value"))
      invalid(operation, "Arguments")
    if (
      Array.isArray(value) &&
      (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)
    )
      invalid(operation, "Arguments")
    validateJson(property.value, active, operation)
  }
  active.delete(value)
}
export function argumentsBase64(
  value: JsonObject | Uint8Array | undefined,
  operation: Operation,
): string {
  try {
    if (value instanceof Uint8Array) return base64.encode(new Uint8Array(value))
    const args = value === undefined ? {} : value
    if (!plainRecord(args)) return invalid(operation, "Arguments")
    validateJson(args, new Set(), operation)
    return base64.encode(new TextEncoder().encode(JSON.stringify(args)))
  } catch (error) {
    if (error instanceof TypeError || isJsonResourceError(error))
      return invalid(operation, "Arguments")
    throw error
  }
}
export function copyBytes(
  value: unknown,
  operation: Operation,
  reason: RequestError["reason"] = "Arguments",
): Uint8Array {
  if (!(value instanceof Uint8Array)) return invalid(operation, reason)
  return publicInput(operation, reason, () => new Uint8Array(value))
}
export function byteOrder(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0)
    if (difference !== 0) return difference
  }
  return a.length - b.length
}
export function hasPrefix(value: Uint8Array, prefix: Uint8Array): boolean {
  return (
    value.length >= prefix.length &&
    prefix.every((byte, index) => value[index] === byte)
  )
}
