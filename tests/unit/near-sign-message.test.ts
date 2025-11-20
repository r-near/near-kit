/**
 * Unit tests for Near.signMessage() method
 *
 * Tests the high-level signMessage API including:
 * - Keystore-based signing
 * - Wallet-based signing
 * - Nonce auto-generation
 * - Error handling
 */

import { describe, expect, test } from "vitest"
import { Near } from "../../src/core/near.js"
import type {
  KeyPair,
  SignMessageParams,
  WalletConnection,
} from "../../src/core/types.js"
import { InMemoryKeyStore } from "../../src/keys/index.js"
import {
  Ed25519KeyPair,
  generateNonce,
  verifyNep413Signature,
} from "../../src/utils/index.js"

describe("Near.signMessage() - Keystore-based signing", () => {
  test("should sign message with keystore", async () => {
    const keyStore = new InMemoryKeyStore()
    const keyPair = Ed25519KeyPair.fromRandom()
    await keyStore.add("alice.near", keyPair)

    const near = new Near({
      network: "testnet",
      keyStore,
    })

    const nonce = generateNonce()
    const params: SignMessageParams = {
      message: "Login to MyApp",
      recipient: "myapp.near",
      nonce,
    }

    const result = await near.signMessage(params, { signerId: "alice.near" })

    expect(result.accountId).toBe("alice.near")
    expect(result.publicKey).toBe(keyPair.publicKey.toString())
    expect(typeof result.signature).toBe("string")

    // Verify the signature is valid
    const isValid = verifyNep413Signature(result, params)
    expect(isValid).toBe(true)
  })

  test("should auto-generate nonce when not provided", async () => {
    const keyStore = new InMemoryKeyStore()
    const keyPair = Ed25519KeyPair.fromRandom()
    await keyStore.add("alice.near", keyPair)

    const near = new Near({
      network: "testnet",
      keyStore,
    })

    // Omit nonce from params
    const paramsWithoutNonce = {
      message: "Login to MyApp",
      recipient: "myapp.near",
    }

    const result = await near.signMessage(paramsWithoutNonce, {
      signerId: "alice.near",
    })

    expect(result.accountId).toBe("alice.near")
    expect(result.publicKey).toBe(keyPair.publicKey.toString())
    expect(typeof result.signature).toBe("string")
  })

  test("should use defaultSignerId when signerId not specified", async () => {
    const keyStore = new InMemoryKeyStore()
    const keyPair = Ed25519KeyPair.fromRandom()
    await keyStore.add("alice.near", keyPair)
    await keyStore.add("bob.near", Ed25519KeyPair.fromRandom())

    const near = new Near({
      network: "testnet",
      keyStore,
      defaultSignerId: "alice.near",
    })

    const nonce = generateNonce()
    const params: SignMessageParams = {
      message: "Login to MyApp",
      recipient: "myapp.near",
      nonce,
    }

    const result = await near.signMessage(params)

    expect(result.accountId).toBe("alice.near")
    expect(result.publicKey).toBe(keyPair.publicKey.toString())
  })

  test("should throw error when no key found for account", async () => {
    const keyStore = new InMemoryKeyStore()

    const near = new Near({
      network: "testnet",
      keyStore,
    })

    const params: SignMessageParams = {
      message: "Login to MyApp",
      recipient: "myapp.near",
      nonce: generateNonce(),
    }

    await expect(
      near.signMessage(params, { signerId: "unknown.near" }),
    ).rejects.toThrow("No key found for account unknown.near")
  })

  test("should throw error when key doesn't support NEP-413", async () => {
    const keyStore = new InMemoryKeyStore()

    // Create a mock key pair without NEP-413 support
    const realKeyPair = Ed25519KeyPair.fromRandom()
    const mockKeyPair = {
      publicKey: realKeyPair.publicKey,
      secretKey: realKeyPair.secretKey,
      sign: realKeyPair.sign.bind(realKeyPair),
      // Explicitly exclude signNep413Message to simulate unsupported key
    }

    await keyStore.add("alice.near", mockKeyPair as KeyPair)

    const near = new Near({
      network: "testnet",
      keyStore,
    })

    const params: SignMessageParams = {
      message: "Login to MyApp",
      recipient: "myapp.near",
      nonce: generateNonce(),
    }

    await expect(
      near.signMessage(params, { signerId: "alice.near" }),
    ).rejects.toThrow("does not support NEP-413 message signing")
  })
})

describe("Near.signMessage() - Wallet-based signing", () => {
  test("should use wallet.signMessage when available", async () => {
    const keyPair = Ed25519KeyPair.fromRandom()
    const nonce = generateNonce()

    const mockWallet: WalletConnection = {
      async getAccounts() {
        return [{ accountId: "alice.near" }]
      },
      async signAndSendTransaction() {
        throw new Error("Not implemented")
      },
      async signMessage(params: SignMessageParams) {
        // Use the actual keyPair to sign
        return keyPair.signNep413Message("alice.near", params)
      },
    }

    const near = new Near({
      network: "testnet",
      wallet: mockWallet,
    })

    const params: SignMessageParams = {
      message: "Login to MyApp",
      recipient: "myapp.near",
      nonce,
    }

    const result = await near.signMessage(params)

    expect(result.accountId).toBe("alice.near")
    expect(result.publicKey).toBe(keyPair.publicKey.toString())

    // Verify the signature is valid
    const isValid = verifyNep413Signature(result, params)
    expect(isValid).toBe(true)
  })

  test("should fallback to keystore when wallet.signMessage fails", async () => {
    const keyStore = new InMemoryKeyStore()
    const keyPair = Ed25519KeyPair.fromRandom()
    await keyStore.add("alice.near", keyPair)

    const mockWallet: WalletConnection = {
      async getAccounts() {
        return [{ accountId: "alice.near" }]
      },
      async signAndSendTransaction() {
        throw new Error("Not implemented")
      },
      async signMessage() {
        throw new Error("Wallet signMessage not supported")
      },
    }

    const near = new Near({
      network: "testnet",
      wallet: mockWallet,
      keyStore,
    })

    const nonce = generateNonce()
    const params: SignMessageParams = {
      message: "Login to MyApp",
      recipient: "myapp.near",
      nonce,
    }

    // Should succeed using keystore fallback
    const result = await near.signMessage(params, { signerId: "alice.near" })

    expect(result.accountId).toBe("alice.near")
    expect(result.publicKey).toBe(keyPair.publicKey.toString())

    // Verify the signature is valid
    const isValid = verifyNep413Signature(result, params)
    expect(isValid).toBe(true)
  })

  test("should fallback to keystore when wallet doesn't support signMessage", async () => {
    const keyStore = new InMemoryKeyStore()
    const keyPair = Ed25519KeyPair.fromRandom()
    await keyStore.add("alice.near", keyPair)

    // Wallet without signMessage method
    const mockWallet: WalletConnection = {
      async getAccounts() {
        return [{ accountId: "alice.near" }]
      },
      async signAndSendTransaction() {
        throw new Error("Not implemented")
      },
      // No signMessage method
    }

    const near = new Near({
      network: "testnet",
      wallet: mockWallet,
      keyStore,
    })

    const nonce = generateNonce()
    const params: SignMessageParams = {
      message: "Login to MyApp",
      recipient: "myapp.near",
      nonce,
    }

    // Should succeed using keystore
    const result = await near.signMessage(params, { signerId: "alice.near" })

    expect(result.accountId).toBe("alice.near")
    expect(result.publicKey).toBe(keyPair.publicKey.toString())

    // Verify the signature is valid
    const isValid = verifyNep413Signature(result, params)
    expect(isValid).toBe(true)
  })
})

describe("Near.signMessage() - Edge cases", () => {
  test("should handle empty message", async () => {
    const keyStore = new InMemoryKeyStore()
    const keyPair = Ed25519KeyPair.fromRandom()
    await keyStore.add("alice.near", keyPair)

    const near = new Near({
      network: "testnet",
      keyStore,
    })

    const nonce = generateNonce()
    const params: SignMessageParams = {
      message: "",
      recipient: "myapp.near",
      nonce,
    }

    const result = await near.signMessage(params, { signerId: "alice.near" })

    expect(result.accountId).toBe("alice.near")
    const isValid = verifyNep413Signature(result, params)
    expect(isValid).toBe(true)
  })

  test("should handle unicode characters in message", async () => {
    const keyStore = new InMemoryKeyStore()
    const keyPair = Ed25519KeyPair.fromRandom()
    await keyStore.add("alice.near", keyPair)

    const near = new Near({
      network: "testnet",
      keyStore,
    })

    const nonce = generateNonce()
    const params: SignMessageParams = {
      message: "こんにちは世界 🌍 Привет мир",
      recipient: "myapp.near",
      nonce,
    }

    const result = await near.signMessage(params, { signerId: "alice.near" })

    expect(result.accountId).toBe("alice.near")
    const isValid = verifyNep413Signature(result, params)
    expect(isValid).toBe(true)
  })

  test("should handle long message", async () => {
    const keyStore = new InMemoryKeyStore()
    const keyPair = Ed25519KeyPair.fromRandom()
    await keyStore.add("alice.near", keyPair)

    const near = new Near({
      network: "testnet",
      keyStore,
    })

    const nonce = generateNonce()
    const params: SignMessageParams = {
      message: "A".repeat(10000),
      recipient: "myapp.near",
      nonce,
    }

    const result = await near.signMessage(params, { signerId: "alice.near" })

    expect(result.accountId).toBe("alice.near")
    const isValid = verifyNep413Signature(result, params)
    expect(isValid).toBe(true)
  })
})
