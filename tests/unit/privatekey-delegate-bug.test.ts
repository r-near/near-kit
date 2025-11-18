/**
 * Test to replicate the bug where privateKey is not added to keyStore
 * when initializing Near with privateKey and defaultSignerId (non-sandbox config)
 *
 * Bug: When using privateKey + defaultSignerId without a sandbox network config,
 * the private key is not added to the keyStore. This causes delegate() to fail
 * because it can't find the key to sign with.
 */

import { describe, expect, test } from "bun:test"
import { Near } from "../../src/core/near.js"
import { generateKey } from "../../src/utils/key.js"

describe("privateKey + defaultSignerId initialization bug", () => {
  test("should add privateKey to keyStore when defaultSignerId is provided (non-sandbox)", async () => {
    // TDD: Test the DESIRED behavior - this should FAIL until we fix the bug
    const testKey = generateKey()
    const accountId = "x402-buyer.testnet"

    // Initialize Near with privateKey and defaultSignerId
    // but WITHOUT a sandbox network config (just regular network config)
    const near = new Near({
      network: {
        rpcUrl: "https://rpc.testnet.near.org",
        networkId: "testnet",
      },
      privateKey: testKey.secretKey as `ed25519:${string}`,
      defaultSignerId: accountId,
    })

    // The key SHOULD be in the keyStore (this is what we want!)
    const keyPair = await near["keyStore"].get(accountId)
    expect(keyPair).not.toBeNull()
    expect(keyPair?.publicKey.toString()).toBe(testKey.publicKey.toString())
  })

  test("should work with sandbox config (current behavior)", async () => {
    // This test shows that it DOES work with sandbox config
    const rootKey = generateKey()
    const accountId = "test.near"

    const mockSandbox = {
      rpcUrl: "http://127.0.0.1:12345",
      networkId: "localnet",
      rootAccount: {
        id: accountId,
        secretKey: rootKey.secretKey,
      },
    }

    const near = new Near({
      network: mockSandbox,
      privateKey: rootKey.secretKey as `ed25519:${string}`,
    })

    // Wait for keystore to be ready
    if (near["pendingKeyStoreInit"]) {
      await near["pendingKeyStoreInit"]
    }

    // Verify the key IS in the keyStore when using sandbox config
    const keyPair = await near["keyStore"].get(accountId)
    expect(keyPair).not.toBeNull()
    expect(keyPair?.publicKey.toString()).toBe(rootKey.publicKey.toString())
  })

  test("should work with explicit keyStore", async () => {
    // This test shows that using explicit keyStore works
    const testKey = generateKey()
    const accountId = "test.testnet"

    const near = new Near({
      network: {
        rpcUrl: "https://rpc.testnet.near.org",
        networkId: "testnet",
      },
      keyStore: {
        [accountId]: testKey.secretKey,
      },
      defaultSignerId: accountId,
    })

    // Verify the key is in the keyStore
    const keyPair = await near["keyStore"].get(accountId)
    expect(keyPair).not.toBeNull()
    expect(keyPair?.publicKey.toString()).toBe(testKey.publicKey.toString())
  })
})
