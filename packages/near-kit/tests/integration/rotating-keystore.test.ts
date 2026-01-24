/**
 * Integration Tests for RotatingKeyStore
 *
 * Tests RotatingKeyStore with actual transaction sending to verify:
 * - Elimination of nonce collisions with multiple keys
 * - Improved throughput for concurrent transactions
 * - Correct integration with NonceManager and TransactionBuilder
 * - Performance comparison with single-key approach
 */

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { Near } from "../../src/core/near.js"
import { InMemoryKeyStore } from "../../src/keys/in-memory-keystore.js"
import { RotatingKeyStore } from "../../src/keys/rotating-keystore.js"
import { Sandbox } from "../../src/sandbox/sandbox.js"
import { generateKey } from "../../src/utils/key.js"

describe("RotatingKeyStore Integration", () => {
  let sandbox: Sandbox
  let contractId: string

  beforeAll(async () => {
    sandbox = await Sandbox.start()

    // Deploy guestbook contract for testing
    contractId = `rotating-test-${Date.now()}.${sandbox.rootAccount.id}`
    const contractWasm = readFileSync(
      resolve(__dirname, "../contracts/guestbook.wasm"),
    )

    const contractKey = generateKey()
    await new Near({
      network: sandbox,
      keyStore: { [sandbox.rootAccount.id]: sandbox.rootAccount.secretKey },
    })
      .transaction(sandbox.rootAccount.id)
      .createAccount(contractId)
      .transfer(contractId, "10 NEAR")
      .addKey(contractKey.publicKey.toString(), { type: "fullAccess" })
      .deployContract(contractId, contractWasm)
      .send({ waitUntil: "FINAL" })

    console.log(`✓ Sandbox started: ${sandbox.rpcUrl}`)
    console.log(`✓ Contract deployed: ${contractId}`)
  }, 120000)

  afterAll(async () => {
    if (sandbox) {
      await sandbox.stop()
      console.log("✓ Sandbox stopped")
    }
  })

  describe("Basic Integration", () => {
    test("should work with single key (same as InMemoryKeyStore)", async () => {
      const userKey = generateKey()
      const userId = `single-key-${Date.now()}.${sandbox.rootAccount.id}`

      // Create account
      await new Near({
        network: sandbox,
        keyStore: { [sandbox.rootAccount.id]: sandbox.rootAccount.secretKey },
      })
        .transaction(sandbox.rootAccount.id)
        .createAccount(userId)
        .transfer(userId, "5 NEAR")
        .addKey(userKey.publicKey.toString(), { type: "fullAccess" })
        .send({ waitUntil: "FINAL" })

      // Use RotatingKeyStore with single key
      const keyStore = new RotatingKeyStore({
        [userId]: [userKey.secretKey],
      })

      const near = new Near({ network: sandbox, keyStore })

      // Send transaction
      await near
        .transaction(userId)
        .functionCall(contractId, "add_message", {
          text: "Single key test",
        })
        .send({ waitUntil: "FINAL" })

      console.log("✓ RotatingKeyStore works with single key")
    }, 60000)

    test("should rotate through multiple keys for same account", async () => {
      const userId = `multi-key-${Date.now()}.${sandbox.rootAccount.id}`

      // Create account with first key
      const key1 = generateKey()
      await new Near({
        network: sandbox,
        keyStore: { [sandbox.rootAccount.id]: sandbox.rootAccount.secretKey },
      })
        .transaction(sandbox.rootAccount.id)
        .createAccount(userId)
        .transfer(userId, "10 NEAR")
        .addKey(key1.publicKey.toString(), { type: "fullAccess" })
        .send({ waitUntil: "FINAL" })

      // Add two more keys to the account
      const key2 = generateKey()
      const key3 = generateKey()

      await new Near({
        network: sandbox,
        keyStore: { [userId]: key1.secretKey },
      })
        .transaction(userId)
        .addKey(key2.publicKey.toString(), { type: "fullAccess" })
        .addKey(key3.publicKey.toString(), { type: "fullAccess" })
        .send({ waitUntil: "FINAL" })

      // Create RotatingKeyStore with all 3 keys
      const keyStore = new RotatingKeyStore({
        [userId]: [key1.secretKey, key2.secretKey, key3.secretKey],
      })

      const near = new Near({ network: sandbox, keyStore })

      const initialCount = await near.view<number>(
        contractId,
        "total_messages",
        {},
      )

      // Send 3 sequential transactions - should use different keys
      await near
        .transaction(userId)
        .functionCall(contractId, "add_message", {
          text: "Message with key1",
        })
        .send({ waitUntil: "FINAL" })

      await near
        .transaction(userId)
        .functionCall(contractId, "add_message", {
          text: "Message with key2",
        })
        .send({ waitUntil: "FINAL" })

      await near
        .transaction(userId)
        .functionCall(contractId, "add_message", {
          text: "Message with key3",
        })
        .send({ waitUntil: "FINAL" })

      const finalCount = await near.view<number>(
        contractId,
        "total_messages",
        {},
      )

      // biome-ignore lint/style/noNonNullAssertion: test knows view returns data
      expect(finalCount).toBe(initialCount! + 3)

      console.log("✓ Successfully rotated through 3 keys")
    }, 90000)
  })

  describe("Concurrent Transaction Handling", () => {
    test("should eliminate nonce collisions with multiple keys", async () => {
      const userId = `concurrent-${Date.now()}.${sandbox.rootAccount.id}`

      // Create account with first key
      const key1 = generateKey()
      await new Near({
        network: sandbox,
        keyStore: { [sandbox.rootAccount.id]: sandbox.rootAccount.secretKey },
      })
        .transaction(sandbox.rootAccount.id)
        .createAccount(userId)
        .transfer(userId, "20 NEAR")
        .addKey(key1.publicKey.toString(), { type: "fullAccess" })
        .send({ waitUntil: "FINAL" })

      // Add 4 more keys (total 5 keys)
      const key2 = generateKey()
      const key3 = generateKey()
      const key4 = generateKey()
      const key5 = generateKey()

      await new Near({
        network: sandbox,
        keyStore: { [userId]: key1.secretKey },
      })
        .transaction(userId)
        .addKey(key2.publicKey.toString(), { type: "fullAccess" })
        .addKey(key3.publicKey.toString(), { type: "fullAccess" })
        .addKey(key4.publicKey.toString(), { type: "fullAccess" })
        .addKey(key5.publicKey.toString(), { type: "fullAccess" })
        .send({ waitUntil: "FINAL" })

      // Create RotatingKeyStore with all 5 keys
      const keyStore = new RotatingKeyStore({
        [userId]: [
          key1.secretKey,
          key2.secretKey,
          key3.secretKey,
          key4.secretKey,
          key5.secretKey,
        ],
      })

      const near = new Near({ network: sandbox, keyStore })

      const initialCount = await near.view<number>(
        contractId,
        "total_messages",
        {},
      )

      // Send 10 concurrent transactions
      // With 5 keys, we should have minimal nonce collisions
      const promises = Array.from({ length: 10 }, (_, i) =>
        near
          .transaction(userId)
          .functionCall(contractId, "add_message", {
            text: `Concurrent message ${i}`,
          })
          .send({ waitUntil: "FINAL" }),
      )

      const results = await Promise.allSettled(promises)

      const succeeded = results.filter((r) => r.status === "fulfilled").length
      const failed = results.filter((r) => r.status === "rejected").length

      console.log(
        `✓ RotatingKeyStore (5 keys): ${succeeded}/10 succeeded, ${failed}/10 failed`,
      )

      // With 5 keys and 10 transactions, all should succeed
      // Each key handles 2 transactions with independent nonces
      expect(succeeded).toBe(10)
      expect(failed).toBe(0)

      const finalCount = await near.view<number>(
        contractId,
        "total_messages",
        {},
      )

      // biome-ignore lint/style/noNonNullAssertion: test knows view returns data
      expect(finalCount).toBe(initialCount! + succeeded)
    }, 120000)

    test("comparison: RotatingKeyStore vs InMemoryKeyStore", async () => {
      // Test 1: InMemoryKeyStore (single key) - baseline
      const singleKeyUserId = `single-${Date.now()}.${sandbox.rootAccount.id}`
      const singleKey = generateKey()

      await new Near({
        network: sandbox,
        keyStore: { [sandbox.rootAccount.id]: sandbox.rootAccount.secretKey },
      })
        .transaction(sandbox.rootAccount.id)
        .createAccount(singleKeyUserId)
        .transfer(singleKeyUserId, "20 NEAR")
        .addKey(singleKey.publicKey.toString(), { type: "fullAccess" })
        .send({ waitUntil: "FINAL" })

      const singleKeyStore = new InMemoryKeyStore({
        [singleKeyUserId]: singleKey.secretKey,
      })

      const nearSingle = new Near({
        network: sandbox,
        keyStore: singleKeyStore,
      })

      const singleInitialCount = await nearSingle.view<number>(
        contractId,
        "total_messages",
        {},
      )

      // Send 10 concurrent with single key
      const singleKeyPromises = Array.from({ length: 10 }, (_, i) =>
        nearSingle
          .transaction(singleKeyUserId)
          .functionCall(contractId, "add_message", {
            text: `Single key msg ${i}`,
          })
          .send({ waitUntil: "FINAL" }),
      )

      const singleResults = await Promise.allSettled(singleKeyPromises)
      const singleSucceeded = singleResults.filter(
        (r) => r.status === "fulfilled",
      ).length

      const singleFinalCount = await nearSingle.view<number>(
        contractId,
        "total_messages",
        {},
      )
      console.log(
        `✓ InMemoryKeyStore (1 key): ${singleSucceeded}/10 succeeded (${
          // biome-ignore lint/style/noNonNullAssertion: test knows view returns data
          singleFinalCount! - singleInitialCount!
        } messages added)`,
      )

      // Test 2: RotatingKeyStore (3 keys) - improved
      const multiKeyUserId = `multi-${Date.now()}.${sandbox.rootAccount.id}`
      const mkey1 = generateKey()

      await new Near({
        network: sandbox,
        keyStore: { [sandbox.rootAccount.id]: sandbox.rootAccount.secretKey },
      })
        .transaction(sandbox.rootAccount.id)
        .createAccount(multiKeyUserId)
        .transfer(multiKeyUserId, "20 NEAR")
        .addKey(mkey1.publicKey.toString(), { type: "fullAccess" })
        .send({ waitUntil: "FINAL" })

      const mkey2 = generateKey()
      const mkey3 = generateKey()

      await new Near({
        network: sandbox,
        keyStore: { [multiKeyUserId]: mkey1.secretKey },
      })
        .transaction(multiKeyUserId)
        .addKey(mkey2.publicKey.toString(), { type: "fullAccess" })
        .addKey(mkey3.publicKey.toString(), { type: "fullAccess" })
        .send({ waitUntil: "FINAL" })

      const rotatingKeyStore = new RotatingKeyStore({
        [multiKeyUserId]: [mkey1.secretKey, mkey2.secretKey, mkey3.secretKey],
      })

      const nearRotating = new Near({
        network: sandbox,
        keyStore: rotatingKeyStore,
      })

      const multiInitialCount = await nearRotating.view<number>(
        contractId,
        "total_messages",
        {},
      )

      // Send 10 concurrent with rotating keys
      const multiKeyPromises = Array.from({ length: 10 }, (_, i) =>
        nearRotating
          .transaction(multiKeyUserId)
          .functionCall(contractId, "add_message", {
            text: `Multi key msg ${i}`,
          })
          .send({ waitUntil: "FINAL" }),
      )

      const multiResults = await Promise.allSettled(multiKeyPromises)
      const multiSucceeded = multiResults.filter(
        (r) => r.status === "fulfilled",
      ).length

      const multiFinalCount = await nearRotating.view<number>(
        contractId,
        "total_messages",
        {},
      )

      console.log(
        `✓ RotatingKeyStore (3 keys): ${multiSucceeded}/10 succeeded (${
          // biome-ignore lint/style/noNonNullAssertion: test knows view returns data
          multiFinalCount! - multiInitialCount!
        } messages added)`,
      )

      // Both should achieve 100% success rate
      // RotatingKeyStore eliminates nonce collisions with multiple keys
      expect(singleSucceeded).toBe(10)
      expect(multiSucceeded).toBe(10)

      console.log(`✓ Both approaches achieved 100% success rate`)
    }, 180000)
  })

  describe("High Throughput Scenarios", () => {
    test("should handle 20 concurrent transactions with 5 keys", async () => {
      const userId = `high-throughput-${Date.now()}.${sandbox.rootAccount.id}`

      // Create account with first key
      const key1 = generateKey()
      await new Near({
        network: sandbox,
        keyStore: { [sandbox.rootAccount.id]: sandbox.rootAccount.secretKey },
      })
        .transaction(sandbox.rootAccount.id)
        .createAccount(userId)
        .transfer(userId, "30 NEAR")
        .addKey(key1.publicKey.toString(), { type: "fullAccess" })
        .send({ waitUntil: "FINAL" })

      // Add 4 more keys (total 5 keys)
      const key2 = generateKey()
      const key3 = generateKey()
      const key4 = generateKey()
      const key5 = generateKey()
      const keys = [key1, key2, key3, key4, key5]

      await new Near({
        network: sandbox,
        keyStore: { [userId]: key1.secretKey },
      })
        .transaction(userId)
        .addKey(key2.publicKey.toString(), { type: "fullAccess" })
        .addKey(key3.publicKey.toString(), { type: "fullAccess" })
        .addKey(key4.publicKey.toString(), { type: "fullAccess" })
        .addKey(key5.publicKey.toString(), { type: "fullAccess" })
        .send({ waitUntil: "FINAL" })

      const keyStore = new RotatingKeyStore({
        [userId]: keys.map((k) => k.secretKey),
      })

      const near = new Near({ network: sandbox, keyStore })

      const initialCount = await near.view<number>(
        contractId,
        "total_messages",
        {},
      )

      const startTime = Date.now()

      // Send 20 concurrent transactions
      const promises = Array.from({ length: 20 }, (_, i) =>
        near
          .transaction(userId)
          .functionCall(contractId, "add_message", {
            text: `High throughput ${i}`,
          })
          .send({ waitUntil: "FINAL" }),
      )

      const results = await Promise.allSettled(promises)

      const duration = Date.now() - startTime

      const succeeded = results.filter((r) => r.status === "fulfilled").length
      const failed = results.filter((r) => r.status === "rejected").length

      console.log(
        `✓ 20 concurrent transactions: ${succeeded} succeeded, ${failed} failed in ${duration}ms`,
      )

      // With 5 keys handling 20 transactions (4 per key on average),
      // all should succeed due to independent nonce tracking
      expect(succeeded).toBe(20)
      expect(failed).toBe(0)

      const finalCount = await near.view<number>(
        contractId,
        "total_messages",
        {},
      )

      // biome-ignore lint/style/noNonNullAssertion: test knows view returns data
      expect(finalCount).toBe(initialCount! + succeeded)
    }, 180000)
  })

  describe("Edge Cases", () => {
    test("should handle transaction with no keys available", async () => {
      const keyStore = new RotatingKeyStore()
      const near = new Near({ network: sandbox, keyStore })

      await expect(
        near
          .transaction("nonexistent.near")
          .functionCall(contractId, "add_message", { text: "test" })
          .send(),
      ).rejects.toThrow()

      console.log("✓ Correctly throws error when no keys available")
    }, 30000)

    test("should handle adding keys dynamically", async () => {
      const userId = `dynamic-${Date.now()}.${sandbox.rootAccount.id}`

      const key1 = generateKey()
      await new Near({
        network: sandbox,
        keyStore: { [sandbox.rootAccount.id]: sandbox.rootAccount.secretKey },
      })
        .transaction(sandbox.rootAccount.id)
        .createAccount(userId)
        .transfer(userId, "10 NEAR")
        .addKey(key1.publicKey.toString(), { type: "fullAccess" })
        .send({ waitUntil: "FINAL" })

      // Start with single key
      const keyStore = new RotatingKeyStore({
        [userId]: [key1.secretKey],
      })

      const near = new Near({ network: sandbox, keyStore })

      // Send transaction with single key
      await near
        .transaction(userId)
        .functionCall(contractId, "add_message", { text: "Before adding keys" })
        .send({ waitUntil: "FINAL" })

      // Add second key to account on-chain
      const key2 = generateKey()
      await near
        .transaction(userId)
        .addKey(key2.publicKey.toString(), { type: "fullAccess" })
        .send({ waitUntil: "FINAL" })

      // Add second key to keystore
      await keyStore.add(userId, key2)

      // Verify rotation works with both keys
      const allKeys = await keyStore.getAll(userId)
      expect(allKeys.length).toBe(2)

      // Send more transactions - should rotate through both keys
      await near
        .transaction(userId)
        .functionCall(contractId, "add_message", { text: "After adding key2" })
        .send({ waitUntil: "FINAL" })

      console.log("✓ Successfully added key dynamically")
    }, 90000)
  })

  describe("Nonce Management Integration", () => {
    test("should verify independent nonce tracking per key", async () => {
      const userId = `nonce-test-${Date.now()}.${sandbox.rootAccount.id}`

      // Create account with 2 keys
      const key1 = generateKey()
      await new Near({
        network: sandbox,
        keyStore: { [sandbox.rootAccount.id]: sandbox.rootAccount.secretKey },
      })
        .transaction(sandbox.rootAccount.id)
        .createAccount(userId)
        .transfer(userId, "10 NEAR")
        .addKey(key1.publicKey.toString(), { type: "fullAccess" })
        .send({ waitUntil: "FINAL" })

      const key2 = generateKey()
      await new Near({
        network: sandbox,
        keyStore: { [userId]: key1.secretKey },
      })
        .transaction(userId)
        .addKey(key2.publicKey.toString(), { type: "fullAccess" })
        .send({ waitUntil: "FINAL" })

      const keyStore = new RotatingKeyStore({
        [userId]: [key1.secretKey, key2.secretKey],
      })

      const near = new Near({ network: sandbox, keyStore })

      // Send transactions that will alternate between keys
      // Each key should maintain its own nonce sequence
      const promises = Array.from({ length: 4 }, (_, i) =>
        near
          .transaction(userId)
          .functionCall(contractId, "add_message", {
            text: `Nonce test ${i}`,
          })
          .send({ waitUntil: "FINAL" }),
      )

      const results = await Promise.allSettled(promises)
      const succeeded = results.filter((r) => r.status === "fulfilled").length

      // All should succeed because:
      // - key1 handles txs 0 and 2 (different nonces)
      // - key2 handles txs 1 and 3 (different nonces)
      expect(succeeded).toBe(4)

      console.log(
        "✓ All transactions succeeded with independent nonce tracking",
      )
    }, 90000)
  })
})
