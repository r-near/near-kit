/** Effect-owned configuration validation; public composition schemas are separate. */
import * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import {
  isPrivateKey,
  type Amount,
  type Gas,
  type PrivateKey,
} from "../utils/validation.js"
import type { KeyStore, Signer, WalletConnection } from "./types.js"
import { NETWORK_PRESETS } from "./constants.js"

export const NetworkPresetSchema = Schema.Literals([
  "mainnet",
  "testnet",
  "localnet",
  "betanet",
])
export type NetworkPreset = typeof NetworkPresetSchema.Type
export interface CustomNetworkConfig {
  rpcUrl: string
  networkId: string
}
export type NetworkConfig = NetworkPreset | CustomNetworkConfig
const RpcUrl = Schema.String.check(
  Schema.makeFilter(
    (value) => URL.canParse(value) || "RPC URL must be a valid URL",
  ),
)
export const CustomNetworkConfigSchema = Schema.Struct({
  rpcUrl: RpcUrl,
  networkId: Schema.NonEmptyString,
})
export const NetworkConfigSchema = Schema.Union([
  NetworkPresetSchema,
  CustomNetworkConfigSchema,
])
export const TxExecutionStatusSchema = Schema.Literals([
  "NONE",
  "INCLUDED",
  "EXECUTED_OPTIMISTIC",
  "INCLUDED_FINAL",
  "EXECUTED",
  "FINAL",
])
export interface CallOptions {
  gas?: Gas
  attachedDeposit?: Amount
  signerId?: string
  waitUntil?: typeof TxExecutionStatusSchema.Type
}
/** blockId takes precedence when both selectors are supplied. */
export interface BlockReference {
  finality?: "optimistic" | "near-final" | "final" | undefined
  blockId?: number | string | undefined
}

export const isKeyStore = (value: unknown): value is KeyStore =>
  typeof value === "object" &&
  value !== null &&
  "get" in value &&
  typeof value.get === "function" &&
  "add" in value &&
  typeof value.add === "function" &&
  "remove" in value &&
  typeof value.remove === "function" &&
  "list" in value &&
  typeof value.list === "function"
const Store = Schema.declare(isKeyStore)
const SignerSchema = Schema.declare(
  (value: unknown): value is Signer => typeof value === "function",
)
const WalletSchema = Schema.declare(
  (value: unknown): value is WalletConnection =>
    typeof value === "object" &&
    value !== null &&
    "getAccounts" in value &&
    typeof value.getAccounts === "function" &&
    "signAndSendTransaction" in value &&
    typeof value.signAndSendTransaction === "function",
)
const PrivateKeySchema = Schema.declare(
  (value: unknown): value is PrivateKey =>
    typeof value === "string" && isPrivateKey(value),
)
const NonnegativeInt = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
)
export const RpcRetryConfigSchema = Schema.Struct({
  maxRetries: Schema.optional(NonnegativeInt),
  initialDelayMs: Schema.optional(NonnegativeInt),
})
export interface RpcRetryConfigInput {
  maxRetries?: number | undefined
  initialDelayMs?: number | undefined
}
export const NearConfigSchema = Schema.Struct({
  network: Schema.optional(NetworkConfigSchema),
  rpcUrl: Schema.optional(RpcUrl),
  headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  keyStore: Schema.optional(
    Schema.Union([Store, Schema.Record(Schema.String, Schema.String)]),
  ),
  signer: Schema.optional(SignerSchema),
  privateKey: Schema.optional(
    Schema.Union([PrivateKeySchema, Schema.instanceOf(Uint8Array)]),
  ),
  wallet: Schema.optional(WalletSchema),
  defaultSignerId: Schema.optional(Schema.String),
  defaultWaitUntil: Schema.optional(TxExecutionStatusSchema),
  retryConfig: Schema.optional(RpcRetryConfigSchema),
})
export interface NearConfig {
  network?: NetworkConfig | undefined
  rpcUrl?: string | undefined
  headers?: Record<string, string> | undefined
  keyStore?: KeyStore | Record<string, string> | undefined
  signer?: Signer | undefined
  privateKey?: PrivateKey | Uint8Array
  wallet?: WalletConnection | undefined
  defaultSignerId?: string | undefined
  defaultWaitUntil?: typeof TxExecutionStatusSchema.Type | undefined
  retryConfig?: RpcRetryConfigInput | undefined
}

/** Environment selection belongs to the caller's ConfigProvider. */
export const resolveNetworkConfig = Effect.fn("Near.network")(function* (
  network?: NetworkConfig,
) {
  if (network !== undefined) {
    const value = yield* Schema.decodeEffect(NetworkConfigSchema)(network)
    return typeof value === "string" ? NETWORK_PRESETS[value] : value
  }
  const value = yield* Config.String("NEAR_NETWORK").pipe(
    Config.withDefault("mainnet"),
    Effect.orElseSucceed(() => "mainnet"),
  )
  return Schema.is(NetworkPresetSchema)(value)
    ? NETWORK_PRESETS[value]
    : NETWORK_PRESETS.mainnet
})
