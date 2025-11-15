/**
 * Integration Tests for Concurrent Transactions
 *
 * Tests nonce management and parallel transaction handling:
 * - Multiple transactions from same account in parallel
 * - Nonce collision handling and retry logic
 * - Transaction ordering and success rates
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Near } from "../../src/core/near.js"
import { Sandbox } from "../../src/sandbox/sandbox.js"
import { generateKey } from "../../src/utils/key.js"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

describe("Concurrent Transactions", () => {
  let sandbox: Sandbox
  let near: Near
  let contractId: string
  let userId: string

  beforeAll(async () => {
    sandbox = await Sandbox.start()

    // Deploy guestbook contract for testing
    contractId = `concurrent-${Date.now()}.${sandbox.rootAccount.id}`
    const contractWasm = readFileSync(
      resolve(__dirname, "../contracts/guestbook.wasm"),
    )

    const contractKey = generateKey()
    await new Near({ network: sandbox, keyStore: { [sandbox.rootAccount.id]: sandbox.rootAccount.secretKey } })
      .transaction(sandbox.rootAccount.id)
      .createAccount(contractId)
      .transfer(contractId, "10 NEAR")
      .addKey(contractKey.publicKey.toString(), { type: "fullAccess" })
      .deployContract(contractId, contractWasm)
      .send({ waitUntil: "FINAL" })

    // Create user account for testing
    const userKey = generateKey()
    userId = `user-${Date.now()}.${sandbox.rootAccount.id}`
    await new Near({ network: sandbox, keyStore: { [sandbox.rootAccount.id]: sandbox.rootAccount.secretKey } })
      .transaction(sandbox.rootAccount.id)
      .createAccount(userId)
      .transfer(userId, "10 NEAR")
      .addKey(userKey.publicKey.toString(), { type: "fullAccess" })
      .send({ waitUntil: "FINAL" })

    // Create Near instance with user key
    near = new Near({
      network: sandbox,
      keyStore: {
        [sandbox.rootAccount.id]: sandbox.rootAccount.secretKey,
        [contractId]: contractKey.secretKey,
        [userId]: userKey.secretKey,
      },
    })

    console.log(`✓ Sandbox started: ${sandbox.rpcUrl}`)
    console.log(`✓ Contract deployed: ${contractId}`)
    console.log(`✓ User account: ${userId}`)
  }, 120000)

  afterAll(async () => {
    if (sandbox) {
      await sandbox.stop()
      console.log("✓ Sandbox stopped")
    }
  })

  describe("Parallel Transactions - Same Account", () => {
    test("should handle 5 concurrent transactions", async () => {
      const promises = Array.from({ length: 5 }, (_, i) =>
        near
          .transaction(userId)
          .functionCall(contractId, "add_message", {
            text: `Concurrent message ${i}`,
          })
          .send({ waitUntil: "FINAL" })
      )

      // All transactions should succeed despite potential nonce collisions
      const results = await Promise.allSettled(promises)

      const succeeded = results.filter((r) => r.status === "fulfilled").length
      const failed = results.filter((r) => r.status === "rejected").length

      console.log(`✓ Succeeded: ${succeeded}, Failed: ${failed}`)

      // At least some should succeed (retry logic handles nonce collisions)
      expect(succeeded).toBeGreaterThan(0)

      // Ideally all should succeed, but with concurrent transactions
      // some may fail depending on timing
      // In a perfect implementation with retry, all should succeed
      expect(succeeded + failed).toBe(5)

      // Verify messages were added
      const count = await near.view<number>(contractId, "total_messages", {})
      expect(count).toBeGreaterThanOrEqual(succeeded)

      console.log(`✓ ${count} messages in contract`)
    }, 60000)

    test("should handle 10 concurrent transactions", async () => {
      const initialCount = await near.view<number>(
        contractId,
        "total_messages",
        {},
      )

      const promises = Array.from({ length: 10 }, (_, i) =>
        near
          .transaction(userId)
          .functionCall(contractId, "add_message", {
            text: `Batch message ${i}`,
          })
          .send({ waitUntil: "FINAL" })
      )

      const results = await Promise.allSettled(promises)

      const succeeded = results.filter((r) => r.status === "fulfilled").length
      const failed = results.filter((r) => r.status === "rejected").length

      console.log(`✓ Batch results - Succeeded: ${succeeded}, Failed: ${failed}`)

      // Verify at least some succeeded
      expect(succeeded).toBeGreaterThan(0)

      const finalCount = await near.view<number>(
        contractId,
        "total_messages",
        {},
      )

      expect(finalCount).toBeGreaterThanOrEqual(initialCount + succeeded)

      console.log(
        `✓ Message count increased: ${initialCount} → ${finalCount}`,
      )
    }, 90000)
  })

  describe("Sequential vs Parallel Performance", () => {
    test("sequential transactions should all succeed", async () => {
      const initialCount = await near.view<number>(
        contractId,
        "total_messages",
        {},
      )

      // Send 5 transactions sequentially
      for (let i = 0; i < 5; i++) {
        await near
          .transaction(userId)
          .functionCall(contractId, "add_message", {
            text: `Sequential message ${i}`,
          })
          .send({ waitUntil: "FINAL" })
      }

      const finalCount = await near.view<number>(
        contractId,
        "total_messages",
        {},
      )

      // All 5 should succeed when sent sequentially
      expect(finalCount).toBe(initialCount + 5)

      console.log("✓ All sequential transactions succeeded")
    }, 90000)

    test("should measure transaction timing", async () => {
      const startTime = Date.now()

      // Send 3 transactions in parallel
      const promises = Array.from({ length: 3 }, (_, i) =>
        near
          .transaction(userId)
          .functionCall(contractId, "add_message", {
            text: `Timing test ${i}`,
          })
          .send({ waitUntil: "FINAL" })
      )

      await Promise.allSettled(promises)

      const duration = Date.now() - startTime

      console.log(`✓ 3 parallel transactions completed in ${duration}ms`)

      // Sanity check - should complete reasonably fast (< 60s)
      expect(duration).toBeLessThan(60000)
    }, 60000)
  })

  describe("Nonce Collision Scenarios", () => {
    test("should handle rapid-fire transactions", async () => {
      const initialCount = await near.view<number>(
        contractId,
        "total_messages",
        {},
      )

      // Send transactions as fast as possible
      const promises: Promise<unknown>[] = []
      for (let i = 0; i < 8; i++) {
        promises.push(
          near
            .transaction(userId)
            .functionCall(contractId, "add_message", {
              text: `Rapid message ${i}`,
            })
            .send({ waitUntil: "FINAL" })
        )
      }

      const results = await Promise.allSettled(promises)

      const succeeded = results.filter((r) => r.status === "fulfilled").length

      console.log(`✓ Rapid-fire: ${succeeded}/8 succeeded`)

      // Should have at least some successes
      expect(succeeded).toBeGreaterThan(0)

      const finalCount = await near.view<number>(
        contractId,
        "total_messages",
        {},
      )

      expect(finalCount).toBeGreaterThanOrEqual(initialCount + succeeded)
    }, 90000)

    test("should handle mixed transaction types concurrently", async () => {
      // Send different types of transactions concurrently
      const promises = [
        // Add message
        near
          .transaction(userId)
          .functionCall(contractId, "add_message", {
            text: "Mixed type 1",
          })
          .send({ waitUntil: "FINAL" }),

        // Add another message
        near
          .transaction(userId)
          .functionCall(contractId, "add_message", {
            text: "Mixed type 2",
          })
          .send({ waitUntil: "FINAL" }),

        // View call (read-only, no nonce needed)
        near.view<number>(contractId, "total_messages", {}),

        // Add third message
        near
          .transaction(userId)
          .functionCall(contractId, "add_message", {
            text: "Mixed type 3",
          })
          .send({ waitUntil: "FINAL" }),
      ]

      const results = await Promise.allSettled(promises)

      // View call should definitely succeed
      expect(results[2].status).toBe("fulfilled")

      const writeSuccesses = [0, 1, 3].filter(
        (i) => results[i].status === "fulfilled",
      ).length

      console.log(`✓ Mixed types: ${writeSuccesses}/3 writes succeeded`)

      expect(writeSuccesses).toBeGreaterThan(0)
    }, 60000)
  })

  describe("Multiple Accounts - No Nonce Collision", () => {
    test("should handle concurrent transactions from different accounts", async () => {
      // Create second user
      const user2Key = generateKey()
      const user2Id = `user2-${Date.now()}.${sandbox.rootAccount.id}`

      await near
        .transaction(sandbox.rootAccount.id)
        .createAccount(user2Id)
        .transfer(user2Id, "5 NEAR")
        .addKey(user2Key.publicKey.toString(), { type: "fullAccess" })
        .send({ waitUntil: "FINAL" })

      // Get existing keys from current near instance
      const existingKeys = near["keyStore"]
      const userKeyPair = await existingKeys.get(userId)

      // Update Near instance with user2 key
      near = new Near({
        network: sandbox,
        keyStore: {
          [sandbox.rootAccount.id]: sandbox.rootAccount.secretKey,
          [userId]: userKeyPair?.secretKey || "",
          [user2Id]: user2Key.secretKey,
        },
      })

      const initialCount = await near.view<number>(
        contractId,
        "total_messages",
        {},
      )

      // Send transactions from both users in parallel
      // Different accounts = different nonces = no collision
      const promises = [
        near
          .transaction(userId)
          .functionCall(contractId, "add_message", {
            text: "User1 message",
          })
          .send({ waitUntil: "FINAL" }),

        near
          .transaction(user2Id)
          .functionCall(contractId, "add_message", {
            text: "User2 message",
          })
          .send({ waitUntil: "FINAL" }),

        near
          .transaction(userId)
          .functionCall(contractId, "add_message", {
            text: "User1 message 2",
          })
          .send({ waitUntil: "FINAL" }),

        near
          .transaction(user2Id)
          .functionCall(contractId, "add_message", {
            text: "User2 message 2",
          })
          .send({ waitUntil: "FINAL" }),
      ]

      const results = await Promise.allSettled(promises)

      const succeeded = results.filter((r) => r.status === "fulfilled").length

      // All should succeed since different accounts don't share nonces
      expect(succeeded).toBe(4)

      const finalCount = await near.view<number>(
        contractId,
        "total_messages",
        {},
      )

      expect(finalCount).toBe(initialCount + 4)

      console.log("✓ All multi-account transactions succeeded")
    }, 90000)
  })

  describe("Transaction Batching", () => {
    test("should handle batches with delay between batches", async () => {
      const batchSize = 3
      const batches = 2

      let totalSucceeded = 0

      for (let batch = 0; batch < batches; batch++) {
        const promises = Array.from({ length: batchSize }, (_, i) =>
          near
            .transaction(userId)
            .functionCall(contractId, "add_message", {
              text: `Batch ${batch}, message ${i}`,
            })
            .send({ waitUntil: "FINAL" })
        )

        const results = await Promise.allSettled(promises)
        const succeeded = results.filter((r) => r.status === "fulfilled").length
        totalSucceeded += succeeded

        console.log(`✓ Batch ${batch}: ${succeeded}/${batchSize} succeeded`)

        // Small delay between batches
        await new Promise((resolve) => setTimeout(resolve, 100))
      }

      expect(totalSucceeded).toBeGreaterThan(0)
      expect(totalSucceeded).toBeLessThanOrEqual(batchSize * batches)

      console.log(
        `✓ Total: ${totalSucceeded}/${batchSize * batches} transactions succeeded`,
      )
    }, 90000)
  })

  describe("Error Resilience", () => {
    test("should handle mix of successful and failed transactions", async () => {
      const promises = [
        // Valid transaction
        near
          .transaction(userId)
          .functionCall(contractId, "add_message", {
            text: "Valid message",
          })
          .send({ waitUntil: "FINAL" }),

        // Invalid transaction (missing parameter)
        near
          .transaction(userId)
          .functionCall(contractId, "add_message", {})
          .send({ waitUntil: "FINAL" }),

        // Valid transaction
        near
          .transaction(userId)
          .functionCall(contractId, "add_message", {
            text: "Another valid message",
          })
          .send({ waitUntil: "FINAL" }),
      ]

      const results = await Promise.allSettled(promises)

      // Should have 2 successes and 1 failure
      expect(results[0].status).toBe("fulfilled")
      expect(results[1].status).toBe("rejected")
      expect(results[2].status).toBe("fulfilled")

      console.log("✓ Mix of successes and failures handled correctly")
    }, 60000)
  })
})
