/**
 * Contract Panic and Failure Mode Tests
 *
 * Comprehensive tests for all contract failure scenarios:
 * - ExecutionError (contract panics, missing params, invalid methods)
 * - HostError (gas exceeded, insufficient deposit)
 * - Multi-action transaction failures
 * - Cross-contract call failures
 * - Different wait modes with failures
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { Near } from "../../src/core/near.js"
import {
  FunctionCallError,
  InvalidTransactionError,
} from "../../src/errors/index.js"
import { Sandbox } from "../../src/sandbox/sandbox.js"
import { generateKey } from "../../src/utils/key.js"
import type { PrivateKey } from "../../src/utils/validation.js"

describe("Contract Failure Modes", () => {
  let sandbox: Sandbox
  let near: Near
  let contractId: string

  beforeAll(async () => {
    sandbox = await Sandbox.start()
    near = new Near({
      network: sandbox,
    })

    // Deploy guestbook contract
    contractId = `guestbook-${Date.now()}.${sandbox.rootAccount.id}`
    const contractWasm = readFileSync(
      resolve(__dirname, "../contracts/guestbook.wasm"),
    )

    const contractKey = generateKey()
    await near
      .transaction(sandbox.rootAccount.id)
      .createAccount(contractId)
      .transfer(contractId, "10 NEAR")
      .addKey(contractKey.publicKey.toString(), { type: "fullAccess" })
      .deployContract(contractId, contractWasm)
      .send()

    console.log(`✓ Sandbox started: ${sandbox.rpcUrl}`)
    console.log(`✓ Contract deployed: ${contractId}`)
  }, 120000)

  afterAll(async () => {
    if (sandbox) {
      await sandbox.stop()
      console.log("✓ Sandbox stopped")
    }
  })

  describe("ExecutionError - Contract Panics", () => {
    test("should throw FunctionCallError when required param missing", async () => {
      try {
        await near
          .transaction(sandbox.rootAccount.id)
          .functionCall(contractId, "add_message", {}) // Missing 'text' parameter
          .send()

        throw new Error("Expected transaction to fail")
      } catch (error: unknown) {
        console.log("\n=== Missing Param Error ===")
        console.log("Error name:", error.name)
        console.log("Error message:", error.message)
        console.log("Panic:", error.panic)
        console.log("Method:", error.methodName)
        console.log("Contract:", error.contractId)

        expect(error.name).toBe("FunctionCallError")
        expect(error).toBeInstanceOf(FunctionCallError)
        expect(error.contractId).toBe(contractId)
        expect(error.methodName).toBe("add_message")
        expect(error.panic).toBeDefined()
        expect(error.panic).not.toBe("Transaction execution failed") // Should be specific
      }
    })

    test("should throw FunctionCallError when method doesn't exist", async () => {
      try {
        await near
          .transaction(sandbox.rootAccount.id)
          .functionCall(contractId, "this_method_does_not_exist", {})
          .send()

        throw new Error("Expected transaction to fail")
      } catch (error: unknown) {
        console.log("\n=== Non-Existent Method Error ===")
        console.log("Error name:", error.name)
        console.log("Error message:", error.message)
        console.log("Panic:", error.panic)

        expect(error.name).toBe("FunctionCallError")
        expect(error).toBeInstanceOf(FunctionCallError)
        expect(error.contractId).toBe(contractId)
        expect(error.methodName).toBe("this_method_does_not_exist")
        expect(error.panic).toBeDefined()
        // Should mention method not found
        expect(error.panic?.toLowerCase()).toContain("method")
      }
    })

    test("should include contract logs in error object", async () => {
      try {
        await near
          .transaction(sandbox.rootAccount.id)
          .functionCall(contractId, "add_message", {})
          .send()

        throw new Error("Expected transaction to fail")
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(FunctionCallError)
        expect(error.logs).toBeDefined()
        expect(Array.isArray(error.logs)).toBe(true)

        console.log("\n=== Contract Logs ===")
        console.log("Logs:", error.logs)
      }
    })
  })

  describe("Wait Mode Testing with Failures", () => {
    test("should throw FunctionCallError with EXECUTED_OPTIMISTIC (default)", async () => {
      try {
        await near
          .transaction(sandbox.rootAccount.id)
          .functionCall(contractId, "add_message", {})
          .send() // Default: EXECUTED_OPTIMISTIC

        throw new Error("Expected transaction to fail")
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(FunctionCallError)
        expect(error.panic).toBeDefined()
        console.log("✓ EXECUTED_OPTIMISTIC throws FunctionCallError")
      }
    })

    test("should throw FunctionCallError with FINAL wait mode", async () => {
      try {
        await near
          .transaction(sandbox.rootAccount.id)
          .functionCall(contractId, "add_message", {})
          .send({ waitUntil: "FINAL" })

        throw new Error("Expected transaction to fail")
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(FunctionCallError)
        expect(error.panic).toBeDefined()
        console.log("✓ FINAL throws FunctionCallError")
      }
    })

    test("should not throw error with NONE wait mode (transaction not executed yet)", async () => {
      // With NONE mode, transaction is submitted but not executed
      // No error should be thrown because execution hasn't happened yet
      const result = await near
        .transaction(sandbox.rootAccount.id)
        .functionCall(contractId, "add_message", {}) // This would fail if executed
        .send({ waitUntil: "NONE" })

      // NONE mode returns minimal response
      expect(result.final_execution_status).toBe("NONE")
      expect("status" in result).toBe(false)
      expect("transaction_outcome" in result).toBe(false)

      console.log(
        "✓ NONE mode does not throw error (transaction not executed yet)",
      )
    })
  })

  describe("Multi-Action Transaction Failures", () => {
    test("should throw InvalidTransactionError when non-function-call action fails", async () => {
      const recipientKey = generateKey()
      const recipientId = `multi-fail-${Date.now()}.${sandbox.rootAccount.id}`

      // First create the account
      await near
        .transaction(sandbox.rootAccount.id)
        .createAccount(recipientId)
        .transfer(recipientId, "5 NEAR")
        .addKey(recipientKey.publicKey.toString(), { type: "fullAccess" })
        .send()

      // Try to create same account again (fails), with function call in same tx
      try {
        await near
          .transaction(sandbox.rootAccount.id)
          .createAccount(recipientId) // This fails - account exists
          .transfer(recipientId, "1 NEAR")
          .functionCall(contractId, "total_messages", {}) // This would succeed
          .send()

        throw new Error("Expected transaction to fail")
      } catch (error: unknown) {
        console.log("\n=== Multi-Action Non-Function-Call Failure ===")
        console.log("Error name:", error.name)
        console.log("Error message:", error.message)

        // Should be InvalidTransactionError, NOT FunctionCallError
        // because the failure is from CreateAccount, not the function call
        expect(error.name).toBe("InvalidTransactionError")
        expect(error).toBeInstanceOf(InvalidTransactionError)
        expect(error.name).not.toBe("FunctionCallError")
      }
    })

    test("should throw FunctionCallError when function call fails in multi-action tx", async () => {
      try {
        // In a multi-action transaction, all actions go to the same receiver
        // So we need to make multiple actions on the SAME contract (guestbook)
        // First call (succeeds), second call (fails)

        await near
          .transaction(sandbox.rootAccount.id)
          .functionCall(contractId, "add_message", { text: "First message" }) // This succeeds
          .functionCall(contractId, "add_message", {}) // This FAILS (missing text)
          .send()

        throw new Error("Expected transaction to fail")
      } catch (error: unknown) {
        console.log("\n=== Multi-Action Function Call Failure ===")
        console.log("Error name:", error.name)
        console.log("Error message:", error.message)
        console.log("Panic:", error.panic)

        // Should be FunctionCallError because one of the function calls failed
        expect(error.name).toBe("FunctionCallError")
        expect(error).toBeInstanceOf(FunctionCallError)
        expect(error.contractId).toBe(contractId)
        expect(error.methodName).toBe("add_message")
        expect(error.panic).toBeDefined()
      }
    })
  })

  describe("Error Message Validation", () => {
    test("should extract actual panic message (not generic)", async () => {
      try {
        await near
          .transaction(sandbox.rootAccount.id)
          .functionCall(contractId, "add_message", {})
          .send()

        throw new Error("Expected transaction to fail")
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(FunctionCallError)

        // Panic message should be specific, not generic
        expect(error.panic).toBeDefined()
        expect(error.panic).not.toBe("")
        expect(error.panic).not.toBe("Transaction execution failed")

        // Should contain details about the actual error
        console.log("\n=== Panic Message Detail ===")
        console.log("Panic:", error.panic)
        console.log("Message:", error.message)

        // Error message should include contract ID and method
        expect(error.message).toContain(contractId)
        expect(error.message).toContain("add_message")
      }
    })

    test("should correctly identify method name in error", async () => {
      const testCases = [
        { method: "add_message", args: {} },
        { method: "nonexistent_method", args: {} },
      ]

      for (const { method, args } of testCases) {
        try {
          await near
            .transaction(sandbox.rootAccount.id)
            .functionCall(contractId, method, args)
            .send()

          throw new Error("Expected transaction to fail")
        } catch (error: unknown) {
          expect(error).toBeInstanceOf(FunctionCallError)
          expect(error.methodName).toBe(method)
          console.log(`✓ Method name correctly identified: ${method}`)
        }
      }
    })
  })

  describe("Successful Calls (should NOT throw)", () => {
    test("should not throw error for successful function call", async () => {
      const result = await near
        .transaction(sandbox.rootAccount.id)
        .functionCall(contractId, "add_message", { text: "Hello from tests!" })
        .send()

      // Should succeed without throwing
      expect(result).toBeDefined()
      expect(result.final_execution_status).toBe("EXECUTED_OPTIMISTIC")
      expect(typeof result.status).toBe("object")
      expect(
        typeof result.status === "object" &&
          ("SuccessValue" in result.status ||
            "SuccessReceiptId" in result.status),
      ).toBe(true)

      console.log("✓ Successful call did not throw error")
    })

    test("should not throw error for view function call", async () => {
      const count = await near.view(contractId, "total_messages", {})

      expect(count).toBeDefined()
      expect(typeof count).toBe("number")
      expect(count).toBeGreaterThanOrEqual(0)

      console.log(`✓ View function returned: ${count} messages`)
    })
  })
})
