/**
 * Zod schemas for NEAR CLI credential file formats
 *
 * NEAR CLI stores credentials in `~/.near-credentials/` with the following structure:
 *
 * ## Directory Structure
 * ```
 * ~/.near-credentials/
 *   ├── mainnet/
 *   │   ├── account.near.json              # Single key per account
 *   │   └── account.near/                   # Multiple keys per account
 *   │       └── ed25519_PublicKeyBase58.json
 *   ├── testnet/
 *   │   └── account.testnet.json
 *   └── implicit/
 *       └── accountId.json
 * ```
 *
 * ## File Format
 * Each credential file contains:
 * - `account_id` (optional): Named account ID
 * - `public_key`: Public key in format "ed25519:Base58EncodedKey"
 * - `private_key`: Private key in format "ed25519:Base58EncodedKey"
 * - `seed_phrase_hd_path` (optional): BIP32 derivation path (e.g., "m/44'/397'/0'")
 * - `master_seed_phrase` (optional): BIP39 seed phrase
 * - `implicit_account_id` (optional): Implicit account ID (hex of public key)
 *
 * @see https://github.com/near/near-cli
 */

import { z } from "zod"

/**
 * Schema for NEAR CLI credential file
 *
 * This matches the format used by near-cli and near-cli-rs for storing
 * account credentials on the filesystem.
 *
 * @example
 * ```json
 * {
 *   "account_id": "example.testnet",
 *   "public_key": "ed25519:8nFkHgRePSGD9UsK3Hx6234567890abcdefghijklmnop",
 *   "private_key": "ed25519:3D4c2v8K5x...",
 *   "seed_phrase_hd_path": "m/44'/397'/0'",
 *   "master_seed_phrase": "word1 word2 word3 ...",
 *   "implicit_account_id": "1234567890abcdef..."
 * }
 * ```
 */
export const NearCliCredentialSchema = z.object({
  /**
   * Named account ID (optional)
   * @example "example.testnet"
   */
  account_id: z.string().optional(),

  /**
   * Public key in NEAR format
   * @example "ed25519:8nFkHgRePSGD9UsK3Hx6nWKXGQ7Kd7k3k7k3k7k3k7k3"
   */
  public_key: z.string(),

  /**
   * Private key in NEAR format (note: uses "private_key", not "secret_key")
   * @example "ed25519:3D4c2v8K5x..."
   */
  private_key: z.string(),

  /**
   * BIP32 derivation path (optional)
   * @example "m/44'/397'/0'"
   */
  seed_phrase_hd_path: z.string().optional(),

  /**
   * BIP39 seed phrase (optional)
   * @example "witch collapse practice feed shame open despair creek road again ice least"
   */
  master_seed_phrase: z.string().optional(),

  /**
   * Implicit account ID (optional) - hex representation of the public key
   * @example "e3cb032dbb6e8f45239c79652ba94172378f940d340b429ce5076d1a2f7366e2"
   */
  implicit_account_id: z.string().optional(),
})

/**
 * TypeScript type for NEAR CLI credential
 */
export type NearCliCredential = z.infer<typeof NearCliCredentialSchema>

/**
 * Legacy format used by some tools (uses "secret_key" instead of "private_key")
 * This is supported for reading only, not writing
 */
export const LegacyCredentialSchema = z.object({
  account_id: z.string().optional(),
  public_key: z.string(),
  secret_key: z.string(), // Legacy field name
  seed_phrase_hd_path: z.string().optional(),
  master_seed_phrase: z.string().optional(),
  implicit_account_id: z.string().optional(),
})

/**
 * TypeScript type for legacy credential format
 */
export type LegacyCredential = z.infer<typeof LegacyCredentialSchema>

/**
 * Network identifiers supported by NEAR
 */
export const NetworkSchema = z.enum([
  "mainnet",
  "testnet",
  "betanet",
  "localnet",
])

/**
 * TypeScript type for network identifier
 */
export type Network = z.infer<typeof NetworkSchema>

/**
 * Parse a credential file, supporting both modern and legacy formats
 *
 * @param data - Raw JSON data from credential file
 * @returns Parsed credential with normalized field names
 * @throws {z.ZodError} If the data doesn't match any supported format
 */
export function parseCredentialFile(data: unknown): NearCliCredential {
  // Try modern format first
  const modernResult = NearCliCredentialSchema.safeParse(data)
  if (modernResult.success) {
    return modernResult.data
  }

  // Try legacy format
  const legacyResult = LegacyCredentialSchema.safeParse(data)
  if (legacyResult.success) {
    // Convert legacy format to modern format
    const { secret_key, ...rest } = legacyResult.data
    return {
      ...rest,
      private_key: secret_key,
    }
  }

  // Neither format matched, throw the modern format error
  throw modernResult.error
}
