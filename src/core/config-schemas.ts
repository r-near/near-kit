/**
 * Zod schemas for NEAR client configuration
 */

import { z } from "zod"
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

// ==================== Call Options Schema ====================

/**
 * Schema for function call options
 */
export const CallOptionsSchema = z.object({
  gas: z.string().optional(),
  attachedDeposit: z.union([z.string(), z.bigint()]).optional(),
  signerId: z.string().optional(),
})

export type CallOptions = z.infer<typeof CallOptionsSchema>

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

/**
 * Schema for NEAR client configuration
 */
export const NearConfigSchema = z.object({
  network: NetworkConfigSchema.optional(),
  rpcUrl: z.string().url("RPC URL must be a valid URL").optional(),
  headers: z.record(z.string(), z.string()).optional(),
  keyStore: KeyStoreConfigSchema.optional(),
  signer: SignerSchema.optional(),
  privateKey: z.union([z.string(), z.instanceof(Uint8Array)]).optional(),
  wallet: z.any().optional(), // WalletConnection interface
  defaultWaitUntil: TxExecutionStatusSchema.optional(),
})

export type NearConfig = z.infer<typeof NearConfigSchema>

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
      return NETWORK_PRESETS[envNetwork]
    }
    return NETWORK_PRESETS.mainnet
  }

  // Validate and parse network config
  const validated = NetworkConfigSchema.parse(network)

  // Network preset
  if (typeof validated === "string") {
    return NETWORK_PRESETS[validated]
  }

  // Custom network config (already validated)
  return validated
}
