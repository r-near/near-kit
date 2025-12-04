/**
 * Tests for NEP-413 message signing functionality
 */

import { base58, base64 } from "@scure/base"
import { describe, expect, test } from "vitest"
import type { SignMessageParams } from "../../src/core/types.js"
import {
  Ed25519KeyPair,
  generateNonce,
  NEP413_TAG,
  Secp256k1KeyPair,
  serializeNep413Message,
  verifyNep413Signature,
} from "../../src/utils/index.js"

describe("NEP-413 Message Signing", () => {
  test("should generate a 32-byte nonce", () => {
    const nonce = generateNonce()
    expect(nonce).toBeInstanceOf(Uint8Array)
    expect(nonce.length).toBe(32)
  })

  test("should serialize message with correct tag", () => {
    const nonce = new Uint8Array(32).fill(1)
    const params: SignMessageParams = {
      message: "Hello, NEAR!",
      recipient: "test.near",
      nonce,
    }

    const serialized = serializeNep413Message(params)

    // Should be a 32-byte hash (SHA256)
    expect(serialized).toBeInstanceOf(Uint8Array)
    expect(serialized.length).toBe(32)
  })

  test("should throw error for invalid nonce length", () => {
    const invalidNonce = new Uint8Array(16) // Wrong size

    expect(() => {
      serializeNep413Message({
        message: "test",
        recipient: "test.near",
        nonce: invalidNonce,
      })
    }).toThrow("Nonce must be exactly 32 bytes")
  })

  test("should sign and verify message correctly", () => {
    const keyPair = Ed25519KeyPair.fromRandom()
    const accountId = "test.near"
    const nonce = generateNonce()

    const params: SignMessageParams = {
      message: "Login to MyApp",
      recipient: "myapp.near",
      nonce,
    }

    // Sign the message
    const signedMessage = keyPair.signNep413Message(accountId, params)

    // Verify the structure
    expect(signedMessage.accountId).toBe(accountId)
    expect(signedMessage.publicKey).toBe(keyPair.publicKey.toString())
    expect(typeof signedMessage.signature).toBe("string")

    // Verify the signature
    const isValid = verifyNep413Signature(signedMessage, params)
    expect(isValid).toBe(true)
  })

  test("should fail verification with wrong message", () => {
    const keyPair = Ed25519KeyPair.fromRandom()
    const accountId = "test.near"
    const nonce = generateNonce()

    const params: SignMessageParams = {
      message: "Login to MyApp",
      recipient: "myapp.near",
      nonce,
    }

    const signedMessage = keyPair.signNep413Message(accountId, params)

    // Try to verify with different message
    const differentParams: SignMessageParams = {
      message: "Different message",
      recipient: "myapp.near",
      nonce,
    }

    const isValid = verifyNep413Signature(signedMessage, differentParams)
    expect(isValid).toBe(false)
  })

  test("should fail verification with wrong nonce", () => {
    const keyPair = Ed25519KeyPair.fromRandom()
    const accountId = "test.near"
    const nonce = generateNonce()

    const params: SignMessageParams = {
      message: "Login to MyApp",
      recipient: "myapp.near",
      nonce,
    }

    const signedMessage = keyPair.signNep413Message(accountId, params)

    // Try to verify with different nonce
    const differentNonce = generateNonce()
    const differentParams: SignMessageParams = {
      message: "Login to MyApp",
      recipient: "myapp.near",
      nonce: differentNonce,
    }

    const isValid = verifyNep413Signature(signedMessage, differentParams)
    expect(isValid).toBe(false)
  })

  test("should fail verification with wrong recipient", () => {
    const keyPair = Ed25519KeyPair.fromRandom()
    const accountId = "test.near"
    const nonce = generateNonce()

    const params: SignMessageParams = {
      message: "Login to MyApp",
      recipient: "myapp.near",
      nonce,
    }

    const signedMessage = keyPair.signNep413Message(accountId, params)

    // Try to verify with different recipient
    const differentParams: SignMessageParams = {
      message: "Login to MyApp",
      recipient: "different.near",
      nonce,
    }

    const isValid = verifyNep413Signature(signedMessage, differentParams)
    expect(isValid).toBe(false)
  })

  test("should have correct NEP-413 tag value", () => {
    // 2^31 + 413 = 2147484061
    expect(NEP413_TAG).toBe(2147484061)
  })

  test("should produce deterministic signatures for same input", () => {
    const keyPair = Ed25519KeyPair.fromRandom()
    const accountId = "test.near"
    const nonce = new Uint8Array(32).fill(42)

    const params: SignMessageParams = {
      message: "Login to MyApp",
      recipient: "myapp.near",
      nonce,
    }

    // Sign the same message twice
    const signature1 = keyPair.signNep413Message(accountId, params)
    const signature2 = keyPair.signNep413Message(accountId, params)

    // Should produce identical signatures
    expect(signature1.signature).toBe(signature2.signature)
  })

  test("should handle empty message", () => {
    const keyPair = Ed25519KeyPair.fromRandom()
    const accountId = "test.near"
    const nonce = generateNonce()

    const params: SignMessageParams = {
      message: "",
      recipient: "myapp.near",
      nonce,
    }

    const signedMessage = keyPair.signNep413Message(accountId, params)
    const isValid = verifyNep413Signature(signedMessage, params)
    expect(isValid).toBe(true)
  })

  test("should handle long message", () => {
    const keyPair = Ed25519KeyPair.fromRandom()
    const accountId = "test.near"
    const nonce = generateNonce()

    const params: SignMessageParams = {
      message: "A".repeat(10000), // Very long message
      recipient: "myapp.near",
      nonce,
    }

    const signedMessage = keyPair.signNep413Message(accountId, params)
    const isValid = verifyNep413Signature(signedMessage, params)
    expect(isValid).toBe(true)
  })

  test("should handle unicode characters in message", () => {
    const keyPair = Ed25519KeyPair.fromRandom()
    const accountId = "test.near"
    const nonce = generateNonce()

    const params: SignMessageParams = {
      message: "こんにちは世界 🌍 Привет мир",
      recipient: "myapp.near",
      nonce,
    }

    const signedMessage = keyPair.signNep413Message(accountId, params)
    const isValid = verifyNep413Signature(signedMessage, params)
    expect(isValid).toBe(true)
  })

  test("should reject non-Ed25519 keys (secp256k1) for NEP-413 verification", () => {
    const keyPair = Secp256k1KeyPair.fromRandom()
    const accountId = "test.near"
    const nonce = generateNonce()

    const params: SignMessageParams = {
      message: "Login to MyApp",
      recipient: "myapp.near",
      nonce,
    }

    // Sign with secp256k1 key
    const signedMessage = keyPair.signNep413Message(accountId, params)

    // Verification should fail because secp256k1 (keyType=1) is not supported
    const isValid = verifyNep413Signature(signedMessage, params)
    expect(isValid).toBe(false)
  })

  test("should verify base58-encoded signature with ed25519 prefix", () => {
    const keyPair = Ed25519KeyPair.fromRandom()
    const accountId = "test.near"
    const nonce = generateNonce()

    const params: SignMessageParams = {
      message: "Login to MyApp",
      recipient: "myapp.near",
      nonce,
    }

    const signedMessage = keyPair.signNep413Message(accountId, params)
    expect(signedMessage.signature).toMatch(/^ed25519:[1-9A-HJ-NP-Za-km-z]+$/)

    const isValid = verifyNep413Signature(signedMessage, params)
    expect(isValid).toBe(true)
  })

  test("should support legacy base64 signatures", () => {
    const keyPair = Ed25519KeyPair.fromRandom()
    const accountId = "test.near"
    const nonce = generateNonce()

    const params: SignMessageParams = {
      message: "Login to MyApp",
      recipient: "myapp.near",
      nonce,
    }

    // Current format: base58 with prefix
    const signedMessage = keyPair.signNep413Message(accountId, params)

    // Convert to legacy base64 without prefix
    const signatureBytes = base58.decode(
      signedMessage.signature.replace(/^ed25519:/, ""),
    )
    const base64Signature = base64.encode(signatureBytes)

    const legacySignedMessage: typeof signedMessage = {
      accountId,
      publicKey: signedMessage.publicKey,
      signature: base64Signature,
    }

    const isValid = verifyNep413Signature(legacySignedMessage, params)
    expect(isValid).toBe(true)
  })

  test("should support base58 signatures without prefix", () => {
    const keyPair = Ed25519KeyPair.fromRandom()
    const accountId = "test.near"
    const nonce = generateNonce()

    const params: SignMessageParams = {
      message: "Login to MyApp",
      recipient: "myapp.near",
      nonce,
    }

    const signedMessage = keyPair.signNep413Message(accountId, params)
    const unprefixedSignature = signedMessage.signature.replace(/^ed25519:/, "")

    const unprefixedSignedMessage: typeof signedMessage = {
      accountId,
      publicKey: signedMessage.publicKey,
      signature: unprefixedSignature,
    }

    const isValid = verifyNep413Signature(unprefixedSignedMessage, params)
    expect(isValid).toBe(true)
  })

  test("should return false when both base64 and base58 decoding fail", () => {
    const keyPair = Ed25519KeyPair.fromRandom()
    const accountId = "test.near"
    const nonce = generateNonce()

    const params: SignMessageParams = {
      message: "Login to MyApp",
      recipient: "myapp.near",
      nonce,
    }

    // Create a valid signed message
    const signedMessage = keyPair.signNep413Message(accountId, params)

    // Create an invalid signature that cannot be decoded as base64 or base58
    const invalidSignedMessage: typeof signedMessage = {
      accountId,
      publicKey: signedMessage.publicKey,
      signature: "!!!invalid!!!signature!!!that!!!cannot!!!be!!!decoded!!!",
    }

    // Verification should return false
    const isValid = verifyNep413Signature(invalidSignedMessage, params)
    expect(isValid).toBe(false)
  })

  test("should return false when public key parsing fails", () => {
    const keyPair = Ed25519KeyPair.fromRandom()
    const accountId = "test.near"
    const nonce = generateNonce()

    const params: SignMessageParams = {
      message: "Login to MyApp",
      recipient: "myapp.near",
      nonce,
    }

    // Create a valid signed message
    const signedMessage = keyPair.signNep413Message(accountId, params)

    // Create an invalid signed message with bad public key format
    const invalidSignedMessage: typeof signedMessage = {
      accountId,
      publicKey: "invalid:publickey:format",
      signature: signedMessage.signature,
    }

    // Verification should return false
    const isValid = verifyNep413Signature(invalidSignedMessage, params)
    expect(isValid).toBe(false)
  })

  test("should return false when signature verification fails", () => {
    const keyPair = Ed25519KeyPair.fromRandom()
    const accountId = "test.near"
    const nonce = generateNonce()

    const params: SignMessageParams = {
      message: "Login to MyApp",
      recipient: "myapp.near",
      nonce,
    }

    // Create a valid signed message
    const signedMessage = keyPair.signNep413Message(accountId, params)

    // Tamper with the signature bytes
    const signatureBytes = base58.decode(
      signedMessage.signature.replace(/^ed25519:/, ""),
    )
    // Flip the first byte
    if (signatureBytes[0] !== undefined) {
      signatureBytes[0] = signatureBytes[0] ^ 0xff
    }
    const tamperedSignature = `ed25519:${base58.encode(signatureBytes)}`

    // Create signed message with tampered signature
    const tamperedSignedMessage: typeof signedMessage = {
      accountId,
      publicKey: signedMessage.publicKey,
      signature: tamperedSignature,
    }

    // Verification should fail due to tampered signature
    const isValid = verifyNep413Signature(tamperedSignedMessage, params)
    expect(isValid).toBe(false)
  })
})
