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
   * @default 300000 (5 minutes)
   */
  maxAge?: number
}

/**
 * Verify a NEP-413 signed message
 *
 * Automatically checks timestamp expiration (default: 5 minutes).
 * You must still track used nonces to prevent replay attacks.
 *
 * @param signedMessage - The signed message to verify
 * @param params - Original message parameters (must match what was signed)
 * @param options - Verification options
 * @returns true if signature is valid and not expired
 *
 * @example
 * ```typescript
 * const isValid = verifyNep413Signature(signedMessage, {
 *   message: "Login to MyApp",
 *   recipient: "myapp.com",
 *   nonce: Buffer.from(req.body.nonce),
 * })
 * ```
 */
export function verifyNep413Signature(
  signedMessage: SignedMessage,
  params: SignMessageParams,
  options: VerifyNep413Options = {},
): boolean {
  try {
    const { maxAge = 5 * 60 * 1000 } = options // Default: 5 minutes

    // Check timestamp expiration if maxAge is finite
    if (maxAge !== Infinity && params.nonce.length === 32) {
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
  const prefixed = signature.match(/^(ed25519:|secp256k1:)(.+)$/)
  if (prefixed?.[2]) {
    try {
      return base58.decode(prefixed[2])
    } catch {
      return null
    }
  }

  // Unprefixed base58 strings
  if (/^[1-9A-HJ-NP-Za-km-z]+$/.test(signature)) {
    try {
      return base58.decode(signature)
    } catch {
      // fall through
    }
  }

  // Backward compatibility: accept legacy base64 signatures
  try {
    return base64.decode(signature)
  } catch {
    return null
  }
}

/**
 * Generate a nonce for NEP-413 message signing
 *
 * Embeds a timestamp for automatic expiration checking.
 *
 * @returns 32-byte nonce (8 bytes timestamp + 24 bytes random)
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
