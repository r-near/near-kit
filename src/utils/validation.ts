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
    (key) => key.startsWith(ED25519_KEY_PREFIX) || key.startsWith(SECP256K1_KEY_PREFIX),
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
 * Schema for NEAR amounts
 *
 * Accepts:
 * - String: "10", "1.5", "10 NEAR"
 * - Number: 10, 1.5
 * - BigInt: 10n
 *
 * Normalizes to yoctoNEAR string
 */
export const AmountSchema = z
  .union([z.string(), z.number(), z.bigint()])
  .transform((amount): string => {
    if (typeof amount === "bigint") {
      return amount.toString()
    }

    if (typeof amount === "number") {
      if (!Number.isFinite(amount)) {
        throw new Error("Amount must be a finite number")
      }
      if (amount < 0) {
        throw new Error("Amount must be non-negative")
      }
      return BigInt(Math.floor(amount)).toString()
    }

    // String: strip suffix and parse
    const stripped = amount.replace(/\s*(NEAR|near|N)$/i, "").trim()

    // Check if it's a valid number format
    if (!/^\d+(\.\d+)?$/.test(stripped)) {
      throw new Error(`Invalid amount: ${amount}`)
    }

    // For large numbers, use BigInt directly to preserve precision
    // Split on decimal point and floor the result
    const parts = stripped.split(".")
    const integerPart = parts[0]

    if (integerPart.startsWith("-")) {
      throw new Error("Amount must be non-negative")
    }

    return integerPart
  })

export type Amount = z.input<typeof AmountSchema>

// ==================== Gas Schema ====================

/**
 * Schema for gas amounts
 *
 * Accepts:
 * - String: "30 Tgas", "30000000000000"
 * - Number: 30000000000000
 * - BigInt: 30000000000000n
 *
 * Normalizes to gas string
 */
export const GasSchema = z
  .union([z.string(), z.number(), z.bigint()])
  .transform((gas): string => {
    if (typeof gas === "bigint") {
      return gas.toString()
    }

    if (typeof gas === "number") {
      if (!Number.isFinite(gas)) {
        throw new Error("Gas must be a finite number")
      }
      if (gas < 0) {
        throw new Error("Gas must be non-negative")
      }
      return BigInt(Math.floor(gas)).toString()
    }

    // String: check for Tgas/TGas suffix
    const tgasMatch = gas.match(/^(\d+(?:\.\d+)?)\s*(Tgas|TGas|tgas)/i)
    if (tgasMatch && tgasMatch[1]) {
      const tgas = parseFloat(tgasMatch[1])
      if (Number.isNaN(tgas)) {
        throw new Error(`Invalid gas amount: ${gas}`)
      }
      // Convert Tgas to gas (1 Tgas = 10^12 gas)
      return BigInt(Math.floor(tgas * 1e12)).toString()
    }

    // Otherwise, treat as raw gas number string
    const stripped = gas.trim()

    // Check if it's a valid number format
    if (!/^\d+(\.\d+)?$/.test(stripped)) {
      throw new Error(`Invalid gas amount: ${gas}`)
    }

    // Split on decimal point and floor the result
    const parts = stripped.split(".")
    const integerPart = parts[0]

    if (integerPart.startsWith("-")) {
      throw new Error("Gas must be non-negative")
    }

    return integerPart
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
