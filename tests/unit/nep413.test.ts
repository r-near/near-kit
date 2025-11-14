/**
 * Tests for NEP-413 message signing functionality
 */

import { describe, expect, test } from "bun:test"
import {
  Ed25519KeyPair,
  generateNep413Nonce,
  serializeNep413Message,
  verifyNep413Signature,
  NEP413_TAG,
} from "../../src/utils/index.js"
import type { SignMessageParams } from "../../src/core/types.js"

describe("NEP-413 Message Signing", () => {
  test("should generate a 32-byte nonce", () => {
    const nonce = generateNep413Nonce()
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
    const nonce = generateNep413Nonce()

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
    const nonce = generateNep413Nonce()

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
    const nonce = generateNep413Nonce()

    const params: SignMessageParams = {
      message: "Login to MyApp",
      recipient: "myapp.near",
      nonce,
    }

    const signedMessage = keyPair.signNep413Message(accountId, params)

    // Try to verify with different nonce
    const differentNonce = generateNep413Nonce()
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
    const nonce = generateNep413Nonce()

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
    const nonce = generateNep413Nonce()

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
    const nonce = generateNep413Nonce()

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
    const nonce = generateNep413Nonce()

    const params: SignMessageParams = {
      message: "こんにちは世界 🌍 Привет мир",
      recipient: "myapp.near",
      nonce,
    }

    const signedMessage = keyPair.signNep413Message(accountId, params)
    const isValid = verifyNep413Signature(signedMessage, params)
    expect(isValid).toBe(true)
  })
})
