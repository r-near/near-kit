/**
 * Comprehensive Integration Tests for Guestbook Contract
 *
 * Tests all guestbook contract functionality:
 * - View methods: total_messages(), get_messages()
 * - Call methods: add_message()
 * - State persistence and verification
 * - Multiple accounts interacting with same contract
 * - Edge cases and error handling
 */

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { Near } from "../../src/core/near.js"
import { FunctionCallError } from "../../src/errors/index.js"
import { Sandbox } from "../../src/sandbox/sandbox.js"
import { generateKey } from "../../src/utils/key.js"

describe("Guestbook Contract - Comprehensive Tests", () => {
  let sandbox: Sandbox
  let near: Near
  let contractId: string
  let user1Id: string
  let user2Id: string

  beforeAll(async () => {
    sandbox = await Sandbox.start()
    near = new Near({
      network: sandbox,
      keyStore: {
        [sandbox.rootAccount.id]: sandbox.rootAccount.secretKey,
      },
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

    // Create two user accounts for testing
    const user1Key = generateKey()
    user1Id = `user1-${Date.now()}.${sandbox.rootAccount.id}`
    await near
      .transaction(sandbox.rootAccount.id)
      .createAccount(user1Id)
      .transfer(user1Id, "5 NEAR")
      .addKey(user1Key.publicKey.toString(), { type: "fullAccess" })
      .send()

    const user2Key = generateKey()
    user2Id = `user2-${Date.now()}.${sandbox.rootAccount.id}`
    await near
      .transaction(sandbox.rootAccount.id)
      .createAccount(user2Id)
      .transfer(user2Id, "5 NEAR")
      .addKey(user2Key.publicKey.toString(), { type: "fullAccess" })
      .send()

    // Add keys to keystore for users
    near = new Near({
      network: sandbox,
      keyStore: {
        [sandbox.rootAccount.id]: sandbox.rootAccount.secretKey,
        [contractId]: contractKey.secretKey,
        [user1Id]: user1Key.secretKey,
        [user2Id]: user2Key.secretKey,
      },
    })

    console.log(`✓ Sandbox started: ${sandbox.rpcUrl}`)
    console.log(`✓ Contract deployed: ${contractId}`)
    console.log(`✓ User accounts: ${user1Id}, ${user2Id}`)
  }, 120000)

  afterAll(async () => {
    if (sandbox) {
      await sandbox.stop()
      console.log("✓ Sandbox stopped")
    }
  })

  describe("View Methods - Initial State", () => {
    test("total_messages() should return 0 initially", async () => {
      const count = await near.view<number>(contractId, "total_messages", {})

      expect(count).toBe(0)
      console.log("✓ Initial message count: 0")
    })

    test("get_messages() should return empty array initially", async () => {
      const messages = await near.view<unknown[]>(
        contractId,
        "get_messages",
        {},
      )

      expect(Array.isArray(messages)).toBe(true)
      // biome-ignore lint/style/noNonNullAssertion: test knows view returns data
      expect(messages!.length).toBe(0)
      console.log("✓ Initial messages: []")
    })
  })

  describe("Call Methods - Adding Messages", () => {
    test("should add a message from user1", async () => {
      const result = await near
        .transaction(user1Id)
        .functionCall(contractId, "add_message", { text: "Hello from user1!" })
        .send({ waitUntil: "FINAL" })

      expect(result).toBeDefined()
      expect(result.final_execution_status).toBe("FINAL")

      // Verify message was added
      const count = await near.view<number>(contractId, "total_messages", {})
      expect(count).toBe(1)
      console.log("✓ Message added, count: 1")
    }, 30000)

    test("should add a message from user2", async () => {
      await near
        .transaction(user2Id)
        .functionCall(contractId, "add_message", {
          text: "Greetings from user2!",
        })
        .send({ waitUntil: "FINAL" })

      // Verify message count increased
      const count = await near.view<number>(contractId, "total_messages", {})
      expect(count).toBe(2)
      console.log("✓ Second message added, count: 2")
    }, 30000)

    test("should add multiple messages from same user", async () => {
      await near
        .transaction(user1Id)
        .functionCall(contractId, "add_message", {
          text: "Second message from user1",
        })
        .send({ waitUntil: "FINAL" })

      await near
        .transaction(user1Id)
        .functionCall(contractId, "add_message", {
          text: "Third message from user1",
        })
        .send({ waitUntil: "FINAL" })

      const count = await near.view<number>(contractId, "total_messages", {})
      expect(count).toBe(4)
      console.log("✓ Multiple messages from same user, count: 4")
    }, 60000)
  })

  describe("View Methods - After Adding Messages", () => {
    test("get_messages() should return all messages", async () => {
      interface Message {
        premium: boolean
        sender: string
        text: string
      }

      const messages = await near.view<Message[]>(
        contractId,
        "get_messages",
        {},
      )

      expect(Array.isArray(messages)).toBe(true)
      // biome-ignore lint/style/noNonNullAssertion: test knows view returns data
      expect(messages!.length).toBe(4)

      // Verify message structure
      // biome-ignore lint/style/noNonNullAssertion: test knows view returns data
      expect(messages![0]).toHaveProperty("text")
      // biome-ignore lint/style/noNonNullAssertion: test knows view returns data
      expect(messages![0]).toHaveProperty("sender")
      // biome-ignore lint/style/noNonNullAssertion: test knows view returns data
      expect(messages![0]).toHaveProperty("premium")

      // Verify message content (order matters - should be chronological)
      // biome-ignore lint/style/noNonNullAssertion: test knows array element exists
      expect(messages![0]!.text).toBe("Hello from user1!")
      // biome-ignore lint/style/noNonNullAssertion: test knows array element exists
      expect(messages![0]!.sender).toBe(user1Id)

      // biome-ignore lint/style/noNonNullAssertion: test knows array element exists
      expect(messages![1]!.text).toBe("Greetings from user2!")
      // biome-ignore lint/style/noNonNullAssertion: test knows array element exists
      expect(messages![1]!.sender).toBe(user2Id)

      console.log("✓ All messages retrieved with correct structure")
    })

    test("get_messages() with pagination - from_index", async () => {
      interface Message {
        premium: boolean
        sender: string
        text: string
      }

      const messages = await near.view<Message[]>(contractId, "get_messages", {
        from_index: "2",
      })

      // biome-ignore lint/style/noNonNullAssertion: test knows view returns data
      expect(messages!.length).toBe(2) // Should get messages from index 2 onwards
      // biome-ignore lint/style/noNonNullAssertion: test knows array element exists
      expect(messages![0]!.text).toBe("Second message from user1")

      console.log("✓ Pagination with from_index works")
    })

    test("get_messages() with pagination - limit", async () => {
      interface Message {
        premium: boolean
        sender: string
        text: string
      }

      const messages = await near.view<Message[]>(contractId, "get_messages", {
        limit: "2",
      })

      // biome-ignore lint/style/noNonNullAssertion: test knows view returns data
      expect(messages!.length).toBe(2)
      // biome-ignore lint/style/noNonNullAssertion: test knows array element exists
      expect(messages![0]!.text).toBe("Hello from user1!")
      // biome-ignore lint/style/noNonNullAssertion: test knows array element exists
      expect(messages![1]!.text).toBe("Greetings from user2!")

      console.log("✓ Pagination with limit works")
    })

    test("get_messages() with both from_index and limit", async () => {
      interface Message {
        premium: boolean
        sender: string
        text: string
      }

      const messages = await near.view<Message[]>(contractId, "get_messages", {
        from_index: "1",
        limit: "2",
      })

      // biome-ignore lint/style/noNonNullAssertion: test knows view returns data
      expect(messages!.length).toBe(2)
      // biome-ignore lint/style/noNonNullAssertion: test knows array element exists
      expect(messages![0]!.text).toBe("Greetings from user2!")
      // biome-ignore lint/style/noNonNullAssertion: test knows array element exists
      expect(messages![1]!.text).toBe("Second message from user1")

      console.log("✓ Pagination with from_index and limit works")
    })
  })

  describe("Error Handling", () => {
    test("should throw FunctionCallError when text parameter is missing", async () => {
      try {
        await near
          .transaction(user1Id)
          .functionCall(contractId, "add_message", {})
          .send()

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
    })

    test("should throw FunctionCallError when calling non-existent method", async () => {
      try {
        await near
          .transaction(user1Id)
          .functionCall(contractId, "nonexistent_method", {})
          .send()

        throw new Error("Expected transaction to fail")
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(FunctionCallError)
        if (error instanceof FunctionCallError) {
          expect(error.methodName).toBe("nonexistent_method")
          console.log("✓ Non-existent method throws FunctionCallError")
        }
      }
    })

    test("should handle empty string message", async () => {
      await near
        .transaction(user1Id)
        .functionCall(contractId, "add_message", { text: "" })
        .send({ waitUntil: "FINAL" })

      // Should succeed (contract allows empty messages)
      const count = await near.view<number>(contractId, "total_messages", {})
      expect(count).toBeGreaterThan(4)
      console.log("✓ Empty string message accepted")
    }, 30000)

    test("should handle very long message", async () => {
      const longText = "A".repeat(1000)

      await near
        .transaction(user1Id)
        .functionCall(contractId, "add_message", { text: longText })
        .send({ waitUntil: "FINAL" })

      const count = await near.view<number>(contractId, "total_messages", {})
      expect(count).toBeGreaterThan(5)
      console.log("✓ Long message (1000 chars) accepted")
    }, 30000)

    test("should handle special characters in message", async () => {
      const specialText = "Special chars: 🎉 émojis & symbols !@#$%^&*()"

      await near
        .transaction(user1Id)
        .functionCall(contractId, "add_message", { text: specialText })
        .send({ waitUntil: "FINAL" })

      interface Message {
        premium: boolean
        sender: string
        text: string
      }

      const messages = await near.view<Message[]>(
        contractId,
        "get_messages",
        {},
      )

      // biome-ignore lint/style/noNonNullAssertion: Test code expects message to exist
      const lastMessage = messages![messages!.length - 1]!
      expect(lastMessage.text).toBe(specialText)
      console.log("✓ Special characters handled correctly")
    }, 30000)
  })

  describe("State Persistence", () => {
    test("should persist state across multiple view calls", async () => {
      const count1 = await near.view<number>(contractId, "total_messages", {})
      const count2 = await near.view<number>(contractId, "total_messages", {})
      const count3 = await near.view<number>(contractId, "total_messages", {})

      expect(count1).toBe(count2)
      expect(count2).toBe(count3)
      console.log("✓ State persists across view calls")
    })

    test("should persist state after adding and querying", async () => {
      const beforeCount = await near.view<number>(
        contractId,
        "total_messages",
        {},
      )

      await near
        .transaction(user2Id)
        .functionCall(contractId, "add_message", {
          text: "Testing persistence",
        })
        .send({ waitUntil: "FINAL" })

      const afterCount = await near.view<number>(
        contractId,
        "total_messages",
        {},
      )

      // biome-ignore lint/style/noNonNullAssertion: test knows view returns data
      expect(afterCount).toBe(beforeCount! + 1)

      interface Message {
        premium: boolean
        sender: string
        text: string
      }

      const messages = await near.view<Message[]>(
        contractId,
        "get_messages",
        {},
      )
      // biome-ignore lint/style/noNonNullAssertion: Test code expects message to exist
      const lastMessage = messages![messages!.length - 1]!
      expect(lastMessage.text).toBe("Testing persistence")
      expect(lastMessage.sender).toBe(user2Id)

      console.log("✓ State persists correctly after modifications")
    }, 30000)
  })

  describe("Premium Messages (with attached deposit)", () => {
    test("should mark message as premium when NEAR is attached", async () => {
      await near
        .transaction(user1Id)
        .functionCall(
          contractId,
          "add_message",
          { text: "Premium message!" },
          { attachedDeposit: "1 NEAR" },
        )
        .send({ waitUntil: "FINAL" })

      interface Message {
        premium: boolean
        sender: string
        text: string
      }

      const messages = await near.view<Message[]>(
        contractId,
        "get_messages",
        {},
      )

      // biome-ignore lint/style/noNonNullAssertion: Test code expects message to exist
      const lastMessage = messages![messages!.length - 1]!
      expect(lastMessage.text).toBe("Premium message!")
      expect(lastMessage.premium).toBe(true)

      console.log("✓ Premium message created with attached deposit")
    }, 30000)

    test("should mark message as non-premium without deposit", async () => {
      await near
        .transaction(user1Id)
        .functionCall(contractId, "add_message", {
          text: "Regular message",
        })
        .send({ waitUntil: "FINAL" })

      interface Message {
        premium: boolean
        sender: string
        text: string
      }

      const messages = await near.view<Message[]>(
        contractId,
        "get_messages",
        {},
      )

      // biome-ignore lint/style/noNonNullAssertion: Test code expects message to exist
      const lastMessage = messages![messages!.length - 1]!
      expect(lastMessage.text).toBe("Regular message")
      expect(lastMessage.premium).toBe(false)

      console.log("✓ Non-premium message created without deposit")
    }, 30000)
  })

  describe("Multiple Users Interaction", () => {
    test("should correctly track messages from different users", async () => {
      interface Message {
        premium: boolean
        sender: string
        text: string
      }

      const messages = await near.view<Message[]>(
        contractId,
        "get_messages",
        {},
      )

      // biome-ignore lint/style/noNonNullAssertion: test knows view returns data
      const user1Messages = messages!.filter((m) => m.sender === user1Id)
      // biome-ignore lint/style/noNonNullAssertion: test knows view returns data
      const user2Messages = messages!.filter((m) => m.sender === user2Id)

      expect(user1Messages.length).toBeGreaterThan(0)
      expect(user2Messages.length).toBeGreaterThan(0)

      console.log(`✓ User1 messages: ${user1Messages.length}`)
      console.log(`✓ User2 messages: ${user2Messages.length}`)
    })
  })

  describe("View Method Types", () => {
    test("total_messages() should return number type", async () => {
      const count = await near.view<number>(contractId, "total_messages", {})

      expect(typeof count).toBe("number")
      expect(Number.isInteger(count)).toBe(true)
      expect(count).toBeGreaterThanOrEqual(0)
    })

    test("get_messages() should return array type", async () => {
      const messages = await near.view<unknown[]>(
        contractId,
        "get_messages",
        {},
      )

      expect(Array.isArray(messages)).toBe(true)
    })
  })
})
