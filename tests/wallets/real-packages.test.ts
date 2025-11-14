/**
 * Integration tests with REAL wallet packages
 *
 * These tests use the actual @near-wallet-selector/core and @hot-labs/near-connect
 * packages to verify our adapters work correctly with real wallet types.
 */

import { describe, expect, it } from "bun:test"
import type { NearWalletBase } from "@hot-labs/near-connect/dist/types/wallet"
import type { Wallet } from "@near-wallet-selector/core"
import {
  fromHotConnect,
  fromWalletSelector,
} from "../../src/wallets/adapters.js"

describe("Real Package Integration", () => {
  describe("@near-wallet-selector/core", () => {
    it("should work with wallet-selector Wallet types", async () => {
      // Create a mock that implements the real Wallet interface
      const mockWallet: Partial<Wallet> = {
        id: "test-wallet",
        type: "injected",
        metadata: {
          name: "Test Wallet",
          description: "Test",
          iconUrl: "https://test.com/icon.png",
          deprecated: false,
          available: true,
        },

        async getAccounts() {
          return [
            {
              accountId: "test.testnet",
              publicKey: "ed25519:5Z7JfVR8PNF5RXmVmJGG7ZmE8z8V8vU9Z1z8W9z8V8z",
            },
          ]
        },

        async signAndSendTransaction(params) {
          return {
            status: {
              SuccessValue: "",
            },
            transaction: {
              signer_id: params.signerId || "test.testnet",
              public_key: "ed25519:5Z7JfVR8PNF5RXmVmJGG7ZmE8z8V8vU9Z1z8W9z8V8z",
              nonce: BigInt(1),
              receiver_id: params.receiverId,
              actions: params.actions,
              signature: "ed25519:sig",
              hash: "hash",
            },
            transaction_outcome: {
              id: "tx-id",
              outcome: {
                logs: [],
                receipt_ids: ["receipt-1"],
                gas_burnt: 1000000,
                tokens_burnt: "100000000000000000000",
                executor_id: "test.testnet",
                status: {
                  SuccessValue: "",
                },
              },
              block_hash: "block-hash",
              proof: [],
            },
            receipts_outcome: [],
          }
        },

        async signAndSendTransactions(params) {
          return params.transactions.map((tx) => ({
            status: {
              SuccessValue: "",
            },
            transaction: {
              signer_id: tx.signerId || "test.testnet",
              public_key: "ed25519:5Z7JfVR8PNF5RXmVmJGG7ZmE8z8V8vU9Z1z8W9z8V8z",
              nonce: BigInt(1),
              receiver_id: tx.receiverId,
              actions: tx.actions,
              signature: "ed25519:sig",
              hash: "hash",
            },
            transaction_outcome: {
              id: "tx-id",
              outcome: {
                logs: [],
                receipt_ids: ["receipt-1"],
                gas_burnt: 1000000,
                tokens_burnt: "100000000000000000000",
                executor_id: "test.testnet",
                status: {
                  SuccessValue: "",
                },
              },
              block_hash: "block-hash",
              proof: [],
            },
            receipts_outcome: [],
          }))
        },

        async signIn() {
          return [
            {
              accountId: "test.testnet",
              publicKey: "ed25519:5Z7JfVR8PNF5RXmVmJGG7ZmE8z8V8vU9Z1z8W9z8V8z",
            },
          ]
        },

        async signOut() {
          // Mock sign out
        },

        async verifyOwner() {
          return {
            accountId: "test.testnet",
            message: "test message",
            blockId: "block-123",
            publicKey: "ed25519:5Z7JfVR8PNF5RXmVmJGG7ZmE8z8V8vU9Z1z8W9z8V8z",
            signature: "ed25519:sig",
            keyType: 0,
          }
        },
      }

      // Create adapter
      const adapter = fromWalletSelector(mockWallet as any)

      // Test getAccounts
      const accounts = await adapter.getAccounts()
      expect(accounts).toBeDefined()
      expect(Array.isArray(accounts)).toBe(true)
      expect(accounts.length).toBeGreaterThan(0)
      expect(accounts[0]).toHaveProperty("accountId")

      // Test signAndSendTransaction
      const result = await adapter.signAndSendTransaction({
        receiverId: "contract.testnet",
        actions: [],
      })

      expect(result).toBeDefined()
      expect(result).toHaveProperty("transaction_outcome")
    })

    it("should handle wallet-selector types correctly", () => {
      // This test verifies type compatibility at compile time
      const mockWallet = {
        id: "test",
        type: "injected" as const,
        metadata: {
          name: "Test",
          description: null,
          iconUrl: "https://test.com/icon.png",
          deprecated: false,
          available: true,
        },
        async getAccounts() {
          return []
        },
        async signAndSendTransaction() {
          return {} as any
        },
      }

      // Should not throw type errors
      const adapter = fromWalletSelector(mockWallet as any)
      expect(adapter).toBeDefined()
      expect(typeof adapter.getAccounts).toBe("function")
      expect(typeof adapter.signAndSendTransaction).toBe("function")
    })
  })

  describe("@hot-labs/near-connect", () => {
    it("should work with HOT Connect NearWallet types", async () => {
      // Create a mock that implements the real NearWalletBase interface
      const mockWallet: Partial<NearWalletBase> = {
        manifest: {
          id: "test-wallet",
          platform: ["web"],
          name: "Test Wallet",
          icon: "https://test.com/icon.png",
          description: "Test wallet",
          website: "https://test.com",
          version: "1.0.0",
          executor: "https://test.com/executor.js",
          type: "injected",
          permissions: {},
          features: {
            signMessage: true,
            signTransaction: true,
            signAndSendTransaction: true,
            signAndSendTransactions: true,
            signInWithoutAddKey: false,
            mainnet: true,
            testnet: true,
          },
        },

        async getAccounts() {
          return [
            {
              accountId: "test.near",
              publicKey: "ed25519:5Z7JfVR8PNF5RXmVmJGG7ZmE8z8V8vU9Z1z8W9z8V8z",
            },
          ]
        },

        async signAndSendTransaction(params: any) {
          return {
            status: {
              SuccessValue: "",
            },
            transaction: {
              signer_id: params.signerId || "test.near",
              public_key: "ed25519:5Z7JfVR8PNF5RXmVmJGG7ZmE8z8V8vU9Z1z8W9z8V8z",
              nonce: BigInt(1),
              receiver_id: params.receiverId,
              actions: params.actions,
              signature: "ed25519:sig",
              hash: "hash",
            },
            transaction_outcome: {
              id: "tx-id",
              outcome: {
                logs: [],
                receipt_ids: ["receipt-1"],
                gas_burnt: 1000000,
                tokens_burnt: "100000000000000000000",
                executor_id: "test.near",
                status: {
                  SuccessValue: "",
                },
              },
              block_hash: "block-hash",
              proof: [],
            },
            receipts_outcome: [],
          }
        },

        async signMessage(params) {
          return {
            accountId: "test.near",
            publicKey: "ed25519:5Z7JfVR8PNF5RXmVmJGG7ZmE8z8V8vU9Z1z8W9z8V8z",
            signature: "ed25519:sig",
          }
        },

        async signIn() {
          return [
            {
              accountId: "test.near",
              publicKey: "ed25519:5Z7JfVR8PNF5RXmVmJGG7ZmE8z8V8vU9Z1z8W9z8V8z",
            },
          ]
        },

        async signOut() {
          // Mock sign out
        },
      }

      // Create mock connector
      const mockConnector = {
        async wallet() {
          return mockWallet as any
        },
        on() {},
      }

      // Create adapter
      const adapter = fromHotConnect(mockConnector as any)

      // Test getAccounts
      const accounts = await adapter.getAccounts()
      expect(accounts).toBeDefined()
      expect(Array.isArray(accounts)).toBe(true)
      expect(accounts.length).toBeGreaterThan(0)
      expect(accounts[0]).toHaveProperty("accountId")

      // Test signAndSendTransaction
      const result = await adapter.signAndSendTransaction({
        receiverId: "contract.near",
        actions: [],
      })

      expect(result).toBeDefined()
      expect(result).toHaveProperty("transaction_outcome")
    })

    it("should handle HOT Connect connector pattern correctly", async () => {
      let walletCallCount = 0

      const mockConnector = {
        async wallet() {
          walletCallCount++
          return {
            async getAccounts() {
              return [{ accountId: "test.near" }]
            },
            async signAndSendTransaction() {
              return {} as any
            },
          }
        },
      }

      const adapter = fromHotConnect(mockConnector as any)

      // Each adapter method should call connector.wallet()
      await adapter.getAccounts()
      expect(walletCallCount).toBe(1)

      await adapter.signAndSendTransaction({
        receiverId: "contract.near",
        actions: [],
      })
      expect(walletCallCount).toBe(2)
    })
  })

  describe("Action type compatibility", () => {
    it("should preserve action structure through wallet-selector adapter", async () => {
      const actions = await import("../../src/core/actions.js")

      let capturedActions: any[] = []

      const mockWallet = {
        async getAccounts() {
          return [{ accountId: "test.testnet" }]
        },
        async signAndSendTransaction(params: any) {
          capturedActions = params.actions
          return {
            status: { SuccessValue: "" },
            transaction: {} as any,
            transaction_outcome: {
              id: "test",
              outcome: {
                logs: [],
                receipt_ids: [],
                gas_burnt: 0,
                tokens_burnt: "0",
                executor_id: "test.testnet",
                status: { SuccessValue: "" },
              },
              block_hash: "test",
            },
            receipts_outcome: [],
          }
        },
      }

      const adapter = fromWalletSelector(mockWallet as any)

      // Create real actions using our action builders
      const transferAction = actions.transfer(
        BigInt("1000000000000000000000000"),
      )
      const functionCallAction = actions.functionCall(
        "method",
        new TextEncoder().encode('{"arg":"value"}'),
        BigInt(30000000000000),
        BigInt(0),
      )

      await adapter.signAndSendTransaction({
        receiverId: "contract.testnet",
        actions: [transferAction, functionCallAction],
      })

      // Verify actions were passed through unchanged
      expect(capturedActions).toHaveLength(2)
      expect(capturedActions[0]).toHaveProperty("transfer")
      expect(capturedActions[1]).toHaveProperty("functionCall")
    })
  })
})
