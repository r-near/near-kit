/**
 * Unit tests for sandbox auto-extraction with async keystores
 *
 * Verifies that pendingKeyStoreInit properly waits for async keyStore.add()
 * before build() or send() try to access the keyStore.
 */

import { describe, expect, test } from "bun:test"
import { Near } from "../../src/core/near.js"
import type { KeyPair, KeyStore } from "../../src/core/types.js"
import { generateKey } from "../../src/utils/key.js"
import type { PrivateKey } from "../../src/utils/validation.js"

/**
 * Mock async KeyStore that simulates file I/O delay
 */
class SlowAsyncKeyStore implements KeyStore {
  private keys = new Map<string, KeyPair>()
  private addDelay: number

  constructor(delayMs = 50) {
    this.addDelay = delayMs
  }

  async add(accountId: string, key: KeyPair): Promise<void> {
    // Simulate async file write with delay
    await new Promise((resolve) => setTimeout(resolve, this.addDelay))
    this.keys.set(accountId, key)
  }

  async get(accountId: string): Promise<KeyPair | null> {
    return this.keys.get(accountId) || null
  }

  async remove(accountId: string): Promise<void> {
    this.keys.delete(accountId)
  }

  async list(): Promise<string[]> {
    return Array.from(this.keys.keys())
  }
}

describe("Sandbox async keyStore initialization", () => {
  test("sets pendingKeyStoreInit when sandbox auto-extraction occurs", async () => {
    const rootKey = generateKey()
    const mockSandbox = {
      rpcUrl: "http://127.0.0.1:12345",
      networkId: "localnet",
      rootAccount: {
        id: "test.near",
        secretKey: rootKey.secretKey,
      },
    }

    const slowKeyStore = new SlowAsyncKeyStore(100)

    // Create Near with sandbox auto-extraction + slow async keyStore
    const near = new Near({
      network: mockSandbox,
      keyStore: slowKeyStore,
    })

    // Should have pending keyStore initialization
    expect(near["pendingKeyStoreInit"]).toBeDefined()

    // KeyStore should NOT have the key yet (still writing)
    const keyBeforeInit = await slowKeyStore.get(mockSandbox.rootAccount.id)
    expect(keyBeforeInit).toBeNull()

    // After awaiting pendingKeyStoreInit, key should be available
    await near["pendingKeyStoreInit"]

    const keyAfterInit = await slowKeyStore.get(mockSandbox.rootAccount.id)
    expect(keyAfterInit).not.toBeNull()
    expect(keyAfterInit?.publicKey.toString()).toBe(
      rootKey.publicKey.toString(),
    )
  })

  test("TransactionBuilder awaits keyStore init before accessing keys", async () => {
    const rootKey = generateKey()
    const mockSandbox = {
      rpcUrl: "http://127.0.0.1:12345",
      networkId: "localnet",
      rootAccount: {
        id: "test.near",
        secretKey: rootKey.secretKey,
      },
    }

    const slowKeyStore = new SlowAsyncKeyStore(100)

    const near = new Near({
      network: mockSandbox,
      keyStore: slowKeyStore,
    })

    // TransactionBuilder should be created with ensureKeyStoreReady callback
    const builder = near.transaction(mockSandbox.rootAccount.id)
    expect(builder["ensureKeyStoreReady"]).toBeDefined()

    // Verify that the callback actually waits for initialization
    const startTime = Date.now()
    await builder["ensureKeyStoreReady"]?.()
    const elapsed = Date.now() - startTime

    // Should have waited at least 100ms (the slowKeyStore delay)
    expect(elapsed).toBeGreaterThanOrEqual(90) // Allow small margin

    // After waiting, key should be in keyStore
    const key = await slowKeyStore.get(mockSandbox.rootAccount.id)
    expect(key).not.toBeNull()
  })

  test("explicit privateKey triggers async init to prevent race conditions", async () => {
    const rootKey = generateKey()
    const mockSandbox = {
      rpcUrl: "http://127.0.0.1:12345",
      networkId: "localnet",
      rootAccount: {
        id: "test.near",
        secretKey: rootKey.secretKey,
      },
    }

    const slowKeyStore = new SlowAsyncKeyStore(100)

    // When privateKey is explicitly provided, it adds to keyStore
    // This triggers pendingKeyStoreInit to prevent race conditions
    const near = new Near({
      network: mockSandbox,
      privateKey: rootKey.secretKey as PrivateKey,
      keyStore: slowKeyStore,
    })

    // Check that pendingKeyStoreInit IS set (to prevent race conditions)
    expect(near["pendingKeyStoreInit"]).toBeDefined()

    // Wait for it to complete
    await near["pendingKeyStoreInit"]

    // Verify the key was added
    const keyPair = await near["keyStore"].get("test.near")
    expect(keyPair).not.toBeNull()
  })

  test("keyStore without sandbox auto-extraction", async () => {
    const accountKey = generateKey()
    const slowKeyStore = new SlowAsyncKeyStore(100)

    // Manually add a key (not via sandbox auto-extraction)
    await slowKeyStore.add("alice.near", accountKey)

    const near = new Near({
      network: "testnet",
      keyStore: slowKeyStore,
    })

    // No pending init because no sandbox auto-extraction happened
    expect(near["pendingKeyStoreInit"]).toBeUndefined()
  })

  test("sanitized sandbox (missing secretKey) doesn't trigger init", async () => {
    const mockSandbox = {
      rpcUrl: "http://127.0.0.1:12345",
      networkId: "localnet",
      rootAccount: {
        id: "test.near",
        // No secretKey - sanitized config
      },
    }

    const slowKeyStore = new SlowAsyncKeyStore(100)

    const near = new Near({
      network: mockSandbox,
      keyStore: slowKeyStore,
    })

    // No pending init because secretKey is missing (guarded)
    expect(near["pendingKeyStoreInit"]).toBeUndefined()

    // KeyStore should be empty
    const keys = await slowKeyStore.list()
    expect(keys.length).toBe(0)
  })
})
