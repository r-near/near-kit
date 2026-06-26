/**
 * Tests for RPC response schemas
 */

import { describe, expect, test } from "vitest"
import {
  AccessKeyPermissionSchema,
  ActionSchema,
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
})
