/**
 * Zod schemas for NEAR client configuration.
 *
 * @remarks
 * These schemas validate network, call options, and {@link NearConfig} input.
 * Most applications should use the higher-level {@link Near} API and treat
 * these schemas as an implementation detail.
 */
import { z } from "zod"
import { type PrivateKey, PrivateKeySchema } from "../utils/validation.js"
import { NETWORK_PRESETS } from "./constants.js"

// ==================== Network Config Schema ====================

/**
 * Schema for network presets (mainnet, testnet, localnet)
 */
export const NetworkPresetSchema = z.enum(["mainnet", "testnet", "localnet"])

/**
 * Schema for custom network configuration
 */
export const CustomNetworkConfigSchema = z.object({
  rpcUrl: z.string().url("RPC URL must be a valid URL"),
  networkId: z.string().min(1, "Network ID is required"),
  nodeUrl: z.string().url("Node URL must be a valid URL").optional(),
  walletUrl: z.string().url("Wallet URL must be a valid URL").optional(),
  helperUrl: z.string().url("Helper URL must be a valid URL").optional(),
})

/**
 * Schema for network configuration (preset or custom)
 */
export const NetworkConfigSchema = z.union([
  NetworkPresetSchema,
  CustomNetworkConfigSchema,
])

export type NetworkPreset = z.infer<typeof NetworkPresetSchema>
export type CustomNetworkConfig = z.infer<typeof CustomNetworkConfigSchema>
export type NetworkConfig = z.infer<typeof NetworkConfigSchema>

// ==================== Transaction Execution Status Schema ====================

/**
 * Schema for transaction execution status
 */
export const TxExecutionStatusSchema = z.enum([
  "NONE",
  "INCLUDED",
  "EXECUTED_OPTIMISTIC",
  "INCLUDED_FINAL",
  "EXECUTED",
  "FINAL",
])

// ==================== Call Options Schema ====================

/**
 * Schema for function call options
 */
export const CallOptionsSchema = z.object({
  gas: z.string().optional(),
  attachedDeposit: z.union([z.string(), z.bigint()]).optional(),
  signerId: z.string().optional(),
  waitUntil: TxExecutionStatusSchema.optional(),
})

export type CallOptions = z.infer<typeof CallOptionsSchema>

// ==================== Block Reference Schema ====================

/**
 * Block reference for RPC queries
 *
 * Specify either `finality` OR `blockId` (not both).
 * If both are provided, `blockId` takes precedence.
 *
 * @example
 * ```typescript
 * // Query at final block (default)
 * await near.view('contract.near', 'get_value')
 *
 * // Query at optimistic for latest state
 * await near.view('contract.near', 'get_value', {}, {
 *   finality: 'optimistic'
 * })
 *
 * // Query at specific block height
 * await near.view('contract.near', 'get_value', {}, {
 *   blockId: 27912554
 * })
 *
 * // Query at specific block hash
 * await near.view('contract.near', 'get_value', {}, {
 *   blockId: '3Xz2wM9rigMXzA2c5vgCP8wTgFBaePucgUmVYPkMqhRL'
 * })
 * ```
 */
export const BlockReferenceSchema = z.object({
  /**
   * Finality level for the query
   *
   * - `optimistic`: Block that might be skipped (~1s after submission). Use for latest state.
   * - `near-final`: Irreversible unless a validator is slashed (~2s after submission)
   * - `final`: Fully finalized and irreversible (~3s after submission). DEFAULT for view calls.
   *
   * @default "final" for view calls, "optimistic" for account/key queries
   * @see https://docs.near.org/api/rpc/setup#using-finality-param
   */
  finality: z.enum(["optimistic", "near-final", "final"]).optional(),

  /**
   * Block ID to query at - can be block number or block hash
   *
   * Use block number (e.g., `27912554`) or block hash
   * (e.g., `'3Xz2wM9rigMXzA2c5vgCP8wTgFBaePucgUmVYPkMqhRL'`) to query
   * historical state.
   *
   * Mutually exclusive with `finality`. If both are provided, `blockId` takes precedence.
   */
  blockId: z.union([z.number(), z.string()]).optional(),
})

export type BlockReference = z.infer<typeof BlockReferenceSchema>

// ==================== Near Config Schema ====================

/**
 * Schema for key store configuration
 */
export const KeyStoreConfigSchema = z.union([
  z.string(), // File path
  z.record(z.string(), z.string()), // { accountId: privateKey }
  z.any(), // KeyStore interface - too complex for Zod validation
])

/**
 * Schema for signer function
 */
export const SignerSchema = z.any() // Function schema validation - simplified

/**
 * Schema for RPC retry configuration
 */
export const RpcRetryConfigSchema = z
  .object({
    maxRetries: z.number().int().min(0),
    initialDelayMs: z.number().int().min(0),
  })
  .partial()

/**
 * Inferred type for RPC retry configuration input
 * Allows partial configuration with optional fields that can be undefined
 */
export type RpcRetryConfigInput = z.infer<typeof RpcRetryConfigSchema>

/**
 * Schema for NEAR client configuration
 */
export const NearConfigSchema = z.object({
  network: NetworkConfigSchema.optional(),
  rpcUrl: z.string().url("RPC URL must be a valid URL").optional(),
  headers: z.record(z.string(), z.string()).optional(),
  keyStore: KeyStoreConfigSchema.optional(),
  signer: SignerSchema.optional(),
  privateKey: z.union([PrivateKeySchema, z.instanceof(Uint8Array)]).optional(),
  wallet: z.any().optional(), // WalletConnection interface
  defaultSignerId: z.string().optional(),
  defaultWaitUntil: TxExecutionStatusSchema.optional(),
  retryConfig: RpcRetryConfigSchema.optional(),
})

// Type override to use template literal type for better type safety
type NearConfigBase = z.infer<typeof NearConfigSchema>
export type NearConfig = Omit<NearConfigBase, "privateKey"> & {
  privateKey?: PrivateKey | Uint8Array
}

// ==================== Helper Functions ====================

/**
 * Resolve network configuration with validation
 */
export function resolveNetworkConfig(network?: NetworkConfig): {
  rpcUrl: string
  networkId: string
  walletUrl?: string | undefined
  helperUrl?: string | undefined
} {
  // Default to mainnet
  if (!network) {
    const envNetwork =
      typeof process !== "undefined" ? process.env["NEAR_NETWORK"] : undefined
    if (
      envNetwork &&
      (envNetwork === "mainnet" ||
        envNetwork === "testnet" ||
        envNetwork === "localnet")
    ) {
      return NETWORK_PRESETS[envNetwork as NetworkPreset]
    }
    return NETWORK_PRESETS.mainnet
  }

  // Validate and parse network config
  const validated = NetworkConfigSchema.parse(network)

  // Network preset
  if (typeof validated === "string") {
    return NETWORK_PRESETS[validated as NetworkPreset]
  }

  // Custom network config (already validated)
  return validated
}
