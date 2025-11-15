/**
 * Unit tests for Near class constructor refactoring
 *
 * Tests the private helper methods (_initializeRpc, _resolveKeyStore, _resolveSigner)
 * indirectly through the Near constructor and public API.
 */

import { describe, expect, test } from "bun:test"
import { Near } from "../../src/core/near.js"
import type { Signer } from "../../src/core/types.js"
import { KeyType } from "../../src/core/types.js"
import { InMemoryKeyStore } from "../../src/keys/index.js"
import { generateKey } from "../../src/utils/key.js"

describe("Near Constructor - RPC Initialization", () => {
  test("_initializeRpc: uses default mainnet RPC URL", async () => {
    const near = new Near({ network: "mainnet" })
    const status = await near.getStatus()
    expect(status.chainId).toBe("mainnet")
  })

  test("_initializeRpc: uses custom RPC URL", async () => {
    const near = new Near({
      network: "mainnet",
      rpcUrl: "https://rpc.mainnet.near.org",
    })
    const status = await near.getStatus()
    expect(status.chainId).toBe("mainnet")
  })

  test("_initializeRpc: uses testnet RPC URL", async () => {
    const near = new Near({ network: "testnet" })
    const status = await near.getStatus()
    expect(status.chainId).toBe("testnet")
  })

  test("_initializeRpc: accepts custom headers and retry config", () => {
    const near = new Near({
      network: "mainnet",
      headers: { "X-Custom-Header": "value" },
      retryConfig: { maxRetries: 5, initialDelayMs: 200 },
    })
    // Constructor should not throw
    expect(near).toBeDefined()
  })
})

describe("Near Constructor - KeyStore Resolution", () => {
  test("_resolveKeyStore: defaults to InMemoryKeyStore when no keyStore provided", async () => {
    const near = new Near({ network: "mainnet" })
    // Should have an empty in-memory keystore
    const keys = await near["keyStore"].list()
    expect(keys.length).toBe(0)
  })

  test("_resolveKeyStore: accepts KeyStore instance", async () => {
    const customKeyStore = new InMemoryKeyStore()
    const testKey = generateKey()
    await customKeyStore.add("alice.near", testKey)

    const near = new Near({
      network: "mainnet",
      keyStore: customKeyStore,
    })

    const key = await near["keyStore"].get("alice.near")
    expect(key).not.toBeNull()
    expect(key?.publicKey.toString()).toBe(testKey.publicKey.toString())
  })

  test("_resolveKeyStore: accepts Record of account->key mappings", async () => {
    const testKey = generateKey()
    const near = new Near({
      network: "mainnet",
      keyStore: {
        "alice.near": testKey.secretKey,
      },
    })

    const key = await near["keyStore"].get("alice.near")
    expect(key).not.toBeNull()
    expect(key?.publicKey.toString()).toBe(testKey.publicKey.toString())
  })
})

describe("Near Constructor - Signer Resolution", () => {
  test("_resolveSigner: accepts custom signer function", async () => {
    const customSigner: Signer = async (_message: Uint8Array) => {
      // Mock signer that returns a fixed signature
      return {
        keyType: KeyType.ED25519,
        data: new Uint8Array(64).fill(1),
      }
    }

    const near = new Near({
      network: "mainnet",
      signer: customSigner,
    })

    expect(near["signer"]).toBe(customSigner)
  })

  test("_resolveSigner: creates signer from privateKey string", () => {
    const testKey = generateKey()
    const near = new Near({
      network: "mainnet",
      privateKey: testKey.secretKey as `ed25519:${string}`,
    })

    expect(near["signer"]).toBeDefined()
    expect(typeof near["signer"]).toBe("function")
  })

  test("_resolveSigner: adds privateKey to keyStore for sandbox network", async () => {
    const rootKey = generateKey()
    const mockSandbox = {
      rpcUrl: "http://127.0.0.1:12345",
      networkId: "localnet",
      rootAccount: {
        id: "test.near",
        secretKey: rootKey.secretKey,
      },
    }

    const near = new Near({
      network: mockSandbox,
      privateKey: rootKey.secretKey as `ed25519:${string}`,
    })

    // Should have added the key to keyStore for sandbox
    const key = await near["keyStore"].get("test.near")
    expect(key).not.toBeNull()
    expect(key?.publicKey.toString()).toBe(rootKey.publicKey.toString())
  })

  test("_resolveSigner: auto-adds sandbox root key when no signer/privateKey", async () => {
    const rootKey = generateKey()
    const mockSandbox = {
      rpcUrl: "http://127.0.0.1:12345",
      networkId: "localnet",
      rootAccount: {
        id: "test.near",
        secretKey: rootKey.secretKey,
      },
    }

    const near = new Near({
      network: mockSandbox,
    })

    // Should have set pendingKeyStoreInit for async keystore
    expect(near["pendingKeyStoreInit"]).toBeDefined()

    // After waiting, key should be in keyStore
    await near["pendingKeyStoreInit"]

    const key = await near["keyStore"].get("test.near")
    expect(key).not.toBeNull()
    expect(key?.publicKey.toString()).toBe(rootKey.publicKey.toString())
  })

  test("_resolveSigner: doesn't auto-add when explicit signer provided", async () => {
    const rootKey = generateKey()
    const mockSandbox = {
      rpcUrl: "http://127.0.0.1:12345",
      networkId: "localnet",
      rootAccount: {
        id: "test.near",
        secretKey: rootKey.secretKey,
      },
    }

    const customSigner: Signer = async (_message: Uint8Array) => {
      return {
        keyType: KeyType.ED25519,
        data: new Uint8Array(64).fill(1),
      }
    }

    const near = new Near({
      network: mockSandbox,
      signer: customSigner,
    })

    // Should NOT have pending init when explicit signer provided
    expect(near["pendingKeyStoreInit"]).toBeUndefined()
  })

  test("_resolveSigner: doesn't auto-add when sandbox missing secretKey", async () => {
    const mockSandbox = {
      rpcUrl: "http://127.0.0.1:12345",
      networkId: "localnet",
      rootAccount: {
        id: "test.near",
        // No secretKey - sanitized config
      },
    }

    const near = new Near({
      network: mockSandbox,
    })

    // Should NOT have pending init when secretKey missing
    expect(near["pendingKeyStoreInit"]).toBeUndefined()
  })
})

describe("Near Constructor - Default Configuration", () => {
  test("sets defaultWaitUntil correctly", () => {
    const near1 = new Near({ network: "mainnet" })
    expect(near1["defaultWaitUntil"]).toBe("EXECUTED_OPTIMISTIC")

    const near2 = new Near({
      network: "mainnet",
      defaultWaitUntil: "FINAL",
    })
    expect(near2["defaultWaitUntil"]).toBe("FINAL")
  })

  test("stores wallet connection", () => {
    const mockWallet = {
      getAccounts: async () => [{ accountId: "alice.near" }],
      signAndSendTransaction: async () => ({
        final_execution_status: "NONE" as const,
      }),
    }

    const near = new Near({
      network: "mainnet",
      wallet: mockWallet,
    })

    expect(near["wallet"]).toBe(mockWallet)
  })
})
