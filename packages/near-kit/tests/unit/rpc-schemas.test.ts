/**
 * Tests for RPC response schemas
 */

import { describe, expect, test } from "vitest"
import { TransactionSchema } from "../../src/core/rpc/rpc-schemas.js"

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
