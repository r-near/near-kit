/**
 * Tests for wallet adapter functions
 */

import { describe, expect, it } from "vitest"
import * as actions from "../../src/core/actions.js"
import type { Action } from "../../src/core/types.js"
import { generateKey } from "../../src/utils/key.js"
import { fromHotConnect, fromWalletSelector } from "../../src/wallets/index.js"
import type { HotConnectConnector } from "../../src/wallets/types.js"
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

    it("throws if wallet-selector returns no tx outcome", async () => {
      const mockWallet = new MockWalletSelector([
        { accountId: "alice.near", publicKey: "ed25519:abc123" },
      ])
      // biome-ignore lint/suspicious/noExplicitAny: overriding for test branch
      ;(mockWallet as any).signAndSendTransaction = async () => undefined

      const adapter = fromWalletSelector(mockWallet)
      await expect(
        adapter.signAndSendTransaction({
          signerId: "alice.near",
          receiverId: "bob.near",
          actions: [],
        }),
      ).rejects.toThrow("did not return transaction outcome")
    })

    it("throws if wallet-selector signMessage returns nothing", async () => {
      const mockWallet = new MockWalletSelector([
        { accountId: "alice.near", publicKey: "ed25519:abc123" },
      ])
      // biome-ignore lint/suspicious/noExplicitAny: overriding for test branch
      ;(mockWallet as any).signMessage = async () => undefined

      const adapter = fromWalletSelector(mockWallet)
      await expect(
        adapter.signMessage?.({
          message: "Hello",
          recipient: "bob.near",
          nonce: new Uint8Array([1, 2, 3]),
        }),
      ).rejects.toThrow("did not return signed message")
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

    it("throws for invalid HOT Connect type", () => {
      expect(() =>
        fromHotConnect({ wallet: null } as unknown as HotConnectConnector),
      ).toThrow("Invalid HOT Connect instance")
    })

    it("converts all action variants for HOT Connect", async () => {
      const mockConnector = new MockHotConnect([
        { accountId: "alice.near", publicKey: "ed25519:abc123" },
      ])
      const adapter = fromHotConnect(mockConnector)

      const key = generateKey()
      const argsJson = JSON.stringify({ ping: "pong" })
      const functionCallAction: Action = {
        functionCall: {
          methodName: "hello",
          args: new TextEncoder().encode(argsJson),
          gas: 1n,
          deposit: 2n,
        },
      }

      const stakeAction = actions.stake(3n, key.publicKey)
      const transferAction = actions.transfer(4n)
      const addKeyAction = actions.addKey(key.publicKey, {
        fullAccess: {},
      })
      const deleteKeyAction = actions.deleteKey(key.publicKey)
      const deleteAccountAction = actions.deleteAccount("beneficiary.near")
      const createAccountAction = actions.createAccount()
      const deployContractAction = actions.deployContract(
        new Uint8Array([1, 2, 3]),
      )

      await adapter.signAndSendTransaction({
        signerId: "alice.near",
        receiverId: "bob.near",
        actions: [
          functionCallAction,
          transferAction,
          stakeAction,
          addKeyAction,
          deleteKeyAction,
          deleteAccountAction,
          createAccountAction,
          deployContractAction,
        ],
      })

      const txCall = mockConnector
        .getCallLog()
        .find((l) => l.method === "signAndSendTransaction") as
        | { params: Record<string, any> }
        | undefined

      expect(txCall?.params["actions"]).toEqual([
        {
          type: "FunctionCall",
          params: {
            methodName: "hello",
            args: { ping: "pong" },
            gas: "1",
            deposit: "2",
          },
        },
        { type: "Transfer", params: { deposit: "4" } },
        {
          type: "Stake",
          params: {
            stake: "3",
            publicKey: key.publicKey.toString(),
          },
        },
        {
          type: "AddKey",
          params: {
            publicKey: key.publicKey.toString(),
            accessKey: {
              nonce: 0,
              permission: { fullAccess: {} },
            },
          },
        },
        {
          type: "DeleteKey",
          params: { publicKey: key.publicKey.toString() },
        },
        {
          type: "DeleteAccount",
          params: { beneficiaryId: "beneficiary.near" },
        },
        { type: "CreateAccount" },
        { type: "DeployContract", params: { code: new Uint8Array([1, 2, 3]) } },
      ])
    })

    it("throws on unsupported HOT Connect action", async () => {
      const mockConnector = new MockHotConnect([
        { accountId: "alice.near", publicKey: "ed25519:abc123" },
      ])
      const adapter = fromHotConnect(mockConnector)

      await expect(
        adapter.signAndSendTransaction({
          signerId: "alice.near",
          receiverId: "bob.near",
          actions: [{ unsupported: true } as unknown as Action],
        }),
      ).rejects.toThrow("Unsupported action type")
    })

    it("stringifies secp256k1 public keys", async () => {
      const mockConnector = new MockHotConnect([
        { accountId: "alice.near", publicKey: "ed25519:abc123" },
      ])
      const adapter = fromHotConnect(mockConnector)

      await adapter.signAndSendTransaction({
        signerId: "alice.near",
        receiverId: "bob.near",
        actions: [
          {
            stake: {
              stake: 1n,
              publicKey: { secp256k1Key: { data: [1, 2, 3] } },
            },
          } as Action,
        ],
      })

      const txCall = mockConnector
        .getCallLog()
        .find((l) => l.method === "signAndSendTransaction") as
        | { params: Record<string, any> }
        | undefined

      expect(txCall?.params["actions"][0]?.params.publicKey).toMatch(
        /^secp256k1:/,
      )
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
