/**
 * Zod validation schemas for NEAR types
 */

import { z } from "zod"
import {
  ACCOUNT_ID_REGEX,
  ED25519_KEY_PREFIX,
  MAX_ACCOUNT_ID_LENGTH,
  MIN_ACCOUNT_ID_LENGTH,
  SECP256K1_KEY_PREFIX,
} from "../core/constants.js"
import { parseAmount } from "./amount.js"
import { parseGas } from "./gas.js"

// ==================== Base58 Validation ====================

/**
 * Check if a string is valid base58 encoding
 */
function isValidBase58(str: string): boolean {
  const base58Regex =
    /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/
  return base58Regex.test(str)
}

// ==================== Account ID Schema ====================

/**
 * Schema for validating NEAR account IDs
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
 * Schema for validating NEAR public keys
 *
 * Supports:
 * - Ed25519: "ed25519:..." (base58 encoded)
 * - Secp256k1: "secp256k1:..." (base58 encoded)
 */
export const PublicKeySchema = z
  .string()
  .refine(
    (key) =>
      key.startsWith(ED25519_KEY_PREFIX) ||
      key.startsWith(SECP256K1_KEY_PREFIX),
    "Public key must start with 'ed25519:' or 'secp256k1:'",
  )
  .refine((key) => {
    const keyData = key.startsWith(ED25519_KEY_PREFIX)
      ? key.slice(ED25519_KEY_PREFIX.length)
      : key.slice(SECP256K1_KEY_PREFIX.length)
    return isValidBase58(keyData)
  }, "Public key must be valid base58 encoding")

export type PublicKeyString = z.infer<typeof PublicKeySchema>

// ==================== Amount Schema ====================

/**
 * Schema for NEAR amounts with explicit units
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
    return parseAmount(amount)
  })

export type Amount = z.input<typeof AmountSchema>

// ==================== Gas Schema ====================

/**
 * Schema for gas amounts
 *
 * Accepts:
 * - String with unit: "30 Tgas", Gas.Tgas(30)
 * - Raw gas number strings for advanced use
 *
 * Normalizes to raw gas string.
 */
export const GasSchema = z.string().transform((gas): string => {
  return parseGas(gas)
})

export type Gas = z.input<typeof GasSchema>

// ==================== Helper Functions ====================

/**
 * Validate account ID (throws on invalid)
 */
export function validateAccountId(accountId: string): string {
  return AccountIdSchema.parse(accountId)
}

/**
 * Check if account ID is valid (boolean)
 */
export function isValidAccountId(accountId: string): boolean {
  return AccountIdSchema.safeParse(accountId).success
}

/**
 * Validate public key (throws on invalid)
 */
export function validatePublicKey(key: string): string {
  return PublicKeySchema.parse(key)
}

/**
 * Check if public key is valid (boolean)
 */
export function isValidPublicKey(key: string): boolean {
  return PublicKeySchema.safeParse(key).success
}

/**
 * Normalize amount to yoctoNEAR string
 */
export function normalizeAmount(amount: Amount): string {
  return AmountSchema.parse(amount)
}

/**
 * Normalize gas to gas string
 */
export function normalizeGas(gas: Gas): string {
  return GasSchema.parse(gas)
}
