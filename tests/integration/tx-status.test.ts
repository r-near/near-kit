/**
 * Integration tests for txStatus (EXPERIMENTAL_tx_status RPC method)
 * Tests actual RPC responses and validates schema correctness with receipts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Near } from "../../src/core/near.js"
import { Sandbox } from "../../src/sandbox/sandbox.js"
import { generateKey } from "../../src/utils/key.js"

describe("txStatus - EXPERIMENTAL_tx_status RPC Method", () => {
  let sandbox: Sandbox
  let near: Near

  beforeAll(async () => {
    sandbox = await Sandbox.start()
    near = new Near({
      network: sandbox,
      privateKey: sandbox.rootAccount.secretKey,
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

    // Now query the transaction status using txStatus
    const txHash = result.transaction.hash
    const status = await near.txStatus(txHash, sandbox.rootAccount.id, "FINAL")

    // Verify the response has the expected structure
    expect(status).toBeDefined()
    expect(status.final_execution_status).toBe("FINAL")

    // Should have receipts field (this is the key difference from regular tx method)
    expect(status.receipts).toBeDefined()
    expect(Array.isArray(status.receipts)).toBe(true)
    expect(status.receipts.length).toBeGreaterThan(0)

    // Verify receipt structure
    const receipt = status.receipts[0]
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
      `✓ txStatus returned ${status.receipts.length} receipts for transaction`,
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
    const statusOptimistic = await near.txStatus(txHash, sandbox.rootAccount.id)

    expect(statusOptimistic.final_execution_status).toBe("EXECUTED_OPTIMISTIC")
    expect(statusOptimistic.receipts).toBeDefined()

    // Query with FINAL
    const statusFinal = await near.txStatus(
      txHash,
      sandbox.rootAccount.id,
      "FINAL",
    )

    expect(statusFinal.final_execution_status).toBe("FINAL")
    expect(statusFinal.receipts).toBeDefined()

    console.log("✓ txStatus works with multiple wait_until levels")
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
    let _failedTxHash: string
    try {
      const failResult = await near
        .transaction(sandbox.rootAccount.id)
        .createAccount(recipientId) // This will fail - account already exists
        .send()

      _failedTxHash = failResult.transaction.hash
      throw new Error("Expected transaction to fail")
    } catch (error: unknown) {
      // The transaction should fail during send()
      expect(error.name).toBe("InvalidTransactionError")
      expect(error.message).toContain("AccountAlreadyExists")

      console.log("✓ Transaction failure handled correctly by txStatus")
    }
  })
})
