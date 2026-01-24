/**
 * Deep tests for wallet adapters - verifying actual data passed to wallets
 *
 * These tests use the mock's call log to verify that:
 * 1. The adapter passes data correctly to the wallet
 * 2. Type conversions happen as expected (Buffer vs Uint8Array)
 * 3. Actions pass through unchanged (structural compatibility)
 * 4. Optional parameters are handled correctly
 */

import { describe, expect, it } from "vitest"
import * as actions from "../../src/core/actions.js"
import { fromHotConnect, fromWalletSelector } from "../../src/wallets/index.js"
import { MockHotConnect, MockWalletSelector } from "./mock-wallets.js"

describe("Wallet Adapter Data Flow Verification", () => {
  describe("fromWalletSelector - Parameter Passing", () => {
    it("should pass Actions unchanged to wallet.signAndSendTransaction", async () => {
      const mockWallet = new MockWalletSelector([
        { accountId: "alice.near", publicKey: "ed25519:abc123" },
      ])
      const adapter = fromWalletSelector(mockWallet)

      // Create actions
      const transferAction = actions.transfer(
        BigInt("5000000000000000000000000"),
      )
      const argsBytes = new TextEncoder().encode(
        JSON.stringify({ msg: "test" }),
      )
      const callAction = actions.functionCall(
        "my_method",
        argsBytes,
        BigInt("30000000000000"),
        BigInt("100000000000000000000000"),
      )

      // Call through adapter
      await adapter.signAndSendTransaction({
        signerId: "alice.near",
        receiverId: "bob.near",
        actions: [transferAction, callAction],
      })

      // Spy on what was actually passed to the wallet
      const calls = mockWallet.getCallLog()
      const txCall = calls.find((c) => c.method === "signAndSendTransaction")

      expect(txCall).toBeDefined()
      expect(txCall?.params.signerId).toBe("alice.near")
      expect(txCall?.params.receiverId).toBe("bob.near")
      expect(txCall?.params.actions).toHaveLength(2)

      // Verify the actions are EXACTLY what we passed (reference equality)
      expect(txCall?.params.actions[0]).toBe(transferAction)
      expect(txCall?.params.actions[1]).toBe(callAction)

      // Verify structure is preserved
      const action0 = txCall?.params.actions[0] as {
        transfer: { deposit: bigint }
      }
      const action1 = txCall?.params.actions[1] as {
        functionCall: {
          methodName: string
          args: Uint8Array
        }
      }

      expect(action0).toHaveProperty("transfer")
      if (action0 && "transfer" in action0) {
        expect(action0.transfer.deposit).toBe(
          BigInt("5000000000000000000000000"),
        )
      }

      expect(action1).toHaveProperty("functionCall")
      if (action1 && "functionCall" in action1) {
        expect(action1.functionCall.methodName).toBe("my_method")
        expect(action1.functionCall.args).toBe(argsBytes)
      }
    })

    it("should convert Uint8Array nonce to Buffer for signMessage", async () => {
      const mockWallet = new MockWalletSelector([
        { accountId: "alice.near", publicKey: "ed25519:abc123" },
      ])
      const adapter = fromWalletSelector(mockWallet)

      // Create a Uint8Array nonce (what our API uses)
      const nonce = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])

      if (!adapter.signMessage) {
        throw new Error("signMessage not available")
      }
      await adapter.signMessage({
        message: "Hello",
        recipient: "bob.near",
        nonce,
      })

      // Spy on what was actually passed to the wallet
      const calls = mockWallet.getCallLog()
      const msgCall = calls.find((c) => c.method === "signMessage")

      expect(msgCall).toBeDefined()
      if (!msgCall) return

      expect(msgCall.params.message).toBe("Hello")
      expect(msgCall.params.recipient).toBe("bob.near")

      // CRITICAL: Verify it converted Uint8Array to Buffer
      const noncePassed = msgCall.params.nonce
      expect(noncePassed).toBeInstanceOf(Buffer)
      expect(Buffer.isBuffer(noncePassed)).toBe(true)
      // Verify the bytes are the same
      expect(Array.from(noncePassed as Buffer)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8,
      ])
    })

    it("should omit signerId when undefined", async () => {
      const mockWallet = new MockWalletSelector([
        { accountId: "alice.near", publicKey: "ed25519:abc123" },
      ])
      const adapter = fromWalletSelector(mockWallet)

      await adapter.signAndSendTransaction({
        receiverId: "bob.near",
        actions: [actions.transfer(BigInt(1000))],
        // Note: signerId is NOT provided
      })

      const calls = mockWallet.getCallLog()
      const txCall = calls.find((c) => c.method === "signAndSendTransaction")

      // Should NOT have signerId in the params object
      expect(txCall?.params).not.toHaveProperty("signerId")
      expect(txCall?.params.receiverId).toBe("bob.near")
    })

    it("should include signerId when provided", async () => {
      const mockWallet = new MockWalletSelector([
        { accountId: "alice.near", publicKey: "ed25519:abc123" },
      ])
      const adapter = fromWalletSelector(mockWallet)

      await adapter.signAndSendTransaction({
        signerId: "alice.near",
        receiverId: "bob.near",
        actions: [actions.transfer(BigInt(1000))],
      })

      const calls = mockWallet.getCallLog()
      const txCall = calls.find((c) => c.method === "signAndSendTransaction")

      // SHOULD have signerId when explicitly provided
      expect(txCall?.params.signerId).toBe("alice.near")
    })
  })

  describe("fromHotConnect - Parameter Passing", () => {
    it("should translate Actions for HOT Connect signAndSendTransaction", async () => {
      const mockConnector = new MockHotConnect([
        { accountId: "alice.near", publicKey: "ed25519:abc123" },
      ])
      const adapter = fromHotConnect(mockConnector)

      // Create actions
      const transferAction = actions.transfer(
        BigInt("5000000000000000000000000"),
      )
      const deleteAction = actions.deleteAccount("beneficiary.near")

      // Call through adapter
      await adapter.signAndSendTransaction({
        signerId: "alice.near",
        receiverId: "bob.near",
        actions: [transferAction, deleteAction],
      })

      // Spy on what was actually passed to the wallet
      const calls = mockConnector.getCallLog()
      const txCall = calls.find((c) => c.method === "signAndSendTransaction")

      expect(txCall).toBeDefined()
      const actionsPassed = txCall?.params.actions
      expect(actionsPassed).toHaveLength(2)

      const action0 = actionsPassed?.[0] as {
        type: string
        params: { deposit: string }
      }
      const action1 = actionsPassed?.[1] as {
        type: string
        params: { beneficiaryId: string }
      }

      expect(action0.type).toBe("Transfer")
      expect(action0.params.deposit).toBe("5000000000000000000000000")

      expect(action1.type).toBe("DeleteAccount")
      expect(action1.params.beneficiaryId).toBe("beneficiary.near")
    })

    it("should pass Uint8Array nonce unchanged for signMessage", async () => {
      const mockConnector = new MockHotConnect([
        { accountId: "alice.near", publicKey: "ed25519:abc123" },
      ])
      const adapter = fromHotConnect(mockConnector)

      // Create a Uint8Array nonce (what our API uses)
      const nonce = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2, 1])

      if (!adapter.signMessage) {
        throw new Error("signMessage not available")
      }
      const result = await adapter.signMessage({
        message: "Test message",
        recipient: "bob.near",
        nonce,
      })
      expect(result).toBeDefined()

      // Spy on what was actually passed to the wallet
      const calls = mockConnector.getCallLog()
      const msgCall = calls.find((c) => c.method === "signMessage")

      expect(msgCall).toBeDefined()
      if (!msgCall) return

      // CRITICAL: HOT Connect uses Uint8Array, should NOT be converted to Buffer
      const noncePassed = msgCall.params.nonce
      expect(noncePassed).toBeInstanceOf(Uint8Array)
      expect(noncePassed).toBe(nonce) // Should be the SAME object

      // Verify bytes
      expect(Array.from(noncePassed as Uint8Array)).toEqual([
        9, 8, 7, 6, 5, 4, 3, 2, 1,
      ])
    })

    it("should handle complex action types correctly", async () => {
      const mockConnector = new MockHotConnect([
        { accountId: "alice.near", publicKey: "ed25519:abc123" },
      ])
      const adapter = fromHotConnect(mockConnector)

      // Create various action types
      const actionsToTest = [
        actions.createAccount(),
        actions.transfer(BigInt(1000)),
        actions.deleteAccount("beneficiary.near"),
      ]

      await adapter.signAndSendTransaction({
        receiverId: "contract.near",
        actions: actionsToTest,
      })

      const calls = mockConnector.getCallLog()
      const txCall = calls.find((c) => c.method === "signAndSendTransaction")

      expect(txCall?.params.actions).toHaveLength(3)

      const [a0, a1, a2] = txCall?.params.actions as Array<{
        type: string
        params: Record<string, unknown>
      }>

      expect(a0).toBeDefined()
      if (!a0) return
      expect(a0.type).toBe("CreateAccount")

      expect(a1).toBeDefined()
      if (!a1) return
      expect(a1.type).toBe("Transfer")
      expect(a1.params["deposit"]).toBe("1000")

      expect(a2).toBeDefined()
      if (!a2) return
      expect(a2.type).toBe("DeleteAccount")
      expect(a2.params["beneficiaryId"]).toBe("beneficiary.near")
    })
  })

  describe("Action Structural Compatibility", () => {
    it("should preserve all action fields through wallet-selector", async () => {
      const mockWallet = new MockWalletSelector([
        { accountId: "test.near", publicKey: "ed25519:test" },
      ])
      const adapter = fromWalletSelector(mockWallet)

      const args = new TextEncoder().encode(JSON.stringify({ key: "value" }))
      const action = actions.functionCall(
        "test_method",
        args,
        BigInt("50000000000000"),
        BigInt("250000000000000000000000"),
      )

      await adapter.signAndSendTransaction({
        receiverId: "contract.near",
        actions: [action],
      })

      const calls = mockWallet.getCallLog()
      const txCall = calls.find((c) => c.method === "signAndSendTransaction")
      const passedAction = txCall?.params.actions[0] as {
        functionCall: {
          methodName: string
          args: Uint8Array
          gas: bigint
          deposit: bigint
        }
      }

      // Verify ALL fields are present and correct
      expect(passedAction).toBeDefined()
      if (passedAction && "functionCall" in passedAction) {
        expect(passedAction.functionCall).toEqual({
          methodName: "test_method",
          args,
          gas: BigInt("50000000000000"),
          deposit: BigInt("250000000000000000000000"),
        })
      }
    })

    it("should preserve bigint values correctly", async () => {
      const mockWallet = new MockWalletSelector([
        { accountId: "test.near", publicKey: "ed25519:test" },
      ])
      const adapter = fromWalletSelector(mockWallet)

      // Use a very large bigint to ensure no precision loss
      const largeAmount = BigInt("999999999999999999999999")
      const action = actions.transfer(largeAmount)

      await adapter.signAndSendTransaction({
        receiverId: "receiver.near",
        actions: [action],
      })

      const calls = mockWallet.getCallLog()
      const txCall = calls.find((c) => c.method === "signAndSendTransaction")
      const passedAction = txCall?.params.actions[0] as {
        transfer: { deposit: bigint }
      }

      // Verify bigint is preserved exactly
      expect(passedAction).toBeDefined()
      expect(passedAction.transfer.deposit).toBe(largeAmount)
      expect(typeof passedAction.transfer.deposit).toBe("bigint")
    })
  })

  describe("Error Handling and Edge Cases", () => {
    it("should throw when wallet doesn't support signMessage", async () => {
      // Create a mock wallet without signMessage
      const mockWallet = {
        async getAccounts() {
          return [{ accountId: "test.near", publicKey: "ed25519:test" }]
        },
        async signAndSendTransaction() {
          // biome-ignore lint/suspicious/noExplicitAny: Mock wallet for testing
          return {} as any
        },
        // No signMessage method
      }

      const adapter = fromWalletSelector(mockWallet)

      if (!adapter.signMessage) {
        throw new Error("signMessage not available on adapter")
      }
      const promise = adapter.signMessage({
        message: "test",
        recipient: "bob.near",
        nonce: new Uint8Array(8),
      })

      await expect(promise).rejects.toThrow(
        "Wallet does not support message signing",
      )
    })

    it("should throw when wallet signMessage returns undefined", async () => {
      const mockWallet = {
        async getAccounts() {
          return [{ accountId: "test.near", publicKey: "ed25519:test" }]
        },
        async signAndSendTransaction() {
          // biome-ignore lint/suspicious/noExplicitAny: Mock wallet for testing
          return {} as any
        },
        async signMessage() {
          return undefined // Browser wallet returns nothing
        },
      }

      const adapter = fromWalletSelector(mockWallet)

      if (!adapter.signMessage) {
        throw new Error("signMessage not available on adapter")
      }
      const promise = adapter.signMessage({
        message: "test",
        recipient: "bob.near",
        nonce: new Uint8Array(8),
      })

      await expect(promise).rejects.toThrow(
        "Wallet did not return signed message",
      )
    })

    it("should handle empty actions array", async () => {
      const mockWallet = new MockWalletSelector([
        { accountId: "test.near", publicKey: "ed25519:test" },
      ])
      const adapter = fromWalletSelector(mockWallet)

      await adapter.signAndSendTransaction({
        receiverId: "receiver.near",
        actions: [], // Empty actions
      })

      const calls = mockWallet.getCallLog()
      const txCall = calls.find((c) => c.method === "signAndSendTransaction")

      expect(txCall).toBeDefined()
      if (txCall) {
        expect(txCall.params.actions).toEqual([])
      }
    })

    it("should handle accounts without publicKey in wallet-selector", async () => {
      const mockWallet = new MockWalletSelector([
        { accountId: "test.near" }, // No publicKey
      ])
      const adapter = fromWalletSelector(mockWallet)

      const accounts = await adapter.getAccounts()

      // Should return account without publicKey field
      expect(accounts).toEqual([{ accountId: "test.near" }])
      expect(accounts[0]).not.toHaveProperty("publicKey")
    })

    it("should always include publicKey for HOT Connect accounts", async () => {
      const mockConnector = new MockHotConnect([
        { accountId: "test.near" }, // No publicKey provided
      ])
      const adapter = fromHotConnect(mockConnector)

      const accounts = await adapter.getAccounts()

      // HOT Connect REQUIRES publicKey, mock should add default
      expect(accounts).toHaveLength(1)
      const account = accounts[0]
      expect(account).toHaveProperty("publicKey")
      if (account) {
        expect(account.publicKey).toBe("ed25519:default")
      }
    })
  })

  describe("Data Mutation Prevention", () => {
    it("should not modify the original actions array", async () => {
      const mockWallet = new MockWalletSelector([
        { accountId: "test.near", publicKey: "ed25519:test" },
      ])
      const adapter = fromWalletSelector(mockWallet)

      const originalActions = [
        actions.transfer(BigInt(1000)),
        actions.createAccount(),
      ]
      const actionsCopy = [...originalActions]

      await adapter.signAndSendTransaction({
        receiverId: "receiver.near",
        actions: originalActions,
      })

      // Verify original array wasn't mutated
      expect(originalActions).toEqual(actionsCopy)
      expect(originalActions[0]).toBe(actionsCopy[0]) // Same reference
    })

    it("should not modify the nonce Uint8Array", async () => {
      const mockConnector = new MockHotConnect([
        { accountId: "test.near", publicKey: "ed25519:test" },
      ])
      const adapter = fromHotConnect(mockConnector)

      const originalNonce = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
      const nonceCopy = new Uint8Array(originalNonce)

      // Call signMessage - result doesn't matter for this test
      try {
        if (adapter.signMessage) {
          await adapter.signMessage({
            message: "test",
            recipient: "bob.near",
            nonce: originalNonce,
          })
        }
      } catch {
        // Ignore errors - we're just testing nonce wasn't mutated
      }

      // Verify original nonce wasn't modified
      expect(originalNonce).toEqual(nonceCopy)
    })
  })
})
