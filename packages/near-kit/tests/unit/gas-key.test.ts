/**
 * Tests for gas-key actions and access-key permissions (protocol v85 / NEAR 2.13).
 *
 * Wire-format facts (from nearcore):
 * - Action discriminants: TransferToGasKey = 12, WithdrawFromGasKey = 13.
 * - AccessKeyPermission discriminants: FunctionCall = 0, FullAccess = 1,
 *   GasKeyFunctionCall = 2, GasKeyFullAccess = 3.
 * - GasKeyInfo { balance: u128, num_nonces: u16 }.
 */

import { describe, expect, test } from "vitest"
import {
  gasKeyFullAccess,
  gasKeyFunctionCall,
  transferToGasKey,
  withdrawFromGasKey,
} from "../../src/core/actions.js"
import {
  AccessKeyPermissionSchema,
  ActionSchema,
} from "../../src/core/schema.js"
import { type Ed25519PublicKey, KeyType } from "../../src/core/types.js"

const ed25519Pk = (fill: number): Ed25519PublicKey => ({
  keyType: KeyType.ED25519,
  data: new Uint8Array(32).fill(fill),
  toString: () => "ed25519:test",
})

describe("Gas key actions", () => {
  test("transferToGasKey has shape and discriminant 12", () => {
    const action = transferToGasKey(ed25519Pk(1), 5n)

    expect("transferToGasKey" in action).toBe(true)
    expect(action.transferToGasKey.deposit).toBe(5n)
    expect(action.transferToGasKey.publicKey.ed25519Key.data).toEqual(
      Array(32).fill(1),
    )

    const bytes = ActionSchema.serialize(action)
    expect(bytes[0]).toBe(12)
    // discriminant(1) + pubkey enum tag(1) + 32 key bytes + u128 deposit(16)
    expect(bytes.length).toBe(1 + 1 + 32 + 16)
  })

  test("withdrawFromGasKey has shape and discriminant 13", () => {
    const action = withdrawFromGasKey(ed25519Pk(2), 7n)

    expect("withdrawFromGasKey" in action).toBe(true)
    // Second field is `amount`, not `deposit`.
    expect(action.withdrawFromGasKey.amount).toBe(7n)
    expect(action.withdrawFromGasKey.publicKey.ed25519Key.data).toEqual(
      Array(32).fill(2),
    )

    const bytes = ActionSchema.serialize(action)
    expect(bytes[0]).toBe(13)
    expect(bytes.length).toBe(1 + 1 + 32 + 16)
  })

  test("gas key actions round-trip through ActionSchema", () => {
    for (const action of [
      transferToGasKey(ed25519Pk(3), 1_000_000n),
      withdrawFromGasKey(ed25519Pk(4), 2_000_000n),
    ]) {
      const bytes = ActionSchema.serialize(action)
      expect(ActionSchema.deserialize(bytes)).toEqual(action)
    }
  })
})

describe("Gas key permissions", () => {
  test("gasKeyFullAccess has discriminant 3 and zero balance", () => {
    const permission = gasKeyFullAccess(4)

    expect("gasKeyFullAccess" in permission).toBe(true)
    if (!("gasKeyFullAccess" in permission)) throw new Error("unreachable")
    expect(permission.gasKeyFullAccess.gasKeyInfo.balance).toBe(0n)
    expect(permission.gasKeyFullAccess.gasKeyInfo.numNonces).toBe(4)

    const bytes = AccessKeyPermissionSchema.serialize(permission)
    expect(bytes[0]).toBe(3)
    // discriminant(1) + balance u128(16) + num_nonces u16(2)
    expect(bytes.length).toBe(1 + 16 + 2)
  })

  test("GasKeyFullAccess matches the exact nearcore borsh wire bytes", () => {
    // GasKeyFullAccess(GasKeyInfo { balance: 0, num_nonces: 5 })
    // borsh: [03] ++ u128(0) LE (16 bytes) ++ u16(5) LE (2 bytes)
    const bytes = AccessKeyPermissionSchema.serialize(gasKeyFullAccess(5))
    const expected = new Uint8Array([
      3, // GasKeyFullAccess discriminant
      ...new Array(16).fill(0), // balance u128 = 0
      5,
      0, // num_nonces u16 = 5 (little-endian)
    ])
    expect(bytes).toEqual(expected)
  })

  test("gasKeyFunctionCall has discriminant 2 and no allowance", () => {
    const permission = gasKeyFunctionCall(2, {
      receiverId: "contract.near",
      methodNames: ["do_thing"],
      allowance: null,
    })

    expect("gasKeyFunctionCall" in permission).toBe(true)
    if (!("gasKeyFunctionCall" in permission)) throw new Error("unreachable")
    expect(permission.gasKeyFunctionCall.gasKeyInfo.balance).toBe(0n)
    expect(permission.gasKeyFunctionCall.gasKeyInfo.numNonces).toBe(2)
    expect(permission.gasKeyFunctionCall.functionCall.allowance).toBe(null)
    expect(permission.gasKeyFunctionCall.functionCall.receiverId).toBe(
      "contract.near",
    )

    const bytes = AccessKeyPermissionSchema.serialize(permission)
    expect(bytes[0]).toBe(2)
  })

  test("gas key permissions round-trip through AccessKeyPermissionSchema", () => {
    for (const permission of [
      gasKeyFullAccess(1),
      gasKeyFunctionCall(1024, {
        receiverId: "c.near",
        methodNames: [],
        allowance: null,
      }),
    ]) {
      const bytes = AccessKeyPermissionSchema.serialize(permission)
      expect(AccessKeyPermissionSchema.deserialize(bytes)).toEqual(permission)
    }
  })

  test("numNonces is validated against the 1..=1024 protocol bound", () => {
    expect(() => gasKeyFullAccess(0)).toThrow(/1\.\.=1024/)
    expect(() => gasKeyFullAccess(1025)).toThrow(/1\.\.=1024/)
    expect(() => gasKeyFullAccess(1.5)).toThrow(/1\.\.=1024/)
    expect(() => gasKeyFullAccess(1)).not.toThrow()
    expect(() => gasKeyFullAccess(1024)).not.toThrow()
  })
})
