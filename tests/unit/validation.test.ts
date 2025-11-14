/**
 * Tests for validation schemas
 */

import { describe, expect, test } from "bun:test"
import {
  AccountIdSchema,
  AmountSchema,
  GasSchema,
  PublicKeySchema,
  isValidAccountId,
  isValidPublicKey,
  normalizeAmount,
  normalizeGas,
  validateAccountId,
  validatePublicKey,
} from "../../src/utils/validation.js"
import { generateKey } from "../../src/utils/key.js"

describe("Account ID Schema", () => {
  test("should accept valid account IDs", () => {
    const validIds = [
      "alice.near",
      "bob-123.near",
      "contract_v2.near",
      "a.near",
      "test123.testnet",
      "sub.domain.near",
      "a-b_c.near",
      "12345.near",
    ]

    for (const id of validIds) {
      expect(AccountIdSchema.parse(id)).toBe(id)
      expect(isValidAccountId(id)).toBe(true)
    }
  })

  test("should reject account IDs that are too short", () => {
    expect(() => AccountIdSchema.parse("a")).toThrow()
    expect(isValidAccountId("a")).toBe(false)
  })

  test("should reject account IDs that are too long", () => {
    const longId = "a".repeat(65) + ".near"
    expect(() => AccountIdSchema.parse(longId)).toThrow()
    expect(isValidAccountId(longId)).toBe(false)
  })

  test("should reject account IDs with uppercase letters", () => {
    expect(() => AccountIdSchema.parse("Alice.near")).toThrow()
    expect(isValidAccountId("Alice.near")).toBe(false)
  })

  test("should reject account IDs with invalid characters", () => {
    const invalidIds = [
      "alice@near",
      "alice.NEAR",
      "alice!near",
      "alice near",
      "alice#near",
    ]

    for (const id of invalidIds) {
      expect(() => AccountIdSchema.parse(id)).toThrow()
      expect(isValidAccountId(id)).toBe(false)
    }
  })

  test("validateAccountId() should return valid ID", () => {
    expect(validateAccountId("alice.near")).toBe("alice.near")
  })

  test("validateAccountId() should throw on invalid ID", () => {
    expect(() => validateAccountId("INVALID")).toThrow()
  })
})

describe("Public Key Schema", () => {
  test("should accept valid Ed25519 keys", () => {
    const key = generateKey()
    const keyString = key.publicKey.toString()

    expect(PublicKeySchema.parse(keyString)).toBe(keyString)
    expect(isValidPublicKey(keyString)).toBe(true)
  })

  test("should accept manually constructed Ed25519 key", () => {
    const validKey = "ed25519:DcA2MzgpJbrUATQLLceocVckhhAqrkingax4oJ9kZ847"

    expect(PublicKeySchema.parse(validKey)).toBe(validKey)
    expect(isValidPublicKey(validKey)).toBe(true)
  })

  test("should reject keys without prefix", () => {
    expect(() =>
      PublicKeySchema.parse("DcA2MzgpJbrUATQLLceocVckhhAqrkingax4oJ9kZ847"),
    ).toThrow()
    expect(
      isValidPublicKey("DcA2MzgpJbrUATQLLceocVckhhAqrkingax4oJ9kZ847"),
    ).toBe(false)
  })

  test("should reject keys with invalid base58", () => {
    expect(() => PublicKeySchema.parse("ed25519:!!!invalid!!!")).toThrow()
    expect(isValidPublicKey("ed25519:!!!invalid!!!")).toBe(false)
  })

  test("should reject keys with empty data", () => {
    expect(() => PublicKeySchema.parse("ed25519:")).toThrow()
    expect(isValidPublicKey("ed25519:")).toBe(false)
  })

  test("should reject keys with invalid type", () => {
    expect(() => PublicKeySchema.parse("invalid:abc123")).toThrow()
    expect(isValidPublicKey("invalid:abc123")).toBe(false)
  })

  test("should reject keys with invalid characters (0, O, I, l)", () => {
    expect(() => PublicKeySchema.parse("ed25519:0OIl")).toThrow()
    expect(isValidPublicKey("ed25519:0OIl")).toBe(false)
  })

  test("validatePublicKey() should return valid key", () => {
    const key = generateKey()
    const keyString = key.publicKey.toString()

    expect(validatePublicKey(keyString)).toBe(keyString)
  })

  test("validatePublicKey() should throw on invalid key", () => {
    expect(() => validatePublicKey("invalid:key")).toThrow()
  })
})

describe("Amount Schema", () => {
  test("should parse string amounts", () => {
    expect(AmountSchema.parse("10")).toBe("10")
    expect(AmountSchema.parse("100")).toBe("100")
    expect(AmountSchema.parse("1000000")).toBe("1000000")
  })

  test("should parse number amounts", () => {
    expect(AmountSchema.parse(10)).toBe("10")
    expect(AmountSchema.parse(100)).toBe("100")
    expect(AmountSchema.parse(1.5)).toBe("1") // Floors decimals
  })

  test("should parse bigint amounts", () => {
    expect(AmountSchema.parse(10n)).toBe("10")
    expect(AmountSchema.parse(100n)).toBe("100")
    expect(AmountSchema.parse(1000000n)).toBe("1000000")
  })

  test("should strip NEAR suffix", () => {
    expect(AmountSchema.parse("10 NEAR")).toBe("10")
    expect(AmountSchema.parse("10 near")).toBe("10")
    expect(AmountSchema.parse("10 N")).toBe("10")
    expect(AmountSchema.parse("10NEAR")).toBe("10")
  })

  test("should handle decimal strings", () => {
    expect(AmountSchema.parse("1.5")).toBe("1")
    expect(AmountSchema.parse("10.99")).toBe("10")
  })

  test("should reject negative amounts", () => {
    expect(() => AmountSchema.parse(-10)).toThrow()
    expect(() => AmountSchema.parse("-10")).toThrow()
  })

  test("should reject invalid string amounts", () => {
    expect(() => AmountSchema.parse("abc")).toThrow(/Invalid amount/)
    expect(() => AmountSchema.parse("")).toThrow(/Invalid amount/)
  })

  test("should reject NaN", () => {
    expect(() => AmountSchema.parse(Number.NaN)).toThrow()
  })

  test("should reject Infinity", () => {
    expect(() => AmountSchema.parse(Number.POSITIVE_INFINITY)).toThrow()
  })

  test("normalizeAmount() should normalize various formats", () => {
    expect(normalizeAmount("1000")).toBe("1000")
    expect(normalizeAmount(1000)).toBe("1000")
    expect(normalizeAmount(1000n)).toBe("1000")
    expect(normalizeAmount("10 NEAR")).toBe("10")
  })
})

describe("Gas Schema", () => {
  test("should parse string gas amounts", () => {
    expect(GasSchema.parse("30000000000000")).toBe("30000000000000")
    expect(GasSchema.parse("100")).toBe("100")
  })

  test("should parse number gas amounts", () => {
    expect(GasSchema.parse(30000000000000)).toBe("30000000000000")
    expect(GasSchema.parse(100)).toBe("100")
  })

  test("should parse bigint gas amounts", () => {
    expect(GasSchema.parse(30000000000000n)).toBe("30000000000000")
    expect(GasSchema.parse(100n)).toBe("100")
  })

  test("should parse Tgas suffix", () => {
    expect(GasSchema.parse("30 Tgas")).toBe("30000000000000")
    expect(GasSchema.parse("30 TGas")).toBe("30000000000000")
    expect(GasSchema.parse("30 tgas")).toBe("30000000000000")
    expect(GasSchema.parse("30Tgas")).toBe("30000000000000")
  })

  test("should handle decimal Tgas values", () => {
    expect(GasSchema.parse("1.5 Tgas")).toBe("1500000000000")
    expect(GasSchema.parse("0.5 Tgas")).toBe("500000000000")
  })

  test("should reject negative gas", () => {
    expect(() => GasSchema.parse(-100)).toThrow()
    expect(() => GasSchema.parse("-100")).toThrow()
  })

  test("should reject invalid string gas", () => {
    expect(() => GasSchema.parse("abc")).toThrow(/Invalid gas/)
    expect(() => GasSchema.parse("")).toThrow(/Invalid gas/)
  })

  test("should reject NaN", () => {
    expect(() => GasSchema.parse(Number.NaN)).toThrow()
  })

  test("should reject Infinity", () => {
    expect(() => GasSchema.parse(Number.POSITIVE_INFINITY)).toThrow()
  })

  test("normalizeGas() should normalize various formats", () => {
    expect(normalizeGas("30 Tgas")).toBe("30000000000000")
    expect(normalizeGas(30000000000000)).toBe("30000000000000")
    expect(normalizeGas(30000000000000n)).toBe("30000000000000")
  })
})

describe("Edge Cases", () => {
  test("should handle zero values", () => {
    expect(AmountSchema.parse(0)).toBe("0")
    expect(AmountSchema.parse("0")).toBe("0")
    expect(AmountSchema.parse(0n)).toBe("0")

    expect(GasSchema.parse(0)).toBe("0")
    expect(GasSchema.parse("0")).toBe("0")
    expect(GasSchema.parse(0n)).toBe("0")
  })

  test("should handle very large numbers as strings", () => {
    const large = "999999999999999999999999"
    // When passed as string, precision is preserved
    expect(AmountSchema.parse(large)).toBe(large)
    expect(GasSchema.parse(large)).toBe(large)
  })

  test("should handle whitespace in amounts", () => {
    expect(AmountSchema.parse("10 NEAR")).toBe("10")
    expect(GasSchema.parse("30 Tgas")).toBe("30000000000000")
    // Note: Extra whitespace in gas strings may not be handled by the regex
  })
})
