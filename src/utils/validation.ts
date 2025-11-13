/**
 * Validation utilities for NEAR account IDs, keys, etc.
 */

import {
  ACCOUNT_ID_REGEX,
  ED25519_KEY_PREFIX,
  MAX_ACCOUNT_ID_LENGTH,
  MIN_ACCOUNT_ID_LENGTH,
  SECP256K1_KEY_PREFIX,
} from "../core/constants.js"
import { InvalidAccountIdError } from "../errors/index.js"

/**
 * Validate a NEAR account ID
 * @param accountId - Account ID to validate
 * @returns true if valid, throws InvalidAccountIdError otherwise
 */
export function validateAccountId(accountId: string): boolean {
  if (accountId.length < MIN_ACCOUNT_ID_LENGTH) {
    throw new InvalidAccountIdError(
      accountId,
      `Account ID must be at least ${MIN_ACCOUNT_ID_LENGTH} characters`,
    )
  }

  if (accountId.length > MAX_ACCOUNT_ID_LENGTH) {
    throw new InvalidAccountIdError(
      accountId,
      `Account ID must be at most ${MAX_ACCOUNT_ID_LENGTH} characters`,
    )
  }

  if (!ACCOUNT_ID_REGEX.test(accountId)) {
    throw new InvalidAccountIdError(
      accountId,
      "Account ID must contain only lowercase alphanumeric characters, hyphens, underscores, and dots",
    )
  }

  return true
}

/**
 * Check if a string is a valid NEAR account ID
 * @param accountId - Account ID to check
 * @returns true if valid, false otherwise
 */
export function isValidAccountId(accountId: string): boolean {
  if (
    accountId.length < MIN_ACCOUNT_ID_LENGTH ||
    accountId.length > MAX_ACCOUNT_ID_LENGTH
  ) {
    return false
  }

  return ACCOUNT_ID_REGEX.test(accountId)
}

/**
 * Check if a string is a valid NEAR public key
 * @param key - Public key string
 * @returns true if valid, false otherwise
 */
export function isValidPublicKey(key: string): boolean {
  if (key.startsWith(ED25519_KEY_PREFIX)) {
    const keyData = key.slice(ED25519_KEY_PREFIX.length)
    return isValidBase58(keyData)
  }

  if (key.startsWith(SECP256K1_KEY_PREFIX)) {
    const keyData = key.slice(SECP256K1_KEY_PREFIX.length)
    return isValidBase58(keyData)
  }

  return false
}

/**
 * Check if a string is valid base58 encoding
 * @param str - String to check
 * @returns true if valid base58, false otherwise
 */
export function isValidBase58(str: string): boolean {
  const base58Regex =
    /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/
  return base58Regex.test(str)
}

/**
 * Normalize a NEAR amount input to yoctoNEAR string
 * @param amount - Amount in various formats
 * @returns Normalized amount in yoctoNEAR
 */
export function normalizeAmount(amount: string | number | bigint): string {
  if (typeof amount === "bigint") {
    return amount.toString()
  }

  if (typeof amount === "number") {
    return BigInt(amount).toString()
  }

  // If it's a string, try to parse it as a number
  const num = parseFloat(amount)
  if (isNaN(num)) {
    throw new Error(`Invalid amount: ${amount}`)
  }

  return BigInt(Math.floor(num)).toString()
}
