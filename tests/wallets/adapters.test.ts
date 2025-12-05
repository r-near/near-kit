/**
 * Tests for wallet adapter functions
 */

import { describe, expect, it } from "vitest"
import * as actions from "../../src/core/actions.js"
import { fromHotConnect, fromWalletSelector } from "../../src/wallets/index.js"
import {
  MockHotConnect,
  MockWalletSelector,
  MockWalletWithoutSignMessage,
} from "./mock-wallets.js"

describe("Wallet Adapters", () => {
  describe("fromWalletSelector", () => {
    it("should adapt wallet-selector getAccounts", async () => {
      const mockWallet = new MockWalletSelector([
        { accountId: "alice.near", publicKey: "ed25519:abc123" },
        { accountId: "bob.near", publicKey: "ed25519:def456" },
      ])

      const adapter = fromWalletSelector(mockWallet)
      const accounts = await adapter.getAccounts()

      expect(accounts).toEqual([
        { accountId: "alice.near", publicKey: "ed25519:abc123" },
        { accountId: "bob.near", publicKey: "ed25519:def456" },
      ])
    })

    it("should adapt wallet-selector signAndSendTransaction", async () => {
      const mockWallet = new MockWalletSelector([
        { accountId: "alice.near", publicKey: "ed25519:abc123" },
      ])

      const adapter = fromWalletSelector(mockWallet)

      const transferAction = actions.transfer(
        BigInt("1000000000000000000000000"),
      )

      const result = await adapter.signAndSendTransaction({
        signerId: "alice.near",
        receiverId: "bob.near",
        actions: [transferAction],
      })

      expect(
        "status" in result &&
          typeof result.status === "object" &&
          "SuccessValue" in result.status,
      ).toBe(true)
      expect(mockWallet.getCallLog()).toHaveLength(1)
      const logEntry = mockWallet.getCallLog()[0]
      expect(logEntry?.method).toBe("signAndSendTransaction")
      if (logEntry?.method === "signAndSendTransaction") {
        expect(logEntry.params.receiverId).toBe("bob.near")
      }
    })

    it("should adapt wallet-selector signMessage", async () => {
      const mockWallet = new MockWalletSelector([
        { accountId: "alice.near", publicKey: "ed25519:abc123" },
      ])

      const adapter = fromWalletSelector(mockWallet)

      const result = await adapter.signMessage?.({
        message: "Hello, NEAR!",
        recipient: "bob.near",
        nonce: new Uint8Array([1, 2, 3]),
      })

      expect(result?.accountId).toBe("alice.near")
      expect(result?.signature).toBe("mock-signature")
      expect(mockWallet.getCallLog()[0]?.method).toBe("signMessage")
    })

    it("should throw error if wallet doesn't support signMessage", async () => {
      const mockWallet = new MockWalletWithoutSignMessage([
        { accountId: "alice.near" },
      ])

      const adapter = fromWalletSelector(mockWallet)

      await expect(
        adapter.signMessage?.({
          message: "Hello",
          recipient: "bob.near",
          nonce: new Uint8Array([1, 2, 3]),
        }),
      ).rejects.toThrow("does not support message signing")
    })
  })

  describe("fromHotConnect", () => {
    it("should adapt HOT Connect getAccounts", async () => {
      const mockConnector = new MockHotConnect([
        { accountId: "alice.near", publicKey: "ed25519:abc123" },
        { accountId: "bob.near", publicKey: "ed25519:def456" },
      ])

      const adapter = fromHotConnect(mockConnector)
      const accounts = await adapter.getAccounts()

      expect(accounts).toEqual([
        { accountId: "alice.near", publicKey: "ed25519:abc123" },
        { accountId: "bob.near", publicKey: "ed25519:def456" },
      ])

      // Verify it called connector.wallet() then wallet.getAccounts()
      const log = mockConnector.getCallLog()
      expect(log.some((l) => l.method === "wallet")).toBe(true)
      expect(log.some((l) => l.method === "getAccounts")).toBe(true)
    })

    it("should adapt HOT Connect signAndSendTransaction", async () => {
      const mockConnector = new MockHotConnect([
        { accountId: "alice.near", publicKey: "ed25519:abc123" },
      ])

      const adapter = fromHotConnect(mockConnector)

      const transferAction = actions.transfer(
        BigInt("1000000000000000000000000"),
      )

      const result = await adapter.signAndSendTransaction({
        signerId: "alice.near",
        receiverId: "bob.near",
        actions: [transferAction],
      })

      expect(
        "status" in result &&
          typeof result.status === "object" &&
          "SuccessValue" in result.status,
      ).toBe(true)

      const log = mockConnector.getCallLog()
      const txCall = log.find((l) => l.method === "signAndSendTransaction")
      expect(txCall).toBeDefined()
      expect(txCall?.params.receiverId).toBe("bob.near")
    })

    it("should correctly parse JSON args in HOT Connect functionCall", async () => {
      const mockConnector = new MockHotConnect([
        { accountId: "alice.near", publicKey: "ed25519:abc123" },
      ])

      const adapter = fromHotConnect(mockConnector)

      const args = { foo: "bar" }
      const argsBytes = new TextEncoder().encode(JSON.stringify(args))

      const callAction = actions.functionCall(
        "myMethod",
        argsBytes,
        BigInt(30000000000000),
        BigInt(0),
      )

      await adapter.signAndSendTransaction({
        signerId: "alice.near",
        receiverId: "contract.near",
        actions: [callAction],
      })

      const log = mockConnector.getCallLog()
      const txCall = log.find((l) => l.method === "signAndSendTransaction")
      expect(txCall).toBeDefined()

      // biome-ignore lint/suspicious/noExplicitAny: Testing internal action structure
      const hotAction = (txCall?.params.actions as any[])[0]
      expect(hotAction.type).toBe("FunctionCall")
      expect(hotAction.params.methodName).toBe("myMethod")
      expect(hotAction.params.args).toEqual(args)
    })

    it("should adapt HOT Connect signMessage", async () => {
      const mockConnector = new MockHotConnect([
        { accountId: "alice.near", publicKey: "ed25519:abc123" },
      ])

      const adapter = fromHotConnect(mockConnector)

      const result = await adapter.signMessage?.({
        message: "Hello, NEAR!",
        recipient: "bob.near",
        nonce: new Uint8Array([1, 2, 3]),
      })

      expect(result?.accountId).toBe("alice.near")
      expect(result?.signature).toBe("mock-signature")

      const log = mockConnector.getCallLog()
      expect(log.some((l) => l.method === "signMessage")).toBe(true)
    })
  })

  describe("Edge cases", () => {
    it("should handle empty accounts list", async () => {
      const mockWallet = new MockWalletSelector([])
      const adapter = fromWalletSelector(mockWallet)

      const accounts = await adapter.getAccounts()
      expect(accounts).toEqual([])
    })

    it("should handle accounts without publicKey", async () => {
      const mockWallet = new MockWalletSelector([
        { accountId: "alice.near" }, // No publicKey
      ])

      const adapter = fromWalletSelector(mockWallet)
      const accounts = await adapter.getAccounts()

      expect(accounts).toEqual([{ accountId: "alice.near" }])
    })

    it("should preserve all action types", async () => {
      const mockWallet = new MockWalletSelector([
        { accountId: "alice.near", publicKey: "ed25519:abc123" },
      ])

      const adapter = fromWalletSelector(mockWallet)

      const argsBytes = new TextEncoder().encode('{"method":"test"}')
      const multipleActions = [
        actions.transfer(BigInt("1000000000000000000000000")),
        actions.functionCall(
          "method",
          argsBytes,
          BigInt(30000000000000),
          BigInt(0),
        ),
        actions.createAccount(),
      ]

      await adapter.signAndSendTransaction({
        signerId: "alice.near",
        receiverId: "contract.near",
        actions: multipleActions,
      })

      const log = mockWallet.getCallLog()
      const txCall = log.find((l) => l.method === "signAndSendTransaction")
      expect(txCall?.params.actions).toHaveLength(3)
    })
  })
})
