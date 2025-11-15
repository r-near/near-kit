/**
 * Integration Tests for Contract Interface (near.contract<T>())
 *
 * Tests the typed contract proxy feature:
 * - Type-safe view methods
 * - Type-safe call methods
 * - Correct parameter passing
 * - Return type inference
 * - Error handling
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Near } from "../../src/core/near.js"
import type { ContractMethods } from "../../src/contracts/contract.js"
import { FunctionCallError } from "../../src/errors/index.js"
import { Sandbox } from "../../src/sandbox/sandbox.js"
import { generateKey } from "../../src/utils/key.js"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

// Define Guestbook contract interface
interface GuestbookMessage {
  premium: boolean
  sender: string
  text: string
}

interface GuestbookContract extends ContractMethods {
  view: {
    total_messages: () => Promise<number>
    get_messages: (args?: {
      from_index?: string
      limit?: string
    }) => Promise<GuestbookMessage[]>
  }
  call: {
    add_message: (args: { text: string }, options?: { attachedDeposit?: string; signerId?: string; waitUntil?: string }) => Promise<void>
  }
}

describe("Contract Interface - near.contract<T>()", () => {
  let sandbox: Sandbox
  let near: Near
  let contractId: string
  let userId: string
  let contract: GuestbookContract

  beforeAll(async () => {
    sandbox = await Sandbox.start()

    // Deploy guestbook contract
    contractId = `contract-interface-${Date.now()}.${sandbox.rootAccount.id}`
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

    // Create user account
    const userKey = generateKey()
    userId = `user-${Date.now()}.${sandbox.rootAccount.id}`
    await new Near({ network: sandbox, keyStore: { [sandbox.rootAccount.id]: sandbox.rootAccount.secretKey } })
      .transaction(sandbox.rootAccount.id)
      .createAccount(userId)
      .transfer(userId, "10 NEAR")
      .addKey(userKey.publicKey.toString(), { type: "fullAccess" })
      .send({ waitUntil: "FINAL" })

    // Create Near instance
    near = new Near({
      network: sandbox,
      keyStore: {
        [sandbox.rootAccount.id]: sandbox.rootAccount.secretKey,
        [contractId]: contractKey.secretKey,
        [userId]: userKey.secretKey,
      },
      defaultSignerId: userId,
      defaultWaitUntil: "FINAL", // Use FINAL for sandbox tests to ensure state persistence
    })

    // Create typed contract interface
    contract = near.contract<GuestbookContract>(contractId)

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

  describe("View Methods", () => {
    test("should call total_messages() with correct return type", async () => {
      const count = await contract.view.total_messages()

      // TypeScript should infer this as number
      expect(typeof count).toBe("number")
      expect(count).toBeGreaterThanOrEqual(0)

      console.log(`✓ total_messages() returned: ${count}`)
    })

    test("should call get_messages() with no arguments", async () => {
      const messages = await contract.view.get_messages()

      // TypeScript should infer this as GuestbookMessage[]
      expect(Array.isArray(messages)).toBe(true)

      console.log(`✓ get_messages() returned ${messages.length} messages`)
    })

    test("should call get_messages() with pagination arguments", async () => {
      const messages = await contract.view.get_messages({
        limit: "5",
      })

      expect(Array.isArray(messages)).toBe(true)
      expect(messages.length).toBeLessThanOrEqual(5)

      console.log(`✓ get_messages(limit: 5) returned ${messages.length} messages`)
    })

    test("should call get_messages() with from_index and limit", async () => {
      const messages = await contract.view.get_messages({
        from_index: "0",
        limit: "2",
      })

      expect(Array.isArray(messages)).toBe(true)
      expect(messages.length).toBeLessThanOrEqual(2)

      console.log(
        `✓ get_messages(from_index: 0, limit: 2) returned ${messages.length} messages`,
      )
    })
  })

  describe("Call Methods", () => {
    test("should call add_message() with required args", async () => {
      const initialCount = await contract.view.total_messages()

      await contract.call.add_message(
        { text: "Hello from contract interface!" },
        { signerId: userId } // Using default EXECUTED_OPTIMISTIC
      )

      const finalCount = await contract.view.total_messages()

      expect(finalCount).toBe(initialCount + 1)

      console.log("✓ add_message() succeeded")
    }, 30000)

    test("should call add_message() with attached deposit", async () => {
      await contract.call.add_message(
        { text: "Premium message!" },
        { attachedDeposit: "1 NEAR", signerId: userId }
      )

      const messages = await contract.view.get_messages()
      const lastMessage = messages[messages.length - 1]

      expect(lastMessage.text).toBe("Premium message!")
      expect(lastMessage.premium).toBe(true)

      console.log("✓ add_message() with deposit succeeded")
    }, 30000)

    test("should call add_message() multiple times", async () => {
      const initialCount = await contract.view.total_messages()

      await contract.call.add_message({ text: "Message 1" }, { signerId: userId })
      await contract.call.add_message({ text: "Message 2" }, { signerId: userId })
      await contract.call.add_message({ text: "Message 3" }, { signerId: userId })

      const finalCount = await contract.view.total_messages()

      expect(finalCount).toBe(initialCount + 3)

      console.log("✓ Multiple add_message() calls succeeded")
    }, 90000)
  })

  describe("Error Handling", () => {
    test("should throw error when required parameter is missing", async () => {
      try {
        // @ts-expect-error - Intentionally testing missing parameter
        await contract.call.add_message({}, { signerId: userId })

        throw new Error("Expected transaction to fail")
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(FunctionCallError)
        if (error instanceof FunctionCallError) {
          expect(error.contractId).toBe(contractId)
          expect(error.methodName).toBe("add_message")
          expect(error.panic).toBeDefined()

          console.log("✓ Missing parameter throws FunctionCallError")
        }
      }
    }, 30000)

    test("should throw error when calling non-existent method", async () => {
      try {
        // Use any to bypass TypeScript checking for this test
        const anyContract = contract as any

        await anyContract.call.nonexistent_method({ test: "data" }, { signerId: userId })

        throw new Error("Expected transaction to fail")
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(FunctionCallError)
        if (error instanceof FunctionCallError) {
          expect(error.contractId).toBe(contractId)
          expect(error.methodName).toBe("nonexistent_method")

          console.log("✓ Non-existent method throws FunctionCallError")
        }
      }
    }, 30000)
  })

  describe("Type Safety", () => {
    test("view methods should return correct types", async () => {
      const count = await contract.view.total_messages()
      const messages = await contract.view.get_messages()

      // Runtime type checks
      expect(typeof count).toBe("number")
      expect(Array.isArray(messages)).toBe(true)

      if (messages.length > 0) {
        const message = messages[0]
        expect(typeof message.text).toBe("string")
        expect(typeof message.sender).toBe("string")
        expect(typeof message.premium).toBe("boolean")
      }

      console.log("✓ View methods return correctly typed values")
    })

    test("should handle empty results", async () => {
      // Deploy new contract with no messages
      const emptyContractId = `empty-${Date.now()}.${sandbox.rootAccount.id}`
      const contractWasm = readFileSync(
        resolve(__dirname, "../contracts/guestbook.wasm"),
      )

      const emptyKey = generateKey()
      await near
        .transaction(sandbox.rootAccount.id)
        .createAccount(emptyContractId)
        .transfer(emptyContractId, "10 NEAR")
        .addKey(emptyKey.publicKey.toString(), { type: "fullAccess" })
        .deployContract(emptyContractId, contractWasm)
        .send({ waitUntil: "FINAL" })

      const emptyContract = near.contract<GuestbookContract>(emptyContractId)

      const count = await emptyContract.view.total_messages()
      const messages = await emptyContract.view.get_messages()

      expect(count).toBe(0)
      expect(messages).toEqual([])

      console.log("✓ Empty contract returns correct defaults")
    }, 60000)
  })

  describe("Message Verification", () => {
    test("should verify message content and metadata", async () => {
      const testText = "Test message with special chars: 🎉 & symbols!"

      await contract.call.add_message({ text: testText }, { signerId: userId })

      const messages = await contract.view.get_messages()
      const lastMessage = messages[messages.length - 1]

      expect(lastMessage.text).toBe(testText)
      expect(lastMessage.sender).toBe(userId)
      expect(lastMessage.premium).toBe(false)

      console.log("✓ Message content and metadata verified")
    }, 30000)

    test("should verify premium message", async () => {
      await contract.call.add_message(
        { text: "Premium test" },
        { attachedDeposit: "0.5 NEAR", signerId: userId }
      )

      const messages = await contract.view.get_messages()
      const lastMessage = messages[messages.length - 1]

      expect(lastMessage.text).toBe("Premium test")
      expect(lastMessage.premium).toBe(true)
      expect(lastMessage.sender).toBe(userId)

      console.log("✓ Premium message verified")
    }, 30000)
  })

  describe("Contract Interface Usability", () => {
    test("should provide cleaner API than direct near.view()", async () => {
      // Old way
      const countOld = await near.view<number>(contractId, "total_messages", {})

      // New way (contract interface)
      const countNew = await contract.view.total_messages()

      expect(countOld).toBe(countNew)

      console.log("✓ Contract interface provides equivalent functionality")
    })

    test("should work with both view and call methods in sequence", async () => {
      const before = await contract.view.total_messages()

      await contract.call.add_message({ text: "Sequence test unique12345" }, { signerId: userId })

      const after = await contract.view.total_messages()

      expect(after).toBe(before + 1)

      const messages = await contract.view.get_messages()
      const hasMessage = messages.some(m => m.text === "Sequence test unique12345")

      expect(hasMessage).toBe(true)

      console.log("✓ View and call methods work sequentially")
    }, 30000)

    test("should support method chaining pattern", async () => {
      const before = await contract.view.total_messages()

      // Multiple operations in sequence
      await contract.call.add_message({ text: "Chain unique1" }, { signerId: userId })
      await contract.call.add_message({ text: "Chain unique2" }, { signerId: userId })
      await contract.call.add_message({ text: "Chain unique3" }, { signerId: userId })

      const after = await contract.view.total_messages()
      expect(after).toBe(before + 3)

      // Get recent messages starting from where we added them
      const messages = await contract.view.get_messages({
        from_index: before.toString(),
        limit: "3"
      })

      const hasChain1 = messages.some(m => m.text === "Chain unique1")
      const hasChain2 = messages.some(m => m.text === "Chain unique2")
      const hasChain3 = messages.some(m => m.text === "Chain unique3")

      expect(hasChain1).toBe(true)
      expect(hasChain2).toBe(true)
      expect(hasChain3).toBe(true)

      console.log("✓ Method chaining pattern works")
    }, 120000)
  })

  describe("Advanced Usage", () => {
    test("should handle optional parameters correctly", async () => {
      // Call with no args
      const messages1 = await contract.view.get_messages()

      // Call with partial args
      const messages2 = await contract.view.get_messages({ limit: "1" })

      // Call with all args
      const messages3 = await contract.view.get_messages({
        from_index: "0",
        limit: "1",
      })

      expect(Array.isArray(messages1)).toBe(true)
      expect(Array.isArray(messages2)).toBe(true)
      expect(Array.isArray(messages3)).toBe(true)

      console.log("✓ Optional parameters handled correctly")
    })

    test("should handle edge cases in parameters", async () => {
      const before = await contract.view.total_messages()

      // Empty string
      await contract.call.add_message({ text: "" }, { signerId: userId })

      // Very long string
      const longText = "A".repeat(1000)
      await contract.call.add_message({ text: longText }, { signerId: userId })

      // Special characters
      const specialText = "Special unique789: 🎉 émojis & symbols"
      await contract.call.add_message({ text: specialText }, { signerId: userId })

      const after = await contract.view.total_messages()
      expect(after).toBe(before + 3)

      // Get recent messages starting from where we added them
      const messages = await contract.view.get_messages({
        from_index: before.toString(),
        limit: "3"
      })

      const hasEmpty = messages.some(m => m.text === "")
      const hasLong = messages.some(m => m.text === longText)
      const hasSpecial = messages.some(m => m.text === specialText)

      expect(hasEmpty).toBe(true)
      expect(hasLong).toBe(true)
      expect(hasSpecial).toBe(true)

      console.log("✓ Edge cases in parameters handled")
    }, 120000)
  })
})
