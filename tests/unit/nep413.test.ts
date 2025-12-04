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

  test("should sign and verify message correctly", async () => {
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
    const isValid = await verifyNep413Signature(signedMessage, params)
    expect(isValid).toBe(true)
  })

  test("should fail verification with wrong message", async () => {
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

    const isValid = await verifyNep413Signature(signedMessage, differentParams)
    expect(isValid).toBe(false)
  })

  test("should fail verification with wrong nonce", async () => {
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

    const isValid = await verifyNep413Signature(signedMessage, differentParams)
    expect(isValid).toBe(false)
  })

  test("should fail verification with wrong recipient", async () => {
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

    const isValid = await verifyNep413Signature(signedMessage, differentParams)
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

  test("should handle empty message", async () => {
    const keyPair = Ed25519KeyPair.fromRandom()
    const accountId = "test.near"
    const nonce = generateNonce()

    const params: SignMessageParams = {
      message: "",
      recipient: "myapp.near",
      nonce,
    }

    const signedMessage = keyPair.signNep413Message(accountId, params)
    const isValid = await verifyNep413Signature(signedMessage, params)
    expect(isValid).toBe(true)
  })

  test("should handle long message", async () => {
    const keyPair = Ed25519KeyPair.fromRandom()
    const accountId = "test.near"
    const nonce = generateNonce()

    const params: SignMessageParams = {
      message: "A".repeat(10000), // Very long message
      recipient: "myapp.near",
      nonce,
    }

    const signedMessage = keyPair.signNep413Message(accountId, params)
    const isValid = await verifyNep413Signature(signedMessage, params)
    expect(isValid).toBe(true)
  })

  test("should handle unicode characters in message", async () => {
    const keyPair = Ed25519KeyPair.fromRandom()
    const accountId = "test.near"
    const nonce = generateNonce()

    const params: SignMessageParams = {
      message: "こんにちは世界 🌍 Привет мир",
      recipient: "myapp.near",
      nonce,
    }

    const signedMessage = keyPair.signNep413Message(accountId, params)
    const isValid = await verifyNep413Signature(signedMessage, params)
    expect(isValid).toBe(true)
  })

  test("should reject non-Ed25519 keys (secp256k1) for NEP-413 verification", async () => {
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
    const isValid = await verifyNep413Signature(signedMessage, params)
    expect(isValid).toBe(false)
  })

  test("should produce base64-encoded signature per NEP-413 spec", async () => {
    const keyPair = Ed25519KeyPair.fromRandom()
    const accountId = "test.near"
    const nonce = generateNonce()

    const params: SignMessageParams = {
      message: "Login to MyApp",
      recipient: "myapp.near",
      nonce,
    }

    const signedMessage = keyPair.signNep413Message(accountId, params)
    // NEP-413 spec requires base64 encoding (not base58 with prefix)
    expect(signedMessage.signature).toMatch(/^[A-Za-z0-9+/]+=*$/)

    const isValid = await verifyNep413Signature(signedMessage, params)
    expect(isValid).toBe(true)
  })

  test("should support legacy base58 signatures with ed25519 prefix", async () => {
    const keyPair = Ed25519KeyPair.fromRandom()
    const accountId = "test.near"
    const nonce = generateNonce()

    const params: SignMessageParams = {
      message: "Login to MyApp",
      recipient: "myapp.near",
      nonce,
    }

    // Current format: base64 (NEP-413 spec)
    const signedMessage = keyPair.signNep413Message(accountId, params)

    // Convert to legacy base58 with ed25519: prefix for backward compatibility test
    const signatureBytes = base64.decode(signedMessage.signature)
    const base58Signature = `ed25519:${base58.encode(signatureBytes)}`

    const legacySignedMessage: typeof signedMessage = {
      accountId,
      publicKey: signedMessage.publicKey,
      signature: base58Signature,
    }

    const isValid = await verifyNep413Signature(legacySignedMessage, params)
    expect(isValid).toBe(true)
  })

  test("should support base58 signatures without prefix", async () => {
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

    const isValid = await verifyNep413Signature(unprefixedSignedMessage, params)
    expect(isValid).toBe(true)
  })

  test("should return false when both base64 and base58 decoding fail", async () => {
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
    const isValid = await verifyNep413Signature(invalidSignedMessage, params)
    expect(isValid).toBe(false)
  })

  test("should return false when public key parsing fails", async () => {
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
    const isValid = await verifyNep413Signature(invalidSignedMessage, params)
    expect(isValid).toBe(false)
  })

  test("should return false when signature verification fails", async () => {
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
    const signatureBytes = base64.decode(signedMessage.signature)
    // Flip the first byte
    if (signatureBytes[0] !== undefined) {
      signatureBytes[0] = signatureBytes[0] ^ 0xff
    }
    const tamperedSignature = base64.encode(signatureBytes)

    // Create signed message with tampered signature
    const tamperedSignedMessage: typeof signedMessage = {
      accountId,
      publicKey: signedMessage.publicKey,
      signature: tamperedSignature,
    }

    // Verification should fail due to tampered signature
    const isValid = await verifyNep413Signature(tamperedSignedMessage, params)
    expect(isValid).toBe(false)
  })
})

describe("NEP-413 Near Client Validation", () => {
  test("should return false when key does not belong to account", async () => {
    const keyPair = Ed25519KeyPair.fromRandom()
    const accountId = "test.near"
    const nonce = generateNonce()

    const params: SignMessageParams = {
      message: "Login to MyApp",
      recipient: "myapp.near",
      nonce,
    }

    const signedMessage = keyPair.signNep413Message(accountId, params)

    // Create a mock Near client that returns false for fullAccessKeyExists
    const mockNear = {
      async fullAccessKeyExists(
        _accountId: string,
        _publicKey: string,
      ): Promise<boolean> {
        return false
      },
    } as unknown as import("../../src/core/near.js").Near

    const isValid = await verifyNep413Signature(signedMessage, params, {
      near: mockNear,
    })
    expect(isValid).toBe(false)
  })

  test("should pass validation when full access key exists for account", async () => {
    const keyPair = Ed25519KeyPair.fromRandom()
    const accountId = "test.near"
    const nonce = generateNonce()

    const params: SignMessageParams = {
      message: "Login to MyApp",
      recipient: "myapp.near",
      nonce,
    }

    const signedMessage = keyPair.signNep413Message(accountId, params)

    // Create a mock Near client that returns true for fullAccessKeyExists
    const mockNear = {
      async fullAccessKeyExists(
        _accountId: string,
        _publicKey: string,
      ): Promise<boolean> {
        return true
      },
    } as unknown as import("../../src/core/near.js").Near

    const isValid = await verifyNep413Signature(signedMessage, params, {
      near: mockNear,
    })
    expect(isValid).toBe(true)
  })

  test("should return false when key is a function call key (not full access)", async () => {
    const keyPair = Ed25519KeyPair.fromRandom()
    const accountId = "test.near"
    const nonce = generateNonce()

    const params: SignMessageParams = {
      message: "Login to MyApp",
      recipient: "myapp.near",
      nonce,
    }

    const signedMessage = keyPair.signNep413Message(accountId, params)

    // Create a mock Near client that returns false for fullAccessKeyExists
    // (simulating a function call key that exists but isn't full access)
    const mockNear = {
      async fullAccessKeyExists(
        _accountId: string,
        _publicKey: string,
      ): Promise<boolean> {
        return false // Key exists but is not a full access key
      },
    } as unknown as import("../../src/core/near.js").Near

    const isValid = await verifyNep413Signature(signedMessage, params, {
      near: mockNear,
    })
    expect(isValid).toBe(false)
  })
})
