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

import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
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
/** Native credential codec; the exported Zod schemas retain their existing API. */
const credentialFields = {
  account_id: Schema.optional(Schema.String),
  public_key: Schema.String,
  seed_phrase_hd_path: Schema.optional(Schema.String),
  master_seed_phrase: Schema.optional(Schema.String),
  implicit_account_id: Schema.optional(Schema.String),
}

export const Credential = Schema.Struct({
  ...credentialFields,
  private_key: Schema.String,
})
export interface Credential extends Schema.Schema.Type<typeof Credential> {}

const LegacyCredential = Schema.Struct({
  ...credentialFields,
  secret_key: Schema.String,
})

/** Decode persisted data, preferring the modern key when both forms are present. */
export const decodeCredential = Effect.fn("Credential.decode")(function* (
  data: unknown,
) {
  return yield* Schema.decodeUnknownEffect(Credential)(data).pipe(
    Effect.catch(() =>
      Schema.decodeUnknownEffect(LegacyCredential)(data).pipe(
        Effect.map(({ secret_key, ...rest }) => ({
          ...rest,
          private_key: secret_key,
        })),
        // Preserve the established public Zod error and issue details on invalid input.
        Effect.mapError((error) => {
          const result = NearCliCredentialSchema.safeParse(data)
          return result.success ? error : result.error
        }),
      ),
    ),
  )
})

export function parseCredentialFile(data: unknown): NearCliCredential {
  return Effect.runSync(decodeCredential(data))
}

export interface CredentialMetadata {
  seedPhrase?: string
  derivationPath?: string
  implicitAccountId?: string
}

/** Shared wire encoding used by disk and operating-system keyrings. */
export function makeCredential(
  accountId: string,
  key: {
    readonly publicKey: { toString(): string }
    readonly secretKey: string
  },
  options?: CredentialMetadata,
): Credential {
  return {
    account_id: accountId,
    public_key: key.publicKey.toString(),
    private_key: key.secretKey,
    ...(options?.seedPhrase ? { master_seed_phrase: options.seedPhrase } : {}),
    ...(options?.derivationPath
      ? { seed_phrase_hd_path: options.derivationPath }
      : {}),
    ...(options?.implicitAccountId
      ? { implicit_account_id: options.implicitAccountId }
      : {}),
  }
}
