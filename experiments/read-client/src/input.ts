import * as Effect from "effect/Effect"
import * as Base64 from "effect/encoding/Base64"
import { type Operation, RequestError } from "./errors.js"
import type { At, Config, ViewOptions } from "./types.js"

export interface Snapshot {
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
  readonly maxResponseBytes: number
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  )
}

/** Configuration is snapshotted now; a malformed snapshot fails only on execution. */
export function snapshotConfig(config: Config): Snapshot | undefined {
  if (!plainRecord(config) || typeof config.url !== "string") return undefined
  const maxResponseBytes =
    config.maxResponseBytes === undefined
      ? 2 * 1024 * 1024
      : config.maxResponseBytes
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes <= 0)
    return undefined
  if (config.headers !== undefined && !plainRecord(config.headers))
    return undefined
  if (
    Reflect.ownKeys(config.headers ?? {}).some((key) => typeof key !== "string")
  )
    return undefined
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(config.headers ?? {})) {
    if (typeof value !== "string") return undefined
    Object.defineProperty(headers, name, { value, enumerable: true })
  }
  try {
    const url = new URL(config.url)
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      config.url.includes("#")
    ) {
      return undefined
    }
    // Let the platform validate header names/values without making a request.
    new Headers(headers)
    return Object.freeze({
      url: url.href,
      headers: Object.freeze(headers),
      maxResponseBytes,
    })
  } catch (error) {
    if (error instanceof TypeError) return undefined
    throw error
  }
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

export function nonempty(
  value: unknown,
  operation: Operation,
  reason: "AccountId" | "Method",
): string {
  if (typeof value !== "string" || value.length === 0)
    throw new RequestError({ operation, reason })
  return value
}

export function selection(at: unknown, operation: Operation): At {
  if (at === undefined) return "final"
  if (at === "final" || at === "near-final" || at === "optimistic") return at
  if (plainRecord(at) && Reflect.ownKeys(at).length === 1) {
    if (
      Object.hasOwn(at, "hash") &&
      typeof at.hash === "string" &&
      at.hash.length > 0
    )
      return { hash: at.hash }
    if (
      Object.hasOwn(at, "height") &&
      typeof at.height === "number" &&
      Number.isSafeInteger(at.height) &&
      at.height >= 0
    ) {
      return { height: at.height }
    }
  }
  throw new RequestError({ operation, reason: "BlockSelector" })
}

export function blockParams(
  at: At,
): { finality: string } | { block_id: string | number } {
  return typeof at === "string"
    ? { finality: at }
    : { block_id: "hash" in at ? at.hash : at.height }
}

function jsonValue(
  value: unknown,
  active: Set<object>,
  invalid: () => never,
): void {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return
  if (typeof value === "number" && Number.isFinite(value)) return
  if (typeof value !== "object" || value === null || active.has(value))
    invalid()
  if (!Array.isArray(value) && !plainRecord(value)) invalid()
  active.add(value)
  const keys = Reflect.ownKeys(value)
  if (Array.isArray(value) && keys.length !== value.length + 1) invalid()
  for (const key of keys) {
    if (Array.isArray(value) && key === "length") continue
    if (typeof key !== "string") invalid()
    const property = Object.getOwnPropertyDescriptor(value, key)
    if (!property?.enumerable || !Object.hasOwn(property, "value")) invalid()
    if (
      Array.isArray(value) &&
      (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)
    )
      invalid()
    jsonValue(property.value, active, invalid)
  }
  active.delete(value)
}

export function viewInput(
  options: ViewOptions,
  operation: "view" | "viewBytes",
) {
  if (!plainRecord(options))
    throw new RequestError({ operation, reason: "Arguments" })
  const accountId = nonempty(options.accountId, operation, "AccountId")
  const method = nonempty(options.method, operation, "Method")
  const at = selection(options.at, operation)
  const args = options.args === undefined ? {} : options.args
  const invalid = (): never => {
    throw new RequestError({ operation, reason: "Arguments" })
  }
  let encoded: string
  if (args instanceof Uint8Array) {
    try {
      encoded = Base64.encode(new Uint8Array(args))
    } catch (error) {
      if (error instanceof TypeError) return invalid()
      throw error
    }
  } else {
    if (!plainRecord(args)) return invalid()
    try {
      jsonValue(args, new Set(), invalid)
      encoded = Base64.encode(JSON.stringify(args))
    } catch (error) {
      // Native JSON has a finite nesting/string-size limit. Unsupported
      // input should still fail as a request error, without its contents.
      if (error instanceof RangeError) return invalid()
      throw error
    }
  }
  return {
    accountId,
    at,
    params: {
      request_type: "call_function",
      account_id: accountId,
      method_name: method,
      args_base64: encoded,
      ...blockParams(at),
    },
  }
}
