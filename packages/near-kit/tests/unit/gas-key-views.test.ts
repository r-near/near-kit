import * as Schema from "effect/Schema"
/**
 * Unit tests for the gas-key RPC view schemas (nearcore 2.13): the
 * AccessKeyPermission gas-key variants and the gas-key ActionView variants.
 */

import { describe, expect, test } from "vitest"
import {
  AccessKeyPermissionSchema,
  GasKeyNoncesResponseSchema,
  ActionSchema as RpcActionSchema,
} from "../../src/effect/protocol-schemas.js"

describe("AccessKeyPermissionSchema (gas keys)", () => {
  test("still parses FullAccess and FunctionCall", () => {
    expect(Schema.decodeSync(AccessKeyPermissionSchema)("FullAccess")).toBe(
      "FullAccess",
    )
    const fc = Schema.decodeSync(AccessKeyPermissionSchema)({
      FunctionCall: {
        receiver_id: "app.near",
        method_names: ["go"],
        allowance: "1000",
      },
    })
    expect(fc).toHaveProperty("FunctionCall")
  })

  test("parses GasKeyFullAccess", () => {
    const parsed = Schema.decodeSync(AccessKeyPermissionSchema)({
      GasKeyFullAccess: { balance: "5000000000000000000000000", num_nonces: 4 },
    })
    expect(parsed).toEqual({
      GasKeyFullAccess: { balance: "5000000000000000000000000", num_nonces: 4 },
    })
  })

  test("parses GasKeyFunctionCall (with and without allowance)", () => {
    const withAllowance = Schema.decodeSync(AccessKeyPermissionSchema)({
      GasKeyFunctionCall: {
        balance: "1000",
        num_nonces: 8,
        receiver_id: "app.near",
        method_names: ["a", "b"],
        allowance: "250",
      },
    })
    expect(withAllowance).toHaveProperty("GasKeyFunctionCall")

    const noAllowance = Schema.decodeSync(AccessKeyPermissionSchema)({
      GasKeyFunctionCall: {
        balance: "1000",
        num_nonces: 8,
        receiver_id: "app.near",
        method_names: [],
      },
    })
    expect(noAllowance).toHaveProperty("GasKeyFunctionCall")
  })
})

describe("RpcActionSchema (gas-key actions)", () => {
  test("parses TransferToGasKey", () => {
    const parsed = Schema.decodeSync(RpcActionSchema)({
      TransferToGasKey: { public_key: "ed25519:abc", deposit: "100" },
    })
    expect(parsed).toEqual({
      TransferToGasKey: { public_key: "ed25519:abc", deposit: "100" },
    })
  })

  test("parses WithdrawFromGasKey", () => {
    const parsed = Schema.decodeSync(RpcActionSchema)({
      WithdrawFromGasKey: { public_key: "ed25519:abc", amount: "50" },
    })
    expect(parsed).toEqual({
      WithdrawFromGasKey: { public_key: "ed25519:abc", amount: "50" },
    })
  })

  test("still parses a classic action (Transfer)", () => {
    const parsed = Schema.decodeSync(RpcActionSchema)({
      Transfer: { deposit: "1" },
    })
    expect(parsed).toEqual({ Transfer: { deposit: "1" } })
  })
})

describe("GasKeyNoncesResponseSchema", () => {
  test("parses a multi-lane gas-key nonces response", () => {
    const parsed = Schema.decodeSync(GasKeyNoncesResponseSchema)({
      nonces: [12, 0, 5, 0],
      block_height: 42,
      block_hash: "11111111111111111111111111111111",
    })
    expect(parsed.nonces).toEqual([12, 0, 5, 0])
    expect(parsed.block_height).toBe(42)
    expect(parsed.block_hash).toBe("11111111111111111111111111111111")
  })

  test("parses a freshly funded gas key (all lanes at zero)", () => {
    const parsed = Schema.decodeSync(GasKeyNoncesResponseSchema)({
      nonces: [0, 0],
      block_height: 1,
      block_hash: "abc",
    })
    expect(parsed.nonces).toEqual([0, 0])
  })

  test("rejects a response missing the nonces array", () => {
    expect(() =>
      Schema.decodeUnknownSync(GasKeyNoncesResponseSchema)({
        block_height: 1,
        block_hash: "abc",
      }),
    ).toThrow()
  })
})
