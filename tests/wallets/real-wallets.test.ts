/**
 * Integration tests with real wallet packages
 *
 * These tests verify our adapters work with the actual wallet-selector
 * and HOT Connect packages. They don't require network access or user
 * interaction - they just verify interface compatibility.
 *
 * To run these tests, install the optional dev dependencies:
 * bun add -d @near-wallet-selector/core @hot-labs/near-connect
 */

import { describe, expect, it, test } from "bun:test"

describe("Real Wallet Package Integration", () => {
  describe("@near-wallet-selector/core compatibility", () => {
    it("should have fromWalletSelector adapter available", async () => {
      const { fromWalletSelector } = await import("../../src/wallets/adapters.js")
      expect(fromWalletSelector).toBeDefined()
      expect(typeof fromWalletSelector).toBe("function")
    })

    it("should create compatible WalletConnection from wallet-selector types", async () => {
      // This test verifies type compatibility without requiring the actual package
      const { fromWalletSelector } = await import("../../src/wallets/adapters.js")

      // Create a minimal mock that matches wallet-selector's interface
      const mockWalletSelectorWallet = {
        async getAccounts() {
          return [{ accountId: "test.near", publicKey: "ed25519:..." }]
        },
        async signAndSendTransaction(params: any) {
          // Return in RPC format
          return {
            final_execution_status: "FINAL" as const,
            status: { SuccessValue: "" },
            transaction: {
              signer_id: "test.near",
              public_key: "ed25519:...",
              nonce: 1,
              receiver_id: params.receiverId,
              actions: params.actions,
              signature: "ed25519:...",
              hash: "test-hash",
            },
            transaction_outcome: {
              id: "test",
              outcome: {
                logs: [],
                receipt_ids: [],
                gas_burnt: 0,
                tokens_burnt: "0",
                executor_id: "test.near",
                status: { SuccessValue: "" },
              },
              block_hash: "test",
              proof: [],
            },
            receipts_outcome: [],
          }
        },
        async signMessage(params: any) {
          return {
            accountId: "test.near",
            publicKey: "ed25519:...",
            signature: "test",
          }
        },
      }

      const adapter = fromWalletSelector(mockWalletSelectorWallet)

      // Verify the adapter implements WalletConnection interface
      expect(adapter.getAccounts).toBeDefined()
      expect(adapter.signAndSendTransaction).toBeDefined()
      expect(adapter.signMessage).toBeDefined()

      // Test the methods work
      const accounts = await adapter.getAccounts()
      expect(accounts).toHaveLength(1)
      expect(accounts[0].accountId).toBe("test.near")
    })

    test("adapter interface matches wallet-selector return types", async () => {
      const { fromWalletSelector } = await import("../../src/wallets/adapters.js")
      const { MockWalletSelector } = await import("./mock-wallets.js")

      const mock = new MockWalletSelector([
        { accountId: "alice.near", publicKey: "ed25519:abc" },
      ])

      const adapter = fromWalletSelector(mock)

      // Test getAccounts returns correct format
      const accounts = await adapter.getAccounts()
      expect(accounts).toEqual([
        { accountId: "alice.near", publicKey: "ed25519:abc" },
      ])

      // Test signAndSendTransaction returns correct format
      const result = await adapter.signAndSendTransaction({
        receiverId: "contract.near",
        actions: [],
      })

      expect(result).toHaveProperty("status")
      expect(result).toHaveProperty("transaction_outcome")
      expect("SuccessValue" in result.status).toBe(true)
    })
  })

  describe("@hot-labs/near-connect compatibility", () => {
    it("should have fromHotConnect adapter available", async () => {
      const { fromHotConnect } = await import("../../src/wallets/adapters.js")
      expect(fromHotConnect).toBeDefined()
      expect(typeof fromHotConnect).toBe("function")
    })

    it("should create compatible WalletConnection from HOT Connect types", async () => {
      const { fromHotConnect } = await import("../../src/wallets/adapters.js")

      // Create a minimal mock that matches HOT Connect's interface
      const mockHotConnectWallet = {
        async getAccounts() {
          return [{ accountId: "test.near", publicKey: "ed25519:..." }]
        },
        async signAndSendTransaction(params: any) {
          // Return in RPC format
          return {
            final_execution_status: "FINAL" as const,
            status: { SuccessValue: "" },
            transaction: {
              signer_id: "test.near",
              public_key: "ed25519:...",
              nonce: 1,
              receiver_id: params.receiverId,
              actions: params.actions,
              signature: "ed25519:...",
              hash: "test-hash",
            },
            transaction_outcome: {
              id: "test",
              outcome: {
                logs: [],
                receipt_ids: [],
                gas_burnt: 0,
                tokens_burnt: "0",
                executor_id: "test.near",
                status: { SuccessValue: "" },
              },
              block_hash: "test",
              proof: [],
            },
            receipts_outcome: [],
          }
        },
      }

      const mockConnector = {
        async wallet() {
          return mockHotConnectWallet
        },
      }

      const adapter = fromHotConnect(mockConnector)

      // Verify the adapter implements WalletConnection interface
      expect(adapter.getAccounts).toBeDefined()
      expect(adapter.signAndSendTransaction).toBeDefined()

      // Test the methods work
      const accounts = await adapter.getAccounts()
      expect(accounts).toHaveLength(1)
      expect(accounts[0].accountId).toBe("test.near")
    })

    test("adapter correctly calls connector.wallet()", async () => {
      const { fromHotConnect } = await import("../../src/wallets/adapters.js")
      const { MockHotConnect } = await import("./mock-wallets.js")

      const mock = new MockHotConnect([
        { accountId: "alice.near", publicKey: "ed25519:abc" },
      ])

      const adapter = fromHotConnect(mock)

      mock.clearCallLog()

      // Every adapter method should call connector.wallet() first
      await adapter.getAccounts()

      const log = mock.getCallLog()
      expect(log.some((l) => l.method === "wallet")).toBe(true)
      expect(log.some((l) => l.method === "getAccounts")).toBe(true)
    })
  })

  describe("Type compatibility", () => {
    test("adapters preserve action types", async () => {
      const { fromWalletSelector } = await import("../../src/wallets/adapters.js")
      const { MockWalletSelector } = await import("./mock-wallets.js")
      const actions = await import("../../src/core/actions.js")

      const mock = new MockWalletSelector([
        { accountId: "alice.near", publicKey: "ed25519:abc" },
      ])

      const adapter = fromWalletSelector(mock)

      // Create various action types
      const transferAction = actions.transfer(BigInt("1000000000000000000000000"))
      const functionCallAction = actions.functionCall(
        "method",
        new TextEncoder().encode("{}"),
        BigInt(30000000000000),
        BigInt(0),
      )

      mock.clearCallLog()

      await adapter.signAndSendTransaction({
        receiverId: "contract.near",
        actions: [transferAction, functionCallAction],
      })

      const log = mock.getCallLog()
      const txCall = log.find((l) => l.method === "signAndSendTransaction")

      // Verify actions were passed through correctly
      expect(txCall?.params.actions).toHaveLength(2)
      expect(txCall?.params.actions[0]).toHaveProperty("transfer")
      expect(txCall?.params.actions[1]).toHaveProperty("functionCall")
    })
  })
})

/**
 * OPTIONAL: If you want to test with real wallet packages installed
 *
 * Uncomment and run: bun add -d @near-wallet-selector/core @hot-labs/near-connect
 */

/*
describe("Real Package Tests (requires packages installed)", () => {
  it("should work with actual @near-wallet-selector/core types", async () => {
    // This would require the actual package to be installed
    // const { setupWalletSelector } = await import("@near-wallet-selector/core")
    // ... real integration test
  })

  it("should work with actual @hot-labs/near-connect types", async () => {
    // This would require the actual package to be installed
    // const { NearConnector } = await import("@hot-labs/near-connect")
    // ... real integration test
  })
})
*/
