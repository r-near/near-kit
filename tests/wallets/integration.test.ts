/**
 * Integration tests for Near class with wallet support
 */

import { beforeEach, describe, expect, it } from "bun:test"
import { Near } from "../../src/core/near.js"
import {
  fromHotConnect,
  fromWalletSelector,
} from "../../src/wallets/adapters.js"
import { MockHotConnect, MockWalletSelector } from "./mock-wallets.js"

describe("Near class with wallets", () => {
  describe("With wallet-selector", () => {
    let mockWallet: MockWalletSelector
    let near: Near

    beforeEach(() => {
      mockWallet = new MockWalletSelector([
        { accountId: "alice.testnet", publicKey: "ed25519:abc123" },
      ])

      near = new Near({
        network: "testnet",
        wallet: fromWalletSelector(mockWallet),
      })
    })

    it("should use wallet for call()", async () => {
      mockWallet.clearCallLog()

      await near.call(
        "guestbook.near-examples.testnet",
        "add_message",
        { text: "Hello!" },
        { gas: "30 Tgas" },
      )

      const log = mockWallet.getCallLog()
      const txCall = log.find((l) => l.method === "signAndSendTransaction")

      expect(txCall).toBeDefined()
      if (txCall?.method === "signAndSendTransaction") {
        expect(txCall.params.receiverId).toBe("guestbook.near-examples.testnet")
        expect(txCall.params.actions).toHaveLength(1)

        // Verify it's a function call action
        expect(txCall.params.actions[0]).toHaveProperty("functionCall")
      }
    })

    it("should use wallet for send()", async () => {
      mockWallet.clearCallLog()

      await near.send("bob.testnet", "1 NEAR")

      const log = mockWallet.getCallLog()
      const txCall = log.find((l) => l.method === "signAndSendTransaction")

      expect(txCall).toBeDefined()
      if (txCall?.method === "signAndSendTransaction") {
        expect(txCall.params.receiverId).toBe("bob.testnet")
        expect(txCall.params.actions).toHaveLength(1)

        // Verify it's a transfer action
        expect(txCall.params.actions[0]).toHaveProperty("transfer")
      }
    })

    it("should auto-detect signerId from wallet", async () => {
      mockWallet.clearCallLog()

      // Don't specify signerId - should get it from wallet
      await near.call("contract.testnet", "method", { arg: "value" })

      const log = mockWallet.getCallLog()

      // Should have called getAccounts to get signerId
      expect(log.some((l) => l.method === "getAccounts")).toBe(true)

      const txCall = log.find((l) => l.method === "signAndSendTransaction")
      if (txCall?.method === "signAndSendTransaction") {
        expect(txCall.params.signerId).toBe("alice.testnet")
      }
    })

    it("should allow overriding signerId", async () => {
      // Add another account
      mockWallet.setAccounts([
        { accountId: "alice.testnet", publicKey: "ed25519:abc123" },
        { accountId: "bob.testnet", publicKey: "ed25519:def456" },
      ])

      mockWallet.clearCallLog()

      await near.call(
        "contract.testnet",
        "method",
        {},
        { signerId: "bob.testnet" },
      )

      const log = mockWallet.getCallLog()
      const txCall = log.find((l) => l.method === "signAndSendTransaction")
      if (txCall?.method === "signAndSendTransaction") {
        expect(txCall.params.signerId).toBe("bob.testnet")
      }
    })

    it("should throw error if no accounts connected", async () => {
      const emptyWallet = new MockWalletSelector([])
      const nearEmpty = new Near({
        network: "testnet",
        wallet: fromWalletSelector(emptyWallet),
      })

      await expect(
        nearEmpty.call("contract.testnet", "method", {}),
      ).rejects.toThrow("No accounts connected")
    })
  })

  describe("With HOT Connect", () => {
    let mockConnector: MockHotConnect
    let near: Near

    beforeEach(() => {
      mockConnector = new MockHotConnect([
        { accountId: "alice.near", publicKey: "ed25519:abc123" },
      ])

      near = new Near({
        network: "mainnet",
        wallet: fromHotConnect(mockConnector),
      })
    })

    it("should use HOT Connect for call()", async () => {
      mockConnector.clearCallLog()

      await near.call(
        "contract.near",
        "get_balance",
        { account_id: "alice.near" },
        { gas: "30 Tgas" },
      )

      const log = mockConnector.getCallLog()
      const txCall = log.find((l) => l.method === "signAndSendTransaction")

      expect(txCall).toBeDefined()
      if (txCall?.method === "signAndSendTransaction") {
        expect(txCall.params.receiverId).toBe("contract.near")
      }
    })

    it("should use HOT Connect for send()", async () => {
      mockConnector.clearCallLog()

      await near.send("receiver.near", "2 NEAR")

      const log = mockConnector.getCallLog()
      const txCall = log.find((l) => l.method === "signAndSendTransaction")

      expect(txCall).toBeDefined()
      if (txCall?.method === "signAndSendTransaction") {
        expect(txCall.params.receiverId).toBe("receiver.near")
        expect(txCall.params.actions[0]).toHaveProperty("transfer")
      }
    })
  })

  describe("TransactionBuilder with wallets", () => {
    let mockWallet: MockWalletSelector
    let near: Near

    beforeEach(() => {
      mockWallet = new MockWalletSelector([
        { accountId: "alice.testnet", publicKey: "ed25519:abc123" },
      ])

      near = new Near({
        network: "testnet",
        wallet: fromWalletSelector(mockWallet),
      })
    })

    it("should use wallet for simple transaction", async () => {
      mockWallet.clearCallLog()

      await near
        .transaction("alice.testnet")
        .transfer("bob.testnet", "1 NEAR")
        .send()

      const log = mockWallet.getCallLog()
      const txCall = log.find((l) => l.method === "signAndSendTransaction")

      expect(txCall).toBeDefined()
      expect(txCall?.params.signerId).toBe("alice.testnet")
      expect(txCall?.params.receiverId).toBe("bob.testnet")
      expect(txCall?.params.actions).toHaveLength(1)
    })

    it("should use wallet for complex multi-action transaction", async () => {
      mockWallet.clearCallLog()

      await near
        .transaction("alice.testnet")
        .transfer("bob.testnet", "1 NEAR")
        .functionCall(
          "contract.testnet",
          "method",
          { arg: "value" },
          { gas: "50 Tgas", attachedDeposit: "0.1 NEAR" },
        )
        .send()

      const log = mockWallet.getCallLog()
      const txCall = log.find((l) => l.method === "signAndSendTransaction")

      expect(txCall).toBeDefined()
      if (txCall?.method === "signAndSendTransaction") {
        expect(txCall.params.actions).toHaveLength(2)

        // First action is transfer
        expect(txCall.params.actions[0]).toHaveProperty("transfer")

        // Second action is function call
        expect(txCall.params.actions[1]).toHaveProperty("functionCall")
      }
    })

    it("should throw error if receiverId not set", async () => {
      // Create builder without setting receiverId
      const builder = near.transaction("alice.testnet")

      await expect(builder.send()).rejects.toThrow("No receiver ID set")
    })
  })

  describe("Universal code pattern", () => {
    it("should work with same business logic for wallet and private key", async () => {
      // Business logic function that works with any Near instance
      async function addMessage(near: Near, signerId: string, text: string) {
        return await near.call(
          "guestbook.near-examples.testnet",
          "add_message",
          { text },
          { signerId },
        )
      }

      // Test with wallet
      const mockWallet = new MockWalletSelector([
        { accountId: "alice.testnet", publicKey: "ed25519:abc123" },
      ])

      const nearWithWallet = new Near({
        network: "testnet",
        wallet: fromWalletSelector(mockWallet),
      })

      mockWallet.clearCallLog()
      await addMessage(nearWithWallet, "alice.testnet", "Hello from wallet!")

      const walletLog = mockWallet.getCallLog()
      expect(walletLog.some((l) => l.method === "signAndSendTransaction")).toBe(
        true,
      )

      // Same business logic works with wallet!
      // (In real scenario, you'd also test with private key, but we don't
      // have network access in tests, so we just verify the pattern works)
    })
  })

  describe("view() method with wallet", () => {
    it("should not use wallet for view calls", async () => {
      const mockWallet = new MockWalletSelector([
        { accountId: "alice.testnet", publicKey: "ed25519:abc123" },
      ])

      const near = new Near({
        network: "testnet",
        wallet: fromWalletSelector(mockWallet),
      })

      mockWallet.clearCallLog()

      // Note: This will fail because we don't have a real RPC in tests,
      // but we can verify wallet wasn't called
      try {
        await near.view("contract.testnet", "get_value", {})
      } catch (_error) {
        // Expected to fail - no real RPC
      }

      const log = mockWallet.getCallLog()
      // view() should NOT use wallet
      expect(log).toHaveLength(0)
    })
  })
})
