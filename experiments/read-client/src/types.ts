import type * as Effect from "effect/Effect"
import type { HttpClient } from "effect/http/HttpClient"
import type * as Schema from "effect/Schema"
import type { ReadError } from "./errors.js"

export type At =
  | "final"
  | "near-final"
  | "optimistic"
  | { readonly hash: string }
  | { readonly height: number }

export interface Config {
  readonly url: string
  readonly headers?: Readonly<Record<string, string>>
  /** Limit for the complete JSON-RPC response body; defaults to 2 MiB. */
  readonly maxResponseBytes?: number
}

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonObject
  | ReadonlyArray<JsonValue>
export interface JsonObject {
  readonly [key: string]: JsonValue
}

export interface BlockMetadata {
  readonly blockHash: string
  readonly blockHeight: number
}

export interface Account extends BlockMetadata {
  /** Exact yoctoNEAR quantities; not estimates of spendable balance. */
  readonly amount: bigint
  readonly locked: bigint
  readonly storageUsage: number
  readonly codeHash: string
  readonly globalContractHash?: string
  readonly globalContractAccountId?: string
}

export interface Block extends BlockMetadata {
  readonly timestampNanoseconds: bigint
}

export interface Status {
  readonly chainId: string
  readonly protocolVersion: number
  readonly latestBlockHash: string
  readonly latestBlockHeight: number
}

export interface ViewOptions {
  readonly accountId: string
  readonly method: string
  readonly args?: JsonObject | Uint8Array
  readonly at?: At
}

export interface ViewResult<A> extends BlockMetadata {
  readonly value: A
  readonly logs: ReadonlyArray<string>
}

export interface Client {
  readonly account: (
    accountId: string,
    options?: { readonly at?: At },
  ) => Effect.Effect<Account, ReadError, HttpClient>
  readonly block: (at?: At) => Effect.Effect<Block, ReadError, HttpClient>
  readonly status: () => Effect.Effect<Status, ReadError, HttpClient>
  readonly view: <S extends Schema.Constraint>(
    options: ViewOptions & { readonly schema: S },
  ) => Effect.Effect<
    ViewResult<S["Type"]>,
    ReadError,
    HttpClient | S["DecodingServices"]
  >
  readonly viewBytes: (
    options: ViewOptions,
  ) => Effect.Effect<ViewResult<Uint8Array>, ReadError, HttpClient>
}
