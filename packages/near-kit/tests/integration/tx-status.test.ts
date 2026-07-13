/**
 * Integration tests for getTransactionStatus (EXPERIMENTAL_tx_status RPC method)
 * Tests actual RPC responses and validates schema correctness with receipts
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { Near } from "../../src/core/near.js"
import { InvalidTransactionError } from "../../src/errors/index.js"
import { Sandbox } from "../../src/sandbox/sandbox.js"
import { generateKey } from "../../src/utils/key.js"
import type { PrivateKey } from "../../src/utils/validation.js"

describe("getTransactionStatus - EXPERIMENTAL_tx_status RPC Method", () => {
  let sandbox: Sandbox
  let near: Near

  beforeAll(async () => {
    sandbox = await Sandbox.start()
    near = new Near({
      network: sandbox,
      privateKey: sandbox.rootAccount.secretKey as PrivateKey,
    })
    console.log(`✓ Sandbox started at ${sandbox.rpcUrl}`)
  }, 120000)

  afterAll(async () => {
    if (sandbox) {
      await sandbox.stop()
      console.log("✓ Sandbox stopped")
    }
  })

  test("should return transaction status with receipts", async () => {
    const recipientKey = generateKey()
    const recipientId = `recipient-txstatus-${Date.now()}.${
      sandbox.rootAccount.id
    }`

    // Send a transaction and get the hash
    const result = await near
      .transaction(sandbox.rootAccount.id)
      .createAccount(recipientId)
      .transfer(recipientId, "5 NEAR")
      .addKey(recipientKey.publicKey.toString(), {
        type: "fullAccess",
      })
      .send({ waitUntil: "EXECUTED_OPTIMISTIC" })

    // Now query the transaction status using getTransactionStatus
    const txHash = result.transaction.hash
    const status = await near.getTransactionStatus(
      txHash,
      sandbox.rootAccount.id,
      "FINAL",
    )

    // Verify the response has the expected structure
    expect(status).toBeDefined()
    expect(status.final_execution_status).toBe("FINAL")

    // Should have receipts field (this is the key difference from regular tx method)
    expect(status.receipts).toBeDefined()
    expect(Array.isArray(status.receipts)).toBe(true)
    expect(status.receipts.length).toBeGreaterThan(0)

    // Verify receipt structure
    const receipt = status.receipts[0]
    if (!receipt) {
      throw new Error("No receipt found")
    }
    expect(receipt.predecessor_id).toBeDefined()
    expect(receipt.receiver_id).toBeDefined()
    expect(receipt.receipt_id).toBeDefined()
    expect(receipt.receipt).toBeDefined()

    // Should also have the standard fields
    expect(status.status).toBeDefined()
    expect(status.transaction).toBeDefined()
    expect(status.transaction.hash).toBe(txHash)
    expect(status.transaction_outcome).toBeDefined()
    expect(status.receipts_outcome).toBeDefined()

    console.log(
      `✓ getTransactionStatus returned ${status.receipts.length} receipts for transaction`,
    )
    console.log(`  Transaction hash: ${txHash}`)
    console.log(`  First receipt ID: ${receipt.receipt_id}`)
  })

  test("should work with different wait_until levels", async () => {
    const recipientKey = generateKey()
    const recipientId = `recipient-wait-${Date.now()}.${sandbox.rootAccount.id}`

    // Send a transaction
    const result = await near
      .transaction(sandbox.rootAccount.id)
      .createAccount(recipientId)
      .transfer(recipientId, "3 NEAR")
      .addKey(recipientKey.publicKey.toString(), {
        type: "fullAccess",
      })
      .send()

    const txHash = result.transaction.hash

    // Query with EXECUTED_OPTIMISTIC (default)
    const statusOptimistic = await near.getTransactionStatus(
      txHash,
      sandbox.rootAccount.id,
    )

    expect(statusOptimistic.final_execution_status).toBe("EXECUTED_OPTIMISTIC")
    expect(statusOptimistic.receipts).toBeDefined()

    // Query with FINAL
    const statusFinal = await near.getTransactionStatus(
      txHash,
      sandbox.rootAccount.id,
      "FINAL",
    )

    expect(statusFinal.final_execution_status).toBe("FINAL")
    expect(statusFinal.receipts).toBeDefined()

    console.log("✓ getTransactionStatus works with multiple wait_until levels")
  })

  test("should surface receipts at an early wait level", async () => {
    const recipientKey = generateKey()
    const recipientId = `recipient-early-${Date.now()}.${sandbox.rootAccount.id}`

    const result = await near
      .transaction(sandbox.rootAccount.id)
      .createAccount(recipientId)
      .transfer(recipientId, "4 NEAR")
      .addKey(recipientKey.publicKey.toString(), {
        type: "fullAccess",
      })
      .send({ waitUntil: "EXECUTED_OPTIMISTIC" })

    const txHash = result.transaction.hash

    // Query with an early wait level ("NONE"). wait_until only controls how long
    // the node blocks, not what it returns: EXPERIMENTAL_tx_status hands back the
    // full receipts/receipts_outcome regardless. Previously the schema dropped
    // receipts_outcome for the early-level branches; it must survive now.
    const status = await near.getTransactionStatus(
      txHash,
      sandbox.rootAccount.id,
      "NONE",
    )

    expect(status.receipts).toBeDefined()
    expect(Array.isArray(status.receipts)).toBe(true)
    expect(status.receipts.length).toBeGreaterThan(0)

    // receipts_outcome is optional at early levels but must not be stripped when
    // the node returns it.
    expect(status.receipts_outcome).toBeDefined()
    expect(Array.isArray(status.receipts_outcome)).toBe(true)
    expect((status.receipts_outcome ?? []).length).toBeGreaterThan(0)

    // The receiver_id -> stage mapping the frontend relies on is present.
    for (const r of status.receipts) {
      expect(typeof r.receiver_id).toBe("string")
    }

    console.log(
      `✓ early wait level surfaced ${status.receipts.length} receipts / ${
        (status.receipts_outcome ?? []).length
      } receipt outcomes`,
    )
  })

  test("should handle transaction failures correctly", async () => {
    const recipientKey = generateKey()
    const recipientId = `recipient-fail-${Date.now()}.${sandbox.rootAccount.id}`

    // Create account first
    await near
      .transaction(sandbox.rootAccount.id)
      .createAccount(recipientId)
      .transfer(recipientId, "5 NEAR")
      .addKey(recipientKey.publicKey.toString(), {
        type: "fullAccess",
      })
      .send()

    // Try to create the same account again (will fail)
    try {
      await near
        .transaction(sandbox.rootAccount.id)
        .createAccount(recipientId) // This will fail - account already exists
        .send()

      throw new Error("Expected transaction to fail")
    } catch (error: unknown) {
      if (!(error instanceof InvalidTransactionError)) {
        throw error
      }
      // The transaction should fail during send()
      expect(error.name).toBe("InvalidTransactionError")
      expect(error.message).toContain("AccountAlreadyExists")

      console.log(
        "✓ Transaction failure handled correctly by getTransactionStatus",
      )
    }
  })
})
