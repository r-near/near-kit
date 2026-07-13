/**
 * Tests for RPC response schemas
 */

import { describe, expect, test } from "vitest"
import {
  AccessKeyPermissionSchema,
  ActionSchema,
  FinalExecutionOutcomeSchema,
  type FinalExecutionOutcomeWithReceiptsMap,
  FinalExecutionOutcomeWithReceiptsSchema,
  TransactionSchema,
} from "../../src/core/rpc/rpc-schemas.js"

const baseTransaction = {
  signer_id: "alice.near",
  public_key: "ed25519:8nFkHgRePSGD9UsK3Hx6nWKXGQ7Kd7k3k7k3k7k3k7k3",
  nonce: 42,
  receiver_id: "bob.near",
  actions: [],
  signature: "ed25519:3D4c2v8K5x...",
  hash: "11111111111111111111111111111111",
}

describe("TransactionSchema", () => {
  describe("nonce_mode (new in nearcore 2.12)", () => {
    test("should parse a transaction with nonce_mode 'strict'", () => {
      const result = TransactionSchema.parse({
        ...baseTransaction,
        nonce_mode: "strict",
      })

      expect(result.nonce_mode).toBe("strict")
    })

    test("should parse a transaction with nonce_mode 'monotonic'", () => {
      const result = TransactionSchema.parse({
        ...baseTransaction,
        nonce_mode: "monotonic",
      })

      expect(result.nonce_mode).toBe("monotonic")
    })

    test("should parse a transaction with nonce_mode null", () => {
      const result = TransactionSchema.parse({
        ...baseTransaction,
        nonce_mode: null,
      })

      expect(result.nonce_mode).toBeNull()
    })

    test("should parse a transaction without nonce_mode", () => {
      const result = TransactionSchema.parse(baseTransaction)

      expect(result.nonce_mode).toBeUndefined()
    })

    test("should reject an invalid nonce_mode value", () => {
      expect(() =>
        TransactionSchema.parse({
          ...baseTransaction,
          nonce_mode: "sequential",
        }),
      ).toThrow()
    })
  })
})

describe("Gas key RPC views (NEAR 2.13)", () => {
  describe("AccessKeyPermissionSchema", () => {
    test("parses GasKeyFullAccess view", () => {
      const parsed = AccessKeyPermissionSchema.parse({
        GasKeyFullAccess: {
          balance: "5000000000000000000000000",
          num_nonces: 4,
        },
      })
      expect(parsed).toEqual({
        GasKeyFullAccess: {
          balance: "5000000000000000000000000",
          num_nonces: 4,
        },
      })
    })

    test("parses GasKeyFunctionCall view (gas-key info + function-call fields)", () => {
      const view = {
        GasKeyFunctionCall: {
          balance: "0",
          num_nonces: 2,
          allowance: null,
          receiver_id: "contract.near",
          method_names: ["do_thing"],
        },
      }
      expect(AccessKeyPermissionSchema.parse(view)).toEqual(view)
    })

    test("still parses FullAccess and FunctionCall views", () => {
      expect(AccessKeyPermissionSchema.parse("FullAccess")).toBe("FullAccess")
      const fc = {
        FunctionCall: {
          receiver_id: "c.near",
          method_names: [],
          allowance: null,
        },
      }
      expect(AccessKeyPermissionSchema.parse(fc)).toEqual(fc)
    })
  })

  describe("response ActionSchema", () => {
    test("parses a TransferToGasKey action view", () => {
      const view = {
        TransferToGasKey: {
          public_key: "ed25519:8nFkHgRePSGD9UsK3Hx6nWKXGQ7Kd7k3k7k3k7k3k7k3",
          deposit: "2000000000000000000000000",
        },
      }
      expect(ActionSchema.parse(view)).toEqual(view)
    })

    test("parses a WithdrawFromGasKey action view (amount, not deposit)", () => {
      const view = {
        WithdrawFromGasKey: {
          public_key: "ed25519:8nFkHgRePSGD9UsK3Hx6nWKXGQ7Kd7k3k7k3k7k3k7k3",
          amount: "1000000000000000000000000",
        },
      }
      expect(ActionSchema.parse(view)).toEqual(view)
    })
  })

  test("a transaction echoing gas-key actions parses (regression for default send)", () => {
    // Codex P1: a successful 2.13 EXECUTED_OPTIMISTIC response echoes these
    // actions; the default .send() path must parse them, not throw.
    const parsed = TransactionSchema.parse({
      ...baseTransaction,
      actions: [
        {
          TransferToGasKey: {
            public_key: "ed25519:8nFkHgRePSGD9UsK3Hx6nWKXGQ7Kd7k3k7k3k7k3k7k3",
            deposit: "2000000000000000000000000",
          },
        },
        {
          WithdrawFromGasKey: {
            public_key: "ed25519:8nFkHgRePSGD9UsK3Hx6nWKXGQ7Kd7k3k7k3k7k3k7k3",
            amount: "1000000000000000000000000",
          },
        },
      ],
    })
    expect(parsed.actions).toHaveLength(2)
  })

  describe("response ActionSchema — DelegateV2 (NEAR 2.13)", () => {
    test("parses a DelegateV2 action view with a GasKeyNonce", () => {
      const view = {
        DelegateV2: {
          delegate_action: {
            V2: {
              sender_id: "alice.near",
              receiver_id: "bob.near",
              actions: [{ Transfer: { deposit: "1" } }],
              nonce: { GasKeyNonce: { nonce: 5, nonce_index: 2 } },
              max_block_height: 1000,
              public_key:
                "ed25519:8nFkHgRePSGD9UsK3Hx6nWKXGQ7Kd7k3k7k3k7k3k7k3",
            },
          },
          signature: "ed25519:sig",
        },
      }
      expect(ActionSchema.parse(view)).toEqual(view)
    })

    test("parses a DelegateV2 action view with a plain Nonce", () => {
      const view = {
        DelegateV2: {
          delegate_action: {
            V2: {
              sender_id: "alice.near",
              receiver_id: "bob.near",
              actions: [],
              nonce: { Nonce: { nonce: 9 } },
              max_block_height: 500,
              public_key:
                "ed25519:8nFkHgRePSGD9UsK3Hx6nWKXGQ7Kd7k3k7k3k7k3k7k3",
            },
          },
          signature: "ed25519:sig",
        },
      }
      expect(ActionSchema.parse(view)).toEqual(view)
    })
  })
})

describe("FinalExecutionOutcomeSchema — early wait levels (EXPERIMENTAL_tx_status)", () => {
  const outcomeWithId = (executorId: string) => ({
    id: "11111111111111111111111111111111",
    outcome: {
      logs: [],
      receipt_ids: ["22222222222222222222222222222222"],
      gas_burnt: 424555062500,
      tokens_burnt: "42455506250000000000",
      executor_id: executorId,
      status: { SuccessValue: "" },
    },
    block_hash: "33333333333333333333333333333333",
    proof: [],
  })

  const receipt = (receiverId: string) => ({
    predecessor_id: "alice.near",
    receiver_id: receiverId,
    receipt_id: "44444444444444444444444444444444",
    receipt: {
      Action: {
        signer_id: "alice.near",
        signer_public_key:
          "ed25519:8nFkHgRePSGD9UsK3Hx6nWKXGQ7Kd7k3k7k3k7k3k7k3",
        gas_price: "1000000000",
        output_data_receivers: [],
        input_data_ids: [],
        actions: [{ Transfer: { deposit: "1" } }],
      },
    },
  })

  // The RPC server returns full execution status/outcomes/receipts even when
  // `final_execution_status` is an early level (wait_until only controls how long
  // the node blocks, not what it returns). These payloads must survive parsing —
  // previously the early branches declared no receipts_outcome, so Zod stripped it.
  for (const level of ["NONE", "INCLUDED", "INCLUDED_FINAL"] as const) {
    test(`preserves receipts_outcome/status/transaction_outcome at ${level}`, () => {
      const payload = {
        final_execution_status: level,
        status: { SuccessValue: "" },
        transaction: {
          hash: "55555555555555555555555555555555",
          signer_id: "alice.near",
          receiver_id: "bob.near",
          nonce: 42,
        },
        transaction_outcome: outcomeWithId("alice.near"),
        receipts_outcome: [outcomeWithId("bob.near")],
      }

      const parsed = FinalExecutionOutcomeSchema.parse(payload)

      expect(parsed.final_execution_status).toBe(level)
      // The whole point of the fix: these are no longer dropped.
      expect(parsed.receipts_outcome).toBeDefined()
      expect(parsed.receipts_outcome).toHaveLength(1)
      expect(parsed.status).toBeDefined()
      expect(parsed.transaction_outcome).toBeDefined()
    })

    test(`EXPERIMENTAL_tx_status surfaces receipts + receipts_outcome at ${level}`, () => {
      const payload = {
        final_execution_status: level,
        status: { SuccessValue: "" },
        transaction: {
          hash: "55555555555555555555555555555555",
          signer_id: "alice.near",
          receiver_id: "bob.near",
          nonce: 42,
        },
        transaction_outcome: outcomeWithId("alice.near"),
        receipts_outcome: [outcomeWithId("bob.near")],
        receipts: [receipt("bob.near")],
      }

      const parsed = FinalExecutionOutcomeWithReceiptsSchema.parse(payload)

      expect(parsed.receipts).toHaveLength(1)
      expect(parsed.receipts[0]?.receiver_id).toBe("bob.near")
      expect(parsed.receipts_outcome).toHaveLength(1)
    })
  }

  // The send_tx path legitimately returns no execution fields at early levels
  // (the client injects a minimal transaction), so they must stay optional.
  test("still validates a minimal send_tx NONE response", () => {
    const parsed = FinalExecutionOutcomeSchema.parse({
      final_execution_status: "NONE",
      transaction: {
        hash: "55555555555555555555555555555555",
        signer_id: "alice.near",
        receiver_id: "bob.near",
        nonce: 42,
      },
    })

    expect(parsed.final_execution_status).toBe("NONE")
    expect("status" in parsed).toBe(false)
    expect("receipts_outcome" in parsed).toBe(false)
  })

  test("NONE variant type carries the optional receipt fields", () => {
    // Compile-time assertion: the NONE variant now includes receipts_outcome so
    // callers polling at early wait levels can read partial receipt data.
    const none: FinalExecutionOutcomeWithReceiptsMap["NONE"] = {
      final_execution_status: "NONE",
      receipts: [],
      receipts_outcome: [],
    }
    expect(none.receipts_outcome).toEqual([])
  })
})
