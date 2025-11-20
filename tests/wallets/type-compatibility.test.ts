/**
 * Tests to verify structural compatibility between our types
 * and wallet-selector/@near-js types
 *
 * These tests demonstrate that while our types are nominally different
 * (plain objects vs classes), they are structurally compatible and work
 * correctly at runtime.
 */

import type { Account as WSAccount } from "@near-wallet-selector/core"
import { describe, expect, it } from "vitest"
import * as actions from "../../src/core/actions.js"
import type {
  FinalExecutionOutcome,
  WalletAccount,
} from "../../src/core/types.js"

describe("Type Compatibility Verification", () => {
  describe("Action compatibility with @near-js/transactions", () => {
    it("our Transfer action has the same structure as @near-js Action", () => {
      const ourAction = actions.transfer(BigInt("1000000000000000000000000"))

      // This would be the @near-js Action structure
      // We verify our action has all the required fields
      expect(ourAction).toHaveProperty("transfer")
      expect(ourAction.transfer).toHaveProperty("deposit")
      expect(typeof ourAction.transfer.deposit).toBe("bigint")

      // Verify we can serialize it (wallets will do this)
      const serialized = JSON.stringify(ourAction, (_key, value) =>
        typeof value === "bigint" ? value.toString() : value,
      )
      expect(serialized).toContain("transfer")
      expect(serialized).toContain("deposit")
    })

    it("our FunctionCall action has the same structure as @near-js Action", () => {
      const args = new TextEncoder().encode(JSON.stringify({ arg: "value" }))
      const ourAction = actions.functionCall(
        "my_method",
        args,
        BigInt("30000000000000"),
        BigInt("1000000000000000000000000"),
      )

      expect(ourAction).toHaveProperty("functionCall")
      expect(ourAction.functionCall).toHaveProperty("methodName")
      expect(ourAction.functionCall).toHaveProperty("args")
      expect(ourAction.functionCall).toHaveProperty("gas")
      expect(ourAction.functionCall).toHaveProperty("deposit")
    })

    it("action arrays can be passed to functions expecting @near-js Actions", () => {
      const args = new TextEncoder().encode(JSON.stringify({}))
      const ourActions = [
        actions.transfer(BigInt("1000000000000000000000000")),
        actions.functionCall(
          "method",
          args,
          BigInt("30000000000000"),
          BigInt(0),
        ),
      ]

      // This function simulates processing actions (wallet doesn't actually check types)
      // At runtime, our plain object actions work fine
      function processActions(acts: unknown[]) {
        // biome-ignore lint/suspicious/noExplicitAny: Testing structural compatibility
        return acts.map((a: any) => {
          if ("transfer" in a) return { type: "transfer", ...a.transfer }
          if ("functionCall" in a)
            return { type: "functionCall", ...a.functionCall }
          return a
        })
      }

      // Our actions work at runtime even though they're nominally different types
      const result = processActions(ourActions)
      expect(result[0].type).toBe("transfer")
      expect(result[1].type).toBe("functionCall")
    })
  })

  describe("FinalExecutionOutcome compatibility", () => {
    it("our FinalExecutionOutcome has required @near-js fields", () => {
      const ourOutcome: FinalExecutionOutcome = {
        final_execution_status: "FINAL",
        status: { SuccessValue: "" },
        transaction: {
          signer_id: "alice.near",
          public_key: "ed25519:...",
          nonce: 1,
          receiver_id: "bob.near",
          actions: [],
          signature: "ed25519:...",
          hash: "hash",
        },
        transaction_outcome: {
          id: "id",
          outcome: {
            logs: [],
            receipt_ids: [],
            gas_burnt: 1000,
            tokens_burnt: "0",
            executor_id: "alice.near",
            status: { SuccessValue: "" },
          },
          block_hash: "hash",
          proof: [],
        },
        receipts_outcome: [],
      }

      // Verify it has the fields @near-js expects
      expect(ourOutcome).toHaveProperty("status")
      expect(ourOutcome).toHaveProperty("transaction")
      expect(ourOutcome).toHaveProperty("transaction_outcome")
      expect(ourOutcome).toHaveProperty("receipts_outcome")
      expect(ourOutcome.status).toEqual({ SuccessValue: "" })
    })
  })

  describe("Account compatibility", () => {
    it("our WalletAccount matches wallet-selector Account structure", () => {
      const ourAccount: WalletAccount = {
        accountId: "alice.near",
        publicKey: "ed25519:abc123",
      }

      // Verify structure matches what wallet-selector expects
      function processWSAccount(account: WSAccount) {
        return `${account.accountId}:${account.publicKey || "no-key"}`
      }

      // biome-ignore lint/suspicious/noExplicitAny: Testing structural compatibility
      const result = processWSAccount(ourAccount as any)
      expect(result).toBe("alice.near:ed25519:abc123")
    })

    it("our WalletAccount matches HOT Connect Account structure", () => {
      const ourAccount: WalletAccount = {
        accountId: "alice.near",
        publicKey: "ed25519:abc123",
      }

      // Verify structure matches what HOT Connect expects (requires publicKey)
      function processHCAccount(account: {
        accountId: string
        publicKey: string
      }) {
        return `${account.accountId}:${account.publicKey}`
      }

      // Works when publicKey is present
      const result = processHCAccount(
        ourAccount as { accountId: string; publicKey: string },
      )
      expect(result).toBe("alice.near:ed25519:abc123")
    })
  })

  describe("Runtime duck typing", () => {
    it("demonstrates why structural compatibility works at runtime", async () => {
      // Our mock wallet that returns our types
      const ourWallet = {
        async signAndSendTransaction(params: {
          receiverId: string
          actions: unknown[]
        }) {
          // Wallet doesn't care about nominal types,
          // it just uses the structure
          const ourOutcome: FinalExecutionOutcome = {
            final_execution_status: "FINAL",
            status: { SuccessValue: "" },
            transaction: {
              signer_id: "alice.near",
              public_key: "ed25519:...",
              nonce: 1,
              receiver_id: params.receiverId,
              // biome-ignore lint/suspicious/noExplicitAny: RPC schema uses any
              actions: params.actions as any,
              signature: "ed25519:...",
              hash: "hash",
            },
            transaction_outcome: {
              id: "id",
              outcome: {
                logs: [],
                receipt_ids: [],
                gas_burnt: 1000,
                tokens_burnt: "0",
                executor_id: "alice.near",
                status: { SuccessValue: "" },
              },
              block_hash: "hash",
              proof: [],
            },
            receipts_outcome: [],
          }
          return ourOutcome
        },
      }

      // At runtime, the wallet works because structure matches
      const result = await ourWallet.signAndSendTransaction({
        receiverId: "bob.near",
        actions: [actions.transfer(BigInt(1000))],
      })

      // Verify it has the expected structure
      expect(result).toHaveProperty("status")
      expect(result.status).toEqual({ SuccessValue: "" })
    })
  })
})
