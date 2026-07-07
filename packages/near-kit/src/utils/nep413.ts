/**
 * NEP-413: Message signing utilities
 *
 * NEP-413 enables off-chain message signing for authentication and ownership verification
 * without gas fees or blockchain transactions.
 *
 * @see https://github.com/near/NEPs/blob/master/neps/nep-0413.md
 */

import { ed25519 } from "@noble/curves/ed25519.js"
import { sha256 } from "@noble/hashes/sha2.js"
import { randomBytes } from "@noble/hashes/utils.js"
import { base58, base64 } from "@scure/base"
import { b } from "@zorsh/zorsh"
import type { Near } from "../core/near.js"
import type { SignedMessage, SignMessageParams } from "../core/types.js"
import { parsePublicKey } from "./key.js"

/**
 * NEP-413 tag prefix: 2^31 + 413 = 2147484061
 *
 * This prefix ensures that signed messages cannot be confused with valid transactions.
 * The tag makes the message too long to be a valid signer account ID.
 */
export const NEP413_TAG = 2147484061

/**
 * NEP-413 message payload schema
 *
 * Fields are serialized in this order:
 * 1. message: string - The message to sign
 * 2. nonce: [u8; 32] - 32-byte nonce for replay protection
 * 3. recipient: string - Recipient identifier (e.g., "alice.near" or "myapp.com")
 * 4. callbackUrl: Option<string> - Optional callback URL for web wallets
 */
export const Nep413PayloadSchema = b.struct({
  message: b.string(),
  nonce: b.array(b.u8(), 32),
  recipient: b.string(),
  callbackUrl: b.option(b.string()),
})

/**
 * Serialize NEP-413 message parameters for signing
 *
 * Serialization steps:
 * 1. Serialize the tag (2147484061) as u32
 * 2. Serialize the payload (message, nonce, recipient, callbackUrl)
 * 3. Concatenate: tag_bytes + payload_bytes
 * 4. Hash with SHA256
 *
 * @param params - Message signing parameters
 * @returns Serialized and hashed message ready for signing
 *
 * @example
 * ```typescript
 * const nonce = generateNonce()
 * const hash = serializeNep413Message({
 *   message: "Login to MyApp",
 *   recipient: "myapp.near",
 *   nonce,
 * })
 * ```
 */
export function serializeNep413Message(params: SignMessageParams): Uint8Array {
  if (params.nonce.length !== 32) {
    throw new Error("Nonce must be exactly 32 bytes")
  }

  // Serialize tag as u32
  const tagBytes = b.u32().serialize(NEP413_TAG)

  // Serialize payload
  const payloadBytes = Nep413PayloadSchema.serialize({
    message: params.message,
    nonce: Array.from(params.nonce),
    recipient: params.recipient,
    callbackUrl: params.callbackUrl ?? null,
  })

  // Concatenate tag + payload
  const combined = new Uint8Array(tagBytes.length + payloadBytes.length)
  combined.set(tagBytes, 0)
  combined.set(payloadBytes, tagBytes.length)

  // Hash the combined bytes
  return sha256(combined)
}

/**
 * Options for NEP-413 signature verification
 */
export interface VerifyNep413Options {
  /**
   * Maximum age in milliseconds for the signature to be considered valid.
   *
   * Only applies when `nonceValidation` is `"timestamp"` (the default), which
   * assumes the nonce embeds a timestamp in its first 8 bytes as produced by
   * `generateNonce()`. Ignored when `nonceValidation` is `"none"`.
   *
   * Passing `Infinity` is a legacy escape hatch that skips timestamp
   * validation entirely, including the future-timestamp rejection — the same
   * effect as `nonceValidation: "none"`, which is the preferred way to opt
   * out. `NaN` falls back to the default.
   *
   * @default 300000 (5 minutes)
   */
  maxAge?: number

  /**
   * How to validate the nonce.
   *
   * NEP-413 defines the nonce as an arbitrary 32-byte value with no inherent
   * structure. Embedding a timestamp in the first 8 bytes is a near-kit
   * convention (used by `generateNonce()`) for automatic expiration checking,
   * not part of the spec.
   *
   * - `"timestamp"` (default) - Interpret the first 8 bytes of the nonce as a
   *   big-endian millisecond timestamp and reject signatures older than
   *   `maxAge` or with future timestamps (both checks are skipped when
   *   `maxAge` is `Infinity`). Use this for nonces created with
   *   `generateNonce()`.
   * - `"none"` - Treat the nonce as opaque bytes per the NEP-413 spec. No
   *   timestamp or expiry check is performed and `maxAge` is ignored. Use this
   *   for messages signed with a custom nonce scheme. You are then responsible
   *   for validating the nonce and preventing replay attacks yourself.
   *
   * @default "timestamp"
   */
  nonceValidation?: "timestamp" | "none"

  /**
   * Near client instance for verifying that the public key belongs to the account ID
   * and has full access permission.
   *
   * When provided, the function will verify that:
   * 1. The public key in the signed message actually belongs to the claimed account ID
   * 2. The key has full access permission (not a function call key)
   *
   * This provides an additional layer of security by ensuring the signer has
   * a valid full access key on the NEAR blockchain. Function call keys are rejected
   * because NEP-413 signatures should only be created with full access keys.
   *
   * @example
   * ```typescript
   * const near = new Near({ network: "mainnet" })
   * const isValid = await verifyNep413Signature(signedMessage, params, { near })
   * ```
   */
  near?: Near
}

/**
 * Verify a NEP-413 signed message
 *
 * By default, assumes the nonce follows the near-kit convention used by
 * `generateNonce()` (first 8 bytes are a big-endian ms timestamp) and checks
 * timestamp expiration (default: 5 minutes). NEP-413 itself treats the nonce
 * as arbitrary 32 bytes, so for messages signed with a custom nonce scheme
 * pass `nonceValidation: "none"` and validate the nonce yourself.
 * You must still track used nonces to prevent replay attacks.
 *
 * When `options.near` is provided, this function also verifies that the public key
 * in the signed message belongs to the claimed account ID by querying the NEAR
 * blockchain. This provides protection against attackers who might try
 * to claim ownership of an account using a different key.
 *
 * @param signedMessage - The signed message to verify
 * @param params - Original message parameters (must match what was signed)
 * @param options - Verification options including optional Near client for access key validation
 * @returns Promise resolving to true if signature is valid, not expired, and (if Near client provided) the key belongs to the account
 *
 * @example
 * ```typescript
 * // Basic signature verification (no blockchain verification)
 * const isValid = await verifyNep413Signature(signedMessage, {
 *   message: "Login to MyApp",
 *   recipient: "myapp.com",
 *   nonce: Buffer.from(req.body.nonce),
 * })
 *
 * // With blockchain verification to ensure key belongs to account
 * const near = new Near({ network: "mainnet" })
 * const isValid = await verifyNep413Signature(signedMessage, params, { near })
 *
 * // Custom nonce scheme (e.g. app-defined structure) - skip the timestamp check
 * const isValid = await verifyNep413Signature(signedMessage, params, {
 *   nonceValidation: "none", // caller is responsible for nonce/replay checks
 * })
 * ```
 */
export async function verifyNep413Signature(
  signedMessage: SignedMessage,
  params: SignMessageParams,
  options: VerifyNep413Options = {},
): Promise<boolean> {
  try {
    const {
      maxAge: rawMaxAge = 5 * 60 * 1000,
      nonceValidation = "timestamp",
      near,
    } = options // Default: 5 minutes

    // NaN would make the age comparison below always false and silently
    // disable the expiry check; fail closed by falling back to the default
    const maxAge = Number.isNaN(rawMaxAge) ? 5 * 60 * 1000 : rawMaxAge

    // Check timestamp expiration if the nonce follows the near-kit timestamp
    // convention and maxAge is finite. Fail closed: only an explicit "none"
    // opts out, so unexpected values keep the default replay/expiry protection.
    if (
      nonceValidation !== "none" &&
      maxAge !== Infinity &&
      params.nonce.length === 32
    ) {
      // Extract timestamp from first 8 bytes (big-endian uint64)
      const view = new DataView(
        params.nonce.buffer,
        params.nonce.byteOffset,
        params.nonce.byteLength,
      )
      const timestamp = Number(view.getBigUint64(0, false)) // false = big-endian

      // Check if expired
      const age = Date.now() - timestamp
      if (age > maxAge || age < 0) {
        // age < 0 means timestamp is in the future (clock skew or tampering)
        return false
      }
    }

    // Parse the public key
    const publicKey = parsePublicKey(signedMessage.publicKey)

    // Only Ed25519 is currently supported
    if (publicKey.keyType !== 0) {
      throw new Error("Only Ed25519 keys are supported for NEP-413")
    }

    // If Near client is provided, verify that the public key belongs to the account ID
    // and is a full access key (not a function call key)
    if (near) {
      const accessKey = await near.getAccessKey(
        signedMessage.accountId,
        signedMessage.publicKey,
      )
      if (!accessKey || accessKey.permission !== "FullAccess") {
        // Key does not exist for this account or is not a full access key
        return false
      }
    }

    // Reconstruct the hashed payload
    const hash = serializeNep413Message(params)

    const signatureBytes = decodeSignature(signedMessage.signature)
    if (!signatureBytes) return false

    // Verify the signature
    return ed25519.verify(signatureBytes, hash, publicKey.data)
  } catch {
    return false
  }
}

function decodeSignature(signature: string): Uint8Array | null {
  // NEP-413 spec: signatures should be base64 encoded
  // Try base64 first (standard format)
  try {
    return base64.decode(signature)
  } catch {
    // fall through to legacy formats
  }

  // Backward compatibility: prefixed base58 (ed25519:... or secp256k1:...)
  const prefixed = signature.match(/^(ed25519:|secp256k1:)(.+)$/)
  if (prefixed?.[2]) {
    try {
      return base58.decode(prefixed[2])
    } catch {
      return null
    }
  }

  // Backward compatibility: unprefixed base58 strings
  if (/^[1-9A-HJ-NP-Za-km-z]+$/.test(signature)) {
    try {
      return base58.decode(signature)
    } catch {
      return null
    }
  }

  return null
}

/**
 * Generate a nonce for NEP-413 message signing
 *
 * NEP-413 nonces are arbitrary 32-byte values; embedding a timestamp in the
 * first 8 bytes is a near-kit convention that lets `verifyNep413Signature`
 * check expiration automatically. Apps are free to use their own nonce scheme
 * instead - verify those with `nonceValidation: "none"`.
 *
 * @returns 32-byte nonce (8 bytes big-endian ms timestamp + 24 bytes random)
 *
 * @example
 * ```typescript
 * const nonce = generateNonce()
 * const signedMessage = await near.signMessage({
 *   message: "Login to MyApp",
 *   recipient: "myapp.com",
 *   nonce,
 * })
 * ```
 */
export function generateNonce(): Uint8Array {
  const nonce = new Uint8Array(32)

  // First 8 bytes: timestamp (ms since epoch) as big-endian uint64
  const timestamp = Date.now()
  const view = new DataView(nonce.buffer)
  view.setBigUint64(0, BigInt(timestamp), false) // false = big-endian

  // Remaining 24 bytes: random data
  const randomPart = randomBytes(24)
  nonce.set(randomPart, 8)

  return nonce
}
