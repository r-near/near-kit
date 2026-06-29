/**
 * Zod validation schemas and helpers for NEAR types.
 *
 * @remarks
 * These schemas power runtime validation for account IDs, public/private keys,
 * amounts, and gas while keeping the developer-facing API ergonomic via
 * helpers like {@link validateAccountId} and {@link normalizeAmount}.
 */
import { z } from "zod"
import {
  ACCOUNT_ID_REGEX,
  ED25519_KEY_PREFIX,
  MAX_ACCOUNT_ID_LENGTH,
  MIN_ACCOUNT_ID_LENGTH,
  ML_DSA_65_HASH_PREFIX,
  ML_DSA_65_KEY_PREFIX,
  SECP256K1_KEY_PREFIX,
} from "../core/constants.js"
import { type AmountInput, parseAmount } from "./amount.js"
import { type GasInput, parseGas } from "./gas.js"

// ==================== Base58 Validation ====================

/**
 * Check if a string is valid base58 encoding.
 * @internal
 */
function isValidBase58(str: string): boolean {
  const base58Regex =
    /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/
  return base58Regex.test(str)
}

// ==================== Account ID Schema ====================

/**
 * Schema for validating NEAR account IDs.
 *
 * Rules:
 * - Length: 2-64 characters
 * - Characters: lowercase alphanumeric, hyphens, underscores, and dots
 * - Pattern: subdomain-like structure (e.g., alice.near, contract.mainnet)
 */
export const AccountIdSchema = z
  .string()
  .min(
    MIN_ACCOUNT_ID_LENGTH,
    `Account ID must be at least ${MIN_ACCOUNT_ID_LENGTH} characters`,
  )
  .max(
    MAX_ACCOUNT_ID_LENGTH,
    `Account ID must be at most ${MAX_ACCOUNT_ID_LENGTH} characters`,
  )
  .regex(
    ACCOUNT_ID_REGEX,
    "Account ID must contain only lowercase alphanumeric characters, hyphens, underscores, and dots",
  )

export type AccountId = z.infer<typeof AccountIdSchema>

// ==================== Public Key Schema ====================

/**
 * Public key string prefixes accepted by {@link PublicKeySchema}.
 *
 * Includes the `ml-dsa-65-hash:` view-handle form so access-key listings
 * containing post-quantum keys validate without throwing. Ordered longest-first
 * so `ml-dsa-65-hash:` matches before any shorter prefix.
 */
const PUBLIC_KEY_PREFIXES = [
  ML_DSA_65_HASH_PREFIX,
  ML_DSA_65_KEY_PREFIX,
  ED25519_KEY_PREFIX,
  SECP256K1_KEY_PREFIX,
]

/**
 * Schema for validating NEAR public keys.
 *
 * Supports:
 * - Ed25519: "ed25519:..." (base58 encoded)
 * - Secp256k1: "secp256k1:..." (base58 encoded)
 * - ML-DSA-65: "ml-dsa-65:..." (full key) and "ml-dsa-65-hash:..." (view handle)
 */
export const PublicKeySchema = z
  .string()
  .refine(
    (key) => PUBLIC_KEY_PREFIXES.some((prefix) => key.startsWith(prefix)),
    "Public key must start with 'ed25519:', 'secp256k1:', 'ml-dsa-65:', or 'ml-dsa-65-hash:'",
  )
  .refine((key) => {
    const prefix = PUBLIC_KEY_PREFIXES.find((p) => key.startsWith(p))
    if (!prefix) return false
    return isValidBase58(key.slice(prefix.length))
  }, "Public key must be valid base58 encoding")

export type PublicKeyString = z.infer<typeof PublicKeySchema>

// ==================== Private Key Schema ====================

/**
 * Type-safe private key string using template literal types.
 *
 * Provides compile-time type safety for private keys.
 * Supports ed25519, secp256k1, and ml-dsa-65 (post-quantum) keys.
 *
 * @example
 * ```typescript
 * const key: PrivateKey = 'ed25519:...'     // ✅ Valid
 * const key: PrivateKey = 'secp256k1:...'   // ✅ Valid
 * const key: PrivateKey = 'ml-dsa-65:...'   // ✅ Valid (post-quantum)
 * const key: PrivateKey = 'alice.near'      // ❌ Type error at compile time
 *
 * // Function signature ensures type safety
 * function signWith(key: PrivateKey) { ... }
 * signWith('ed25519:abc')      // ✅ Valid
 * signWith('secp256k1:abc')    // ✅ Valid
 * signWith('ml-dsa-65:abc')    // ✅ Valid
 * signWith('alice.near')       // ❌ Type error
 * ```
 */
export type PrivateKey =
  | `ed25519:${string}`
  | `secp256k1:${string}`
  | `ml-dsa-65:${string}`

/**
 * Private key string prefixes accepted by {@link PrivateKeySchema}.
 *
 * Ordered longest-first so `ml-dsa-65:` matches before any shorter prefix.
 */
const PRIVATE_KEY_PREFIXES = [
  ML_DSA_65_KEY_PREFIX,
  ED25519_KEY_PREFIX,
  SECP256K1_KEY_PREFIX,
]

/**
 * Schema for validating NEAR private keys.
 *
 * Supports:
 * - Ed25519: "ed25519:..." (base58 encoded, 64 bytes)
 * - Secp256k1: "secp256k1:..." (base58 encoded, 96 bytes)
 * - ML-DSA-65: "ml-dsa-65:..." (base58 encoded; either a 32-byte seed, as this
 *   library serializes generated keys, or the 4032-byte raw expanded secret key
 *   as written by nearcore / near-cli credentials)
 */
export const PrivateKeySchema = z
  .string()
  .refine(
    (key) => PRIVATE_KEY_PREFIXES.some((prefix) => key.startsWith(prefix)),
    "Private key must start with 'ed25519:', 'secp256k1:', or 'ml-dsa-65:'",
  )
  .refine((key) => {
    const prefix = PRIVATE_KEY_PREFIXES.find((p) => key.startsWith(p))
    if (!prefix) return false
    const keyData = key.slice(prefix.length)
    return keyData.length > 0 && isValidBase58(keyData)
  }, "Private key must be valid base58 encoding")

export type PrivateKeyString = z.infer<typeof PrivateKeySchema>

// ==================== Amount Schema ====================

/**
 * Schema for NEAR amounts with explicit units.
 *
 * Accepts:
 * - String with unit: "10 NEAR", "1000000 yocto"
 * - Created via Amount.NEAR(10) or Amount.yocto(1000000n)
 * - Raw bigint: 1000000n (treated as yoctoNEAR)
 *
 * Rejects bare numbers to prevent unit confusion.
 * Normalizes to yoctoNEAR string.
 */
export const AmountSchema = z
  .union([z.string(), z.bigint()])
  .transform((amount): string => {
    return parseAmount(amount as AmountInput)
  })

/**
 * Compile-time-safe amount type for NEAR values.
 *
 * This is a template-literal type that only permits:
 * - `"10 NEAR"`, `"1.5 NEAR"` style strings
 * - `"1000 yocto"` style strings
 * - Raw bigint values treated as yoctoNEAR
 */
export type Amount = AmountInput

// ==================== Gas Schema ====================

/**
 * Schema for gas amounts.
 *
 * Accepts:
 * - String with unit: "30 Tgas", Gas.Tgas(30)
 * - Raw gas number strings for advanced use
 *
 * Normalizes to raw gas string.
 */
export const GasSchema = z.string().transform((gas): string => {
  return parseGas(gas as GasInput)
})

export type Gas = GasInput

// ==================== Helper Functions ====================

/**
 * Validate account ID (throws on invalid).
 */
export function validateAccountId(accountId: string): string {
  return AccountIdSchema.parse(accountId)
}

/**
 * Check if account ID is valid (boolean).
 */
export function isValidAccountId(accountId: string): boolean {
  return AccountIdSchema.safeParse(accountId).success
}

/**
 * Validate public key (throws on invalid).
 */
export function validatePublicKey(key: string): string {
  return PublicKeySchema.parse(key)
}

/**
 * Check if public key is valid (boolean).
 */
export function isValidPublicKey(key: string): boolean {
  return PublicKeySchema.safeParse(key).success
}

/**
 * Validate private key (throws on invalid).
 */
export function validatePrivateKey(key: string): string {
  return PrivateKeySchema.parse(key)
}

/**
 * Check if private key is valid (boolean).
 */
export function isPrivateKey(key: string): boolean {
  return PrivateKeySchema.safeParse(key).success
}

/**
 * Normalize amount to yoctoNEAR string.
 */
export function normalizeAmount(amount: Amount): string {
  return AmountSchema.parse(amount)
}

/**
 * Normalize gas to gas string.
 */
export function normalizeGas(gas: Gas): string {
  return GasSchema.parse(gas)
}
