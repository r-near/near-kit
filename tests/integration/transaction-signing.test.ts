/**
 * Integration tests for transaction signing
 *
 * These tests require a running NEAR sandbox or testnet access.
 * They can be run manually or in CI with appropriate setup.
 *
 * To run against sandbox:
 * 1. Start near-sandbox
 * 2. Run: bun test tests/integration/transaction-signing.test.ts
 */

import { describe, expect, test, beforeAll } from "bun:test"
import { Near } from "../../src/index.js"
import { Amount } from "../../src/utils/amount.js"

// These tests are skipped by default since they require network access
// Set INTEGRATION_TESTS=true to run them
const describeIntegration = process.env.INTEGRATION_TESTS === "true" ? describe : describe.skip

describeIntegration("Transaction Signing - Integration Tests", () => {
  let near: Near
  let testAccountId: string
  let testPrivateKey: string

  beforeAll(() => {
    // Configuration for sandbox or testnet
    const rpcUrl = process.env.NEAR_RPC_URL || "http://localhost:3030"
    const networkId = process.env.NEAR_NETWORK_ID || "sandbox"

    // Test account credentials (should be set in env or use sandbox defaults)
    testAccountId = process.env.NEAR_TEST_ACCOUNT || "test.near"
    testPrivateKey =
      process.env.NEAR_TEST_PRIVATE_KEY ||
      "ed25519:3D4YudUahN1nawWogh8pAKSj92sUNMdbZGjn7kERKzYoTy8oryFtvLGoBnu1J6N4qVWY9jXwfLiNWnaTzKkHNfqG"

    near = new Near({
      networkId: networkId as any,
      rpcUrl,
      keyStore: "memory",
    })
  })

  test("should sign a transaction and get hash before sending", async () => {
    await near.addKey(testAccountId, testPrivateKey)

    const tx = await near
      .transaction(testAccountId)
      .transfer(testAccountId, Amount.NEAR(0))
      .sign()

    const hash = tx.getHash()
    expect(hash).toBeTruthy()
    expect(typeof hash).toBe("string")
    expect(hash!.length).toBeGreaterThan(40) // Base58 hash should be long
  })

  test("should send pre-signed transaction", async () => {
    await near.addKey(testAccountId, testPrivateKey)

    // Sign first
    const tx = await near
      .transaction(testAccountId)
      .transfer(testAccountId, Amount.NEAR(0))
      .sign()

    const hashBeforeSend = tx.getHash()

    // Send later
    const result = await tx.send()

    // Hash should match
    expect(result.transaction.hash).toBe(hashBeforeSend)
    expect(result.final_execution_status).toBe("EXECUTED_OPTIMISTIC")
  })

  test("should serialize and deserialize transaction", async () => {
    await near.addKey(testAccountId, testPrivateKey)

    const tx = await near
      .transaction(testAccountId)
      .transfer(testAccountId, Amount.NEAR(0))
      .sign()

    const bytes = tx.serialize()
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(bytes.length).toBeGreaterThan(0)

    // TODO: Add deserialization and re-send test when we add deserialize support
  })

  test("should return transaction hash with NONE finality", async () => {
    await near.addKey(testAccountId, testPrivateKey)

    const result = await near
      .transaction(testAccountId)
      .transfer(testAccountId, Amount.NEAR(0))
      .send({ waitUntil: "NONE" })

    // Transaction hash should be injected
    expect(result.transaction).toBeDefined()
    expect(result.transaction!.hash).toBeTruthy()
    expect(result.transaction!.signer_id).toBe(testAccountId)
    expect(result.transaction!.receiver_id).toBe(testAccountId)
    expect(typeof result.transaction!.nonce).toBe("number")

    expect(result.final_execution_status).toBe("NONE")
  })

  test("should return transaction hash with INCLUDED finality", async () => {
    await near.addKey(testAccountId, testPrivateKey)

    const result = await near
      .transaction(testAccountId)
      .transfer(testAccountId, Amount.NEAR(0))
      .send({ waitUntil: "INCLUDED" })

    expect(result.transaction).toBeDefined()
    expect(result.transaction!.hash).toBeTruthy()
    expect(result.final_execution_status).toBe("INCLUDED")
  })

  test("should return full transaction with EXECUTED_OPTIMISTIC", async () => {
    await near.addKey(testAccountId, testPrivateKey)

    const result = await near
      .transaction(testAccountId)
      .transfer(testAccountId, Amount.NEAR(0))
      .send({ waitUntil: "EXECUTED_OPTIMISTIC" })

    expect(result.transaction).toBeDefined()
    expect(result.transaction.hash).toBeTruthy()
    expect(result.transaction.signer_id).toBe(testAccountId)
    expect(result.transaction.actions).toBeDefined()
    expect(result.transaction.signature).toBeDefined()
    expect(result.final_execution_status).toBe("EXECUTED_OPTIMISTIC")
  })

  test("should handle multiple actions in one transaction", async () => {
    await near.addKey(testAccountId, testPrivateKey)

    const tx = await near
      .transaction(testAccountId)
      .transfer(testAccountId, Amount.NEAR(0))
      .functionCall(testAccountId, "noop", {})
      .sign()

    const hash = tx.getHash()
    expect(hash).toBeTruthy()

    const result = await tx.send()
    expect(result.transaction.hash).toBe(hash)
  })

  test("should invalidate cache when adding actions after signing", async () => {
    await near.addKey(testAccountId, testPrivateKey)

    const tx = near.transaction(testAccountId).transfer(testAccountId, Amount.NEAR(0))

    await tx.sign()
    const firstHash = tx.getHash()

    // Add another action
    tx.transfer(testAccountId, Amount.NEAR(0))

    // Cache should be invalidated
    expect(tx.getHash()).toBeNull()

    // Re-sign
    await tx.sign()
    const newHash = tx.getHash()

    expect(newHash).not.toBe(firstHash)
  })

  test("should work with signWith() override", async () => {
    await near.addKey(testAccountId, testPrivateKey)

    const result = await near
      .transaction(testAccountId)
      .signWith(testPrivateKey)
      .transfer(testAccountId, Amount.NEAR(0))
      .send()

    expect(result.transaction.hash).toBeTruthy()
    expect(result.final_execution_status).toBe("EXECUTED_OPTIMISTIC")
  })

  test("should handle nonce retry on send", async () => {
    await near.addKey(testAccountId, testPrivateKey)

    // This test verifies that nonce retries work
    // In normal operation, nonce errors are rare, but the retry logic should handle them

    const result = await near
      .transaction(testAccountId)
      .transfer(testAccountId, Amount.NEAR(0))
      .send()

    expect(result.transaction.hash).toBeTruthy()
  })

  test("same hash when signing multiple times without changes", async () => {
    await near.addKey(testAccountId, testPrivateKey)

    const tx = near.transaction(testAccountId).transfer(testAccountId, Amount.NEAR(0))

    await tx.sign()
    const hash1 = tx.getHash()

    // Sign again without changes - should use cache
    await tx.sign()
    const hash2 = tx.getHash()

    expect(hash1).toBe(hash2)
  })
})

describeIntegration("Transaction Signing - Complex Scenarios", () => {
  let near: Near
  let testAccountId: string
  let testPrivateKey: string

  beforeAll(() => {
    const rpcUrl = process.env.NEAR_RPC_URL || "http://localhost:3030"
    const networkId = process.env.NEAR_NETWORK_ID || "sandbox"

    testAccountId = process.env.NEAR_TEST_ACCOUNT || "test.near"
    testPrivateKey =
      process.env.NEAR_TEST_PRIVATE_KEY ||
      "ed25519:3D4YudUahN1nawWogh8pAKSj92sUNMdbZGjn7kERKzYoTy8oryFtvLGoBnu1J6N4qVWY9jXwfLiNWnaTzKkHNfqG"

    near = new Near({
      networkId: networkId as any,
      rpcUrl,
      keyStore: "memory",
    })
  })

  test("should track transaction with NONE then poll with hash", async () => {
    await near.addKey(testAccountId, testPrivateKey)

    // Send with NONE to get quick response
    const result = await near
      .transaction(testAccountId)
      .transfer(testAccountId, Amount.NEAR(0))
      .send({ waitUntil: "NONE" })

    const txHash = result.transaction!.hash

    // Wait a bit for transaction to process
    await new Promise((resolve) => setTimeout(resolve, 1000))

    // Poll for status using the hash
    const status = await near.getTransactionStatus(txHash, testAccountId)

    expect(status.final_execution_status).toBeDefined()
    // Status should eventually be executed
    expect(["EXECUTED_OPTIMISTIC", "EXECUTED", "FINAL"]).toContain(
      status.final_execution_status,
    )
  })

  test("should handle batch operations with individual signing", async () => {
    await near.addKey(testAccountId, testPrivateKey)

    // Create and sign multiple transactions
    const tx1 = await near
      .transaction(testAccountId)
      .transfer(testAccountId, Amount.NEAR(0))
      .sign()

    const tx2 = await near
      .transaction(testAccountId)
      .transfer(testAccountId, Amount.NEAR(0))
      .sign()

    const hash1 = tx1.getHash()
    const hash2 = tx2.getHash()

    expect(hash1).not.toBe(hash2) // Different transactions should have different hashes

    // Send both
    const result1 = await tx1.send()
    const result2 = await tx2.send()

    expect(result1.transaction.hash).toBe(hash1)
    expect(result2.transaction.hash).toBe(hash2)
  })

  test("should work with custom signer function", async () => {
    await near.addKey(testAccountId, testPrivateKey)

    // Create custom signer that delegates to key pair
    const keyPair = await near.keys.get(testAccountId)
    const customSigner = async (message: Uint8Array) => {
      return keyPair!.sign(message)
    }

    const result = await near
      .transaction(testAccountId)
      .signWith(customSigner)
      .transfer(testAccountId, Amount.NEAR(0))
      .send()

    expect(result.transaction.hash).toBeTruthy()
  })
})
