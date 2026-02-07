/**
 * Tests for wallet-based delegate action signing (signDelegateActions)
 *
 * Covers:
 * - fromHotConnect adapter: action conversion, batch passthrough, response normalization
 * - TransactionBuilder.delegate() wallet routing: wraps single → batch, unwraps result
 * - Feature detection and error paths
 */

import { describe, expect, it, vi } from "vitest"
import * as actions from "../../src/core/actions.js"
import { TransactionBuilder } from "../../src/core/transaction.js"
import type {
  SignDelegateActionsParams,
  SignDelegateActionsResult,
  SignedDelegateAction,
  WalletConnection,
} from "../../src/core/types.js"
import { InMemoryKeyStore } from "../../src/keys/in-memory-keystore.js"
import { fromHotConnect } from "../../src/wallets/index.js"
import { MockHotConnect } from "./mock-wallets.js"

// Minimal mock RPC for TransactionBuilder (not used in wallet path)
function mockRpc() {
  return {
    getAccessKey: vi.fn(),
    getStatus: vi.fn(),
    getBlock: vi.fn(),
    sendTransaction: vi.fn(),
    // biome-ignore lint/suspicious/noExplicitAny: minimal mock RPC
  } as any
}

describe("Wallet Delegate Action Signing", () => {
  describe("fromHotConnect - signDelegateActions", () => {
    it("should convert actions and pass through to wallet", async () => {
      const mockConnector = new MockHotConnect([
        { accountId: "alice.near", publicKey: "ed25519:abc123" },
      ])

      const adapter = fromHotConnect(mockConnector)

      const transferAction = actions.transfer(
        BigInt("1000000000000000000000000"),
      )

      // biome-ignore lint/style/noNonNullAssertion: adapter always provides signDelegateActions
      const result = await adapter.signDelegateActions!({
        signerId: "alice.near",
        delegateActions: [
          {
            actions: [transferAction],
            receiverId: "contract.near",
          },
        ],
      })

      expect(result.signedDelegateActions).toHaveLength(1)
      expect(result.signedDelegateActions[0]?.delegateHash).toBeInstanceOf(
        Uint8Array,
      )
      expect(result.signedDelegateActions[0]?.signedDelegate).toBeDefined()

      // Verify actions were converted to HOT Connect format
      const log = mockConnector.getCallLog()
      const delegateCall = log.find((l) => l.method === "signDelegateActions")
      expect(delegateCall).toBeDefined()
      if (delegateCall?.method === "signDelegateActions") {
        const da = delegateCall.params.delegateActions[0]
        // biome-ignore lint/suspicious/noExplicitAny: inspecting converted action structure
        const hotAction = da?.actions[0] as any
        expect(hotAction.type).toBe("Transfer")
        expect(hotAction.params.deposit).toBe("1000000000000000000000000")
      }
    })

    it("should convert functionCall args to JSON objects", async () => {
      const mockConnector = new MockHotConnect([
        { accountId: "alice.near", publicKey: "ed25519:abc123" },
      ])

      const adapter = fromHotConnect(mockConnector)

      const args = { message: "hello" }
      const argsBytes = new TextEncoder().encode(JSON.stringify(args))
      const callAction = actions.functionCall(
        "add_message",
        argsBytes,
        BigInt(30000000000000),
        BigInt(0),
      )

      // biome-ignore lint/style/noNonNullAssertion: adapter always provides signDelegateActions
      await adapter.signDelegateActions!({
        delegateActions: [
          {
            actions: [callAction],
            receiverId: "guestbook.near",
          },
        ],
      })

      const log = mockConnector.getCallLog()
      const delegateCall = log.find((l) => l.method === "signDelegateActions")
      if (delegateCall?.method === "signDelegateActions") {
        const hotAction =
          // biome-ignore lint/suspicious/noExplicitAny: inspecting converted action
          delegateCall.params.delegateActions[0]?.actions[0] as any
        expect(hotAction.type).toBe("FunctionCall")
        expect(hotAction.params.methodName).toBe("add_message")
        expect(hotAction.params.args).toEqual({ message: "hello" })
        expect(hotAction.params.gas).toBe("30000000000000")
        expect(hotAction.params.deposit).toBe("0")
      }
    })

    it("should handle multiple delegate actions in batch", async () => {
      const mockConnector = new MockHotConnect([
        { accountId: "alice.near", publicKey: "ed25519:abc123" },
      ])

      const adapter = fromHotConnect(mockConnector)

      // biome-ignore lint/style/noNonNullAssertion: adapter always provides signDelegateActions
      const result = await adapter.signDelegateActions!({
        signerId: "alice.near",
        delegateActions: [
          {
            actions: [actions.transfer(BigInt(1000))],
            receiverId: "bob.near",
          },
          {
            actions: [actions.transfer(BigInt(2000))],
            receiverId: "carol.near",
          },
        ],
      })

      expect(result.signedDelegateActions).toHaveLength(2)

      const log = mockConnector.getCallLog()
      const delegateCall = log.find((l) => l.method === "signDelegateActions")
      if (delegateCall?.method === "signDelegateActions") {
        expect(delegateCall.params.delegateActions).toHaveLength(2)
        expect(delegateCall.params.signerId).toBe("alice.near")
      }
    })

    it("should omit signerId when not provided", async () => {
      const mockConnector = new MockHotConnect([
        { accountId: "alice.near", publicKey: "ed25519:abc123" },
      ])

      const adapter = fromHotConnect(mockConnector)

      // biome-ignore lint/style/noNonNullAssertion: adapter always provides signDelegateActions
      await adapter.signDelegateActions!({
        delegateActions: [
          {
            actions: [actions.transfer(BigInt(1000))],
            receiverId: "bob.near",
          },
        ],
      })

      const log = mockConnector.getCallLog()
      const delegateCall = log.find((l) => l.method === "signDelegateActions")
      if (delegateCall?.method === "signDelegateActions") {
        expect(delegateCall.params).not.toHaveProperty("signerId")
      }
    })

    it("should normalize flat signedDelegate response to wrapped format", async () => {
      // Simulate a wallet that returns @near-js/transactions flat format:
      // { delegateAction, signature } instead of { signedDelegate: { delegateAction, signature } }
      const flatWallet = {
        manifest: { features: { signDelegateAction: true } },
        async getAccounts() {
          return [{ accountId: "test.near", publicKey: "ed25519:abc" }]
        },
        async signAndSendTransaction() {
          // biome-ignore lint/suspicious/noExplicitAny: mock
          return {} as any
        },
        async signMessage() {
          // biome-ignore lint/suspicious/noExplicitAny: mock
          return {} as any
        },
        async signDelegateActions() {
          return {
            signedDelegateActions: [
              {
                delegateHash: new Uint8Array(32),
                // Flat format from @near-js/transactions — no nested signedDelegate key
                signedDelegate: {
                  delegateAction: {
                    senderId: "test.near",
                    receiverId: "contract.near",
                    actions: [],
                    nonce: 1n,
                    maxBlockHeight: 1000n,
                    publicKey: {
                      ed25519Key: { data: Array.from(new Uint8Array(32)) },
                    },
                  },
                  signature: {
                    ed25519Signature: { data: Array.from(new Uint8Array(64)) },
                  },
                },
              },
            ],
          }
        },
      }

      const connector = {
        async wallet() {
          return flatWallet
        },
      }

      // biome-ignore lint/suspicious/noExplicitAny: intentionally flat response to test normalization
      const adapter = fromHotConnect(connector as any)
      // biome-ignore lint/style/noNonNullAssertion: adapter always provides signDelegateActions
      const result = await adapter.signDelegateActions!({
        delegateActions: [
          {
            actions: [actions.transfer(BigInt(1000))],
            receiverId: "contract.near",
          },
        ],
      })

      // Should wrap flat format into { signedDelegate: { delegateAction, signature } }
      const signed = result.signedDelegateActions[0]?.signedDelegate
      expect(signed).toBeDefined()
      // biome-ignore lint/style/noNonNullAssertion: asserted above
      expect("signedDelegate" in signed!).toBe(true)
    })

    it("should pass through already-wrapped signedDelegate format", async () => {
      const mockConnector = new MockHotConnect([
        { accountId: "test.near", publicKey: "ed25519:abc" },
      ])

      const adapter = fromHotConnect(mockConnector)
      // biome-ignore lint/style/noNonNullAssertion: adapter always provides signDelegateActions
      const result = await adapter.signDelegateActions!({
        delegateActions: [
          {
            actions: [actions.transfer(BigInt(1000))],
            receiverId: "contract.near",
          },
        ],
      })

      // MockHotConnectWallet already returns wrapped format
      const signed = result.signedDelegateActions[0]?.signedDelegate
      expect(signed).toBeDefined()
      // biome-ignore lint/style/noNonNullAssertion: asserted above
      expect("signedDelegate" in signed!).toBe(true)
    })

    it("should throw when wallet does not support signDelegateActions", async () => {
      const walletWithout = {
        async getAccounts() {
          return [{ accountId: "test.near", publicKey: "ed25519:abc" }]
        },
        async signAndSendTransaction() {
          // biome-ignore lint/suspicious/noExplicitAny: mock
          return {} as any
        },
        async signMessage() {
          // biome-ignore lint/suspicious/noExplicitAny: mock
          return {} as any
        },
        // No signDelegateActions method
      }

      const connector = {
        async wallet() {
          return walletWithout
        },
      }

      const adapter = fromHotConnect(connector)

      await expect(
        // biome-ignore lint/style/noNonNullAssertion: testing error path
        adapter.signDelegateActions!({
          delegateActions: [
            {
              actions: [actions.transfer(BigInt(1000))],
              receiverId: "bob.near",
            },
          ],
        }),
      ).rejects.toThrow("does not support delegate action signing")
    })

    it("should throw when manifest explicitly disables signDelegateActions", async () => {
      const walletDisabled = {
        manifest: { features: { signDelegateAction: false } },
        async getAccounts() {
          return [{ accountId: "test.near", publicKey: "ed25519:abc" }]
        },
        async signAndSendTransaction() {
          // biome-ignore lint/suspicious/noExplicitAny: mock
          return {} as any
        },
        async signMessage() {
          // biome-ignore lint/suspicious/noExplicitAny: mock
          return {} as any
        },
        async signDelegateActions() {
          throw new Error("Should not be called")
        },
      }

      const connector = {
        async wallet() {
          return walletDisabled
        },
      }

      const adapter = fromHotConnect(connector)

      await expect(
        // biome-ignore lint/style/noNonNullAssertion: testing error path
        adapter.signDelegateActions!({
          delegateActions: [
            {
              actions: [actions.transfer(BigInt(1000))],
              receiverId: "bob.near",
            },
          ],
        }),
      ).rejects.toThrow("does not support delegate action signing")
    })
  })

  describe("TransactionBuilder.delegate() - Wallet Routing", () => {
    it("should route through wallet.signDelegateActions when available", async () => {
      const signDelegateActionsSpy = vi.fn(
        async (
          params: SignDelegateActionsParams,
        ): Promise<SignDelegateActionsResult> => ({
          signedDelegateActions: [
            {
              delegateHash: new Uint8Array(32),
              signedDelegate: {
                signedDelegate: {
                  delegateAction: {
                    senderId: params.signerId || "alice.near",
                    receiverId: params.delegateActions[0]?.receiverId || "",
                    actions: [],
                    nonce: 1n,
                    maxBlockHeight: 1000n,
                    publicKey: {
                      ed25519Key: {
                        data: Array.from(new Uint8Array(32)),
                      },
                    },
                  },
                  signature: {
                    ed25519Signature: { data: Array.from(new Uint8Array(64)) },
                  },
                },
              } as unknown as SignedDelegateAction,
            },
          ],
        }),
      )

      const wallet: WalletConnection = {
        async getAccounts() {
          return [{ accountId: "alice.near" }]
        },
        async signAndSendTransaction() {
          // biome-ignore lint/suspicious/noExplicitAny: mock
          return {} as any
        },
        signDelegateActions: signDelegateActionsSpy,
      }

      const builder = new TransactionBuilder(
        "alice.near",
        mockRpc(),
        new InMemoryKeyStore(),
        undefined,
        "EXECUTED_OPTIMISTIC",
        wallet,
      )

      const result = await builder.transfer("bob.near", "1 NEAR").delegate()

      // Should have called wallet, not keystore
      expect(signDelegateActionsSpy).toHaveBeenCalledOnce()

      // Should have wrapped single action into delegateActions array
      const callArgs = signDelegateActionsSpy.mock.calls[0]?.[0]
      expect(callArgs?.signerId).toBe("alice.near")
      expect(callArgs?.delegateActions).toHaveLength(1)
      expect(callArgs?.delegateActions[0]?.receiverId).toBe("bob.near")

      // Should return properly shaped result
      expect(result.signedDelegateAction).toBeDefined()
      expect(result.payload).toBeDefined()
      expect(result.format).toBe("base64")
    })

    it("should pass multiple actions to wallet in single delegate action", async () => {
      const signDelegateActionsSpy = vi.fn(
        async (
          params: SignDelegateActionsParams,
        ): Promise<SignDelegateActionsResult> => ({
          signedDelegateActions: [
            {
              delegateHash: new Uint8Array(32),
              signedDelegate: {
                signedDelegate: {
                  delegateAction: {
                    senderId: params.signerId || "alice.near",
                    receiverId: params.delegateActions[0]?.receiverId || "",
                    actions: [],
                    nonce: 1n,
                    maxBlockHeight: 1000n,
                    publicKey: {
                      ed25519Key: {
                        data: Array.from(new Uint8Array(32)),
                      },
                    },
                  },
                  signature: {
                    ed25519Signature: { data: Array.from(new Uint8Array(64)) },
                  },
                },
              } as unknown as SignedDelegateAction,
            },
          ],
        }),
      )

      const wallet: WalletConnection = {
        async getAccounts() {
          return [{ accountId: "alice.near" }]
        },
        async signAndSendTransaction() {
          // biome-ignore lint/suspicious/noExplicitAny: mock
          return {} as any
        },
        signDelegateActions: signDelegateActionsSpy,
      }

      const builder = new TransactionBuilder(
        "alice.near",
        mockRpc(),
        new InMemoryKeyStore(),
        undefined,
        "EXECUTED_OPTIMISTIC",
        wallet,
      )

      await builder
        .functionCall("contract.near", "method_a", { key: "value" })
        .transfer("contract.near", "1 NEAR")
        .delegate()

      const callArgs = signDelegateActionsSpy.mock.calls[0]?.[0]
      expect(callArgs?.delegateActions[0]?.actions).toHaveLength(2)
    })

    it("should throw WALLET_ERROR when wallet returns empty signedDelegateActions", async () => {
      const wallet: WalletConnection = {
        async getAccounts() {
          return [{ accountId: "alice.near" }]
        },
        async signAndSendTransaction() {
          // biome-ignore lint/suspicious/noExplicitAny: mock
          return {} as any
        },
        async signDelegateActions() {
          return { signedDelegateActions: [] }
        },
      }

      const builder = new TransactionBuilder(
        "alice.near",
        mockRpc(),
        new InMemoryKeyStore(),
        undefined,
        "EXECUTED_OPTIMISTIC",
        wallet,
      )

      await expect(
        builder.transfer("bob.near", "1 NEAR").delegate(),
      ).rejects.toThrow("Wallet did not return a signed delegate action")
    })

    it("should use explicit receiverId option over action-derived receiverId", async () => {
      const signDelegateActionsSpy = vi.fn(
        async (): Promise<SignDelegateActionsResult> => ({
          signedDelegateActions: [
            {
              delegateHash: new Uint8Array(32),
              signedDelegate: {
                signedDelegate: {
                  delegateAction: {
                    senderId: "alice.near",
                    receiverId: "explicit.near",
                    actions: [],
                    nonce: 1n,
                    maxBlockHeight: 1000n,
                    publicKey: {
                      ed25519Key: {
                        data: Array.from(new Uint8Array(32)),
                      },
                    },
                  },
                  signature: {
                    ed25519Signature: { data: Array.from(new Uint8Array(64)) },
                  },
                },
              } as unknown as SignedDelegateAction,
            },
          ],
        }),
      )

      const wallet: WalletConnection = {
        async getAccounts() {
          return [{ accountId: "alice.near" }]
        },
        async signAndSendTransaction() {
          // biome-ignore lint/suspicious/noExplicitAny: mock
          return {} as any
        },
        signDelegateActions: signDelegateActionsSpy,
      }

      const builder = new TransactionBuilder(
        "alice.near",
        mockRpc(),
        new InMemoryKeyStore(),
        undefined,
        "EXECUTED_OPTIMISTIC",
        wallet,
      )

      await builder
        .transfer("bob.near", "1 NEAR")
        .delegate({ receiverId: "explicit.near" })

      expect(signDelegateActionsSpy).toHaveBeenCalledOnce()
      const callArgs = signDelegateActionsSpy.mock.calls[0] as unknown as [
        SignDelegateActionsParams,
      ]
      expect(callArgs[0].delegateActions[0]?.receiverId).toBe("explicit.near")
    })

    it("should still validate actions are present before calling wallet", async () => {
      const wallet: WalletConnection = {
        async getAccounts() {
          return [{ accountId: "alice.near" }]
        },
        async signAndSendTransaction() {
          // biome-ignore lint/suspicious/noExplicitAny: mock
          return {} as any
        },
        async signDelegateActions() {
          throw new Error("Should not be called")
        },
      }

      const builder = new TransactionBuilder(
        "alice.near",
        mockRpc(),
        new InMemoryKeyStore(),
        undefined,
        "EXECUTED_OPTIMISTIC",
        wallet,
      )

      // No actions added — should fail validation before reaching wallet
      await expect(builder.delegate()).rejects.toThrow(
        "requires at least one action",
      )
    })

    it("should still reject nested delegate actions via wallet path", async () => {
      const wallet: WalletConnection = {
        async getAccounts() {
          return [{ accountId: "alice.near" }]
        },
        async signAndSendTransaction() {
          // biome-ignore lint/suspicious/noExplicitAny: mock
          return {} as any
        },
        async signDelegateActions() {
          throw new Error("Should not be called")
        },
      }

      const builder = new TransactionBuilder(
        "alice.near",
        mockRpc(),
        new InMemoryKeyStore(),
        undefined,
        "EXECUTED_OPTIMISTIC",
        wallet,
      )

      // Add a signed delegate action and try to delegate — should fail validation
      const mockSigned = {
        signedDelegate: {
          delegateAction: {
            senderId: "other.near",
            receiverId: "contract.near",
            actions: [],
            nonce: 1n,
            maxBlockHeight: 1000n,
            publicKey: { ed25519Key: { data: Array.from(new Uint8Array(32)) } },
          },
          signature: { ed25519: { data: Array.from(new Uint8Array(64)) } },
        },
      } as unknown as SignedDelegateAction

      builder.signedDelegateAction(mockSigned)

      await expect(builder.delegate()).rejects.toThrow(
        "cannot contain nested signed delegate actions",
      )
    })
  })
})
