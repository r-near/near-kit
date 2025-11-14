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
 * const nonce = crypto.getRandomValues(new Uint8Array(32))
 * const hash = serializeNep413Message({
 *   message: "Login to MyApp",
 *   recipient: "myapp.near",
 *   nonce,
 * })
 * const signature = keyPair.sign(hash)
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
    callbackUrl: null, // Optional, not typically used in direct signing
  })

  // Concatenate tag + payload
  const combined = new Uint8Array(tagBytes.length + payloadBytes.length)
  combined.set(tagBytes, 0)
  combined.set(payloadBytes, tagBytes.length)

  // Hash the combined bytes
  return sha256(combined)
}

/**
 * Verify a NEP-413 signed message
 *
 * Verification steps:
 * 1. Reconstruct the payload from parameters
 * 2. Serialize and hash (tag + payload)
 * 3. Verify the signature against the hash using the public key
 *
 * @param signedMessage - The signed message to verify
 * @param params - Original message parameters (must match what was signed)
 * @returns true if signature is valid, false otherwise
 *
 * @example
 * ```typescript
 * const isValid = verifyNep413Signature(signedMessage, {
 *   message: "Login to MyApp",
 *   recipient: "myapp.near",
 *   nonce,
 * })
 * if (isValid) {
 *   console.log("Signature verified!")
 * }
 * ```
 */
export function verifyNep413Signature(
  signedMessage: SignedMessage,
  params: SignMessageParams,
): boolean {
  try {
    // Parse the public key
    const publicKey = parsePublicKey(signedMessage.publicKey)

    // Only Ed25519 is currently supported
    if (publicKey.keyType !== 0) {
      throw new Error("Only Ed25519 keys are supported for NEP-413")
    }

    // Reconstruct the hashed payload
    const hash = serializeNep413Message(params)

    // Decode the signature
    // Try base64 first (most common), fallback to base58
    let signatureBytes: Uint8Array
    try {
      signatureBytes = base64.decode(signedMessage.signature)
    } catch {
      try {
        // Remove ed25519: prefix if present
        const sig = signedMessage.signature.replace("ed25519:", "")
        signatureBytes = base58.decode(sig)
      } catch {
        return false
      }
    }

    // Verify the signature
    return ed25519.verify(signatureBytes, hash, publicKey.data)
  } catch {
    return false
  }
}

/**
 * Generate a random nonce for NEP-413 message signing
 *
 * @returns 32-byte random nonce
 *
 * @example
 * ```typescript
 * const nonce = generateNep413Nonce()
 * const signedMessage = await near.signMessage({
 *   message: "Login to MyApp",
 *   recipient: "myapp.near",
 *   nonce,
 * })
 * ```
 */
export function generateNep413Nonce(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32))
}
