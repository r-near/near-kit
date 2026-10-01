import * as FetchHttpClient from "effect/http/FetchHttpClient"
import * as Layer from "effect/Layer"

export interface Config {
  readonly url: string
  readonly headers?: Readonly<Record<string, string>>
  readonly maxResponseBytes?: number
}
export type BlockId = { readonly hash: string } | { readonly height: bigint }
export type At = "final" | "near-final" | "optimistic" | BlockId
export interface BlockMetadata {
  readonly blockHash: string
  readonly blockHeight: bigint
}
declare const ClientTypeId: unique symbol
/** Immutable endpoint configuration, without a runtime, methods or a live HTTP client. */
export interface Client {
  readonly [ClientTypeId]: typeof ClientTypeId
}
export interface Snapshot {
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
  readonly maxResponseBytes: number
}
const snapshots = new WeakMap<object, Snapshot | undefined>()

function plainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  )
}
function snapshot(config: Config): Snapshot | undefined {
  if (!plainRecord(config) || typeof config.url !== "string") return undefined
  const limit =
    config.maxResponseBytes === undefined
      ? 2 * 1024 * 1024
      : config.maxResponseBytes
  if (!Number.isSafeInteger(limit) || limit <= 0) return undefined
  if (config.headers !== undefined && !plainRecord(config.headers))
    return undefined
  const headers: Record<string, string> = {}
  for (const key of Reflect.ownKeys(config.headers ?? {})) {
    const descriptor = Object.getOwnPropertyDescriptor(
      config.headers ?? {},
      key,
    )
    if (
      typeof key !== "string" ||
      !descriptor?.enumerable ||
      !Object.hasOwn(descriptor, "value") ||
      typeof descriptor.value !== "string"
    )
      return undefined
    Object.defineProperty(headers, key, {
      value: descriptor.value,
      enumerable: true,
    })
  }
  try {
    const url = new URL(config.url)
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      config.url.includes("#")
    )
      return undefined
    new Headers(headers)
    return Object.freeze({
      url: url.href,
      headers: Object.freeze(headers),
      maxResponseBytes: limit,
    })
  } catch (error) {
    if (error instanceof TypeError) return undefined
    throw error
  }
}
/** Pure construction. Invalid configuration fails when an operation executes. */
export function make(config: Config): Client {
  const client = Object.freeze({}) as Client
  snapshots.set(client, snapshot(config))
  return client
}
/** Internal; not part of the package export map. */
export function getSnapshot(client: Client): Snapshot | undefined {
  return snapshots.get(client)
}
/** A standard Fetch layer. Explicit borrowed RequestInit settings remain caller-owned. */
export const fetchLayer = FetchHttpClient.layer.pipe(
  Layer.provide(
    Layer.succeed(FetchHttpClient.RequestInit, { redirect: "error" }),
  ),
)
