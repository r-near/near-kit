/**
 * Tests for validation schemas
 */

import { describe, expect, test } from "bun:test"
import { Amount } from "../../src/utils/amount.js"
import { Gas } from "../../src/utils/gas.js"
import { generateKey } from "../../src/utils/key.js"
import {
  AccountIdSchema,
  AmountSchema,
  GasSchema,
  isPrivateKey,
  isValidAccountId,
  isValidPublicKey,
  normalizeAmount,
  normalizeGas,
  PrivateKeySchema,
  PublicKeySchema,
  validateAccountId,
  validatePrivateKey,
  validatePublicKey,
} from "../../src/utils/validation.js"

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
    const longId = `${"a".repeat(65)}.near`
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

describe("Private Key Schema", () => {
  test("should accept valid Ed25519 private keys", () => {
    const key = generateKey()
    const privateKeyString = key.secretKey.toString()

    expect(PrivateKeySchema.parse(privateKeyString)).toBe(privateKeyString)
    expect(isPrivateKey(privateKeyString)).toBe(true)
  })

  test("should accept valid Secp256k1 private keys", () => {
    const validSecp256k1 =
      "secp256k1:3nYJjpbNczpvt9zJaQZvnv4YTwN4h8gxhJr6Jq3BqR8qA7Z7N3K9M5V1X8J9Q2L4"

    expect(PrivateKeySchema.parse(validSecp256k1)).toBe(validSecp256k1)
    expect(isPrivateKey(validSecp256k1)).toBe(true)
  })

  test("should accept manually constructed Ed25519 private key", () => {
    const validEd25519 =
      "ed25519:3J4DuFq9YC5JHLk3M1V6Wj8bNqKpT2xF9sR5vH7nL2gE4wB8yA9cD1mP3tX6kZq"

    expect(PrivateKeySchema.parse(validEd25519)).toBe(validEd25519)
    expect(isPrivateKey(validEd25519)).toBe(true)
  })

  test("should reject keys without prefix", () => {
    expect(() =>
      PrivateKeySchema.parse(
        "3J4DuFq9YC5JHLk3M1V6Wj8bNqKpT2xF9sR5vH7nL2gE4wB8yA9cD1mP3tX6kZq",
      ),
    ).toThrow()
    expect(
      isPrivateKey(
        "3J4DuFq9YC5JHLk3M1V6Wj8bNqKpT2xF9sR5vH7nL2gE4wB8yA9cD1mP3tX6kZq",
      ),
    ).toBe(false)
  })

  test("should reject keys with invalid prefix", () => {
    expect(() =>
      PrivateKeySchema.parse(
        "invalid:3J4DuFq9YC5JHLk3M1V6Wj8bNqKpT2xF9sR5vH7nL2gE4wB8yA9cD1mP3tX6kZq",
      ),
    ).toThrow()
    expect(
      isPrivateKey(
        "invalid:3J4DuFq9YC5JHLk3M1V6Wj8bNqKpT2xF9sR5vH7nL2gE4wB8yA9cD1mP3tX6kZq",
      ),
    ).toBe(false)
  })

  test("should reject keys with invalid base58", () => {
    expect(() => PrivateKeySchema.parse("ed25519:!!!invalid!!!")).toThrow()
    expect(isPrivateKey("ed25519:!!!invalid!!!")).toBe(false)
  })

  test("should reject keys with empty data", () => {
    expect(() => PrivateKeySchema.parse("ed25519:")).toThrow()
    expect(isPrivateKey("ed25519:")).toBe(false)
  })

  test("should reject keys with invalid characters (0, O, I, l)", () => {
    expect(() => PrivateKeySchema.parse("ed25519:0OIl")).toThrow()
    expect(isPrivateKey("ed25519:0OIl")).toBe(false)
  })

  test("validatePrivateKey() should return valid Ed25519 key", () => {
    const validEd25519 =
      "ed25519:3J4DuFq9YC5JHLk3M1V6Wj8bNqKpT2xF9sR5vH7nL2gE4wB8yA9cD1mP3tX6kZq"
    expect(validatePrivateKey(validEd25519)).toBe(validEd25519)
  })

  test("validatePrivateKey() should return valid Secp256k1 key", () => {
    const validSecp256k1 =
      "secp256k1:3nYJjpbNczpvt9zJaQZvnv4YTwN4h8gxhJr6Jq3BqR8qA7Z7N3K9M5V1X8J9Q2L4"
    expect(validatePrivateKey(validSecp256k1)).toBe(validSecp256k1)
  })

  test("validatePrivateKey() should throw on invalid key", () => {
    expect(() => validatePrivateKey("invalid:key")).toThrow()
  })

  test("validatePrivateKey() should throw on missing prefix", () => {
    expect(() =>
      validatePrivateKey(
        "3J4DuFq9YC5JHLk3M1V6Wj8bNqKpT2xF9sR5vH7nL2gE4wB8yA9cD1mP3tX6kZq",
      ),
    ).toThrow()
  })

  test("validatePrivateKey() should throw on empty suffix", () => {
    expect(() => validatePrivateKey("ed25519:")).toThrow()
    expect(() => validatePrivateKey("secp256k1:")).toThrow()
  })
})

describe("Amount Schema", () => {
  test("should parse NEAR amounts with explicit unit", () => {
    expect(AmountSchema.parse("10 NEAR")).toBe("10000000000000000000000000")
    expect(AmountSchema.parse("100 NEAR")).toBe("100000000000000000000000000")
    expect(AmountSchema.parse("1 NEAR")).toBe("1000000000000000000000000")
  })

  test("should parse yocto amounts", () => {
    expect(AmountSchema.parse("10 yocto")).toBe("10")
    expect(AmountSchema.parse("100 yocto")).toBe("100")
    expect(AmountSchema.parse("1000000 yocto")).toBe("1000000")
  })

  test("should parse Amount.NEAR() output", () => {
    expect(AmountSchema.parse(Amount.NEAR(10))).toBe(
      "10000000000000000000000000",
    )
    expect(AmountSchema.parse(Amount.NEAR(100))).toBe(
      "100000000000000000000000000",
    )
    expect(AmountSchema.parse(Amount.NEAR(1.5))).toBe(
      "1500000000000000000000000",
    )
  })

  test("should parse Amount.yocto() output", () => {
    expect(AmountSchema.parse(Amount.yocto(10n))).toBe("10")
    expect(AmountSchema.parse(Amount.yocto("100"))).toBe("100")
    expect(AmountSchema.parse(Amount.yocto(1000000n))).toBe("1000000")
  })

  test("should parse raw bigint as yoctoNEAR", () => {
    expect(AmountSchema.parse(1000000n)).toBe("1000000")
    expect(AmountSchema.parse(0n)).toBe("0")
    expect(AmountSchema.parse(10000000000000000000000000n)).toBe(
      "10000000000000000000000000",
    )
  })

  test("should parse very large bigint", () => {
    const largeAmount = 123456789000000000000000000n
    expect(AmountSchema.parse(largeAmount)).toBe(largeAmount.toString())
  })

  test("should convert NEAR suffix to yoctoNEAR (case insensitive)", () => {
    // 1 NEAR = 10^24 yoctoNEAR
    expect(AmountSchema.parse("10 NEAR")).toBe("10000000000000000000000000")
    expect(AmountSchema.parse("10 near")).toBe("10000000000000000000000000")
    expect(AmountSchema.parse("10 Near")).toBe("10000000000000000000000000")
  })

  test("should convert decimal NEAR to yoctoNEAR with precision", () => {
    // 1.5 NEAR = 1.5 * 10^24 yoctoNEAR
    expect(AmountSchema.parse("1.5 NEAR")).toBe("1500000000000000000000000")
    // 0.1 NEAR = 0.1 * 10^24 yoctoNEAR
    expect(AmountSchema.parse("0.1 NEAR")).toBe("100000000000000000000000")
    // Very small fractional amount with full precision (24 decimal places)
    expect(AmountSchema.parse("1.123456789012345678901234 NEAR")).toBe(
      "1123456789012345678901234",
    )
    // Fractional part longer than 24 places should truncate
    expect(AmountSchema.parse("1.1234567890123456789012345678 NEAR")).toBe(
      "1123456789012345678901234",
    )
  })

  test("should reject bare numbers (without unit)", () => {
    expect(() => AmountSchema.parse("10")).toThrow(/Ambiguous amount/)
    expect(() => AmountSchema.parse("1.5")).toThrow(/Ambiguous amount/)
    expect(() => AmountSchema.parse("1000")).toThrow(/Ambiguous amount/)
  })

  test("should reject negative amounts", () => {
    expect(() => AmountSchema.parse("-10 NEAR")).toThrow(/Invalid amount/)
    expect(() => AmountSchema.parse("-10 yocto")).toThrow(/Invalid amount/)
  })

  test("should reject invalid string amounts", () => {
    expect(() => AmountSchema.parse("abc")).toThrow(/Invalid amount/)
    expect(() => AmountSchema.parse("")).toThrow(/Invalid amount/)
    expect(() => AmountSchema.parse("10 USD")).toThrow(/Invalid amount/)
  })

  test("normalizeAmount() should normalize with explicit units", () => {
    expect(normalizeAmount("10 NEAR")).toBe("10000000000000000000000000")
    expect(normalizeAmount("1000 yocto")).toBe("1000")
    expect(normalizeAmount(Amount.NEAR(10))).toBe("10000000000000000000000000")
  })
})

describe("Gas Schema", () => {
  test("should parse string gas amounts", () => {
    expect(GasSchema.parse("30000000000000")).toBe("30000000000000")
    expect(GasSchema.parse("100")).toBe("100")
  })

  test("should parse Gas.Tgas() output", () => {
    expect(GasSchema.parse(Gas.Tgas(30))).toBe("30000000000000")
    expect(GasSchema.parse(Gas.Tgas(300))).toBe("300000000000000")
    expect(GasSchema.parse(Gas.Tgas(1.5))).toBe("1500000000000")
  })

  test("should parse Tgas format (case insensitive)", () => {
    expect(GasSchema.parse("30 Tgas")).toBe("30000000000000")
    expect(GasSchema.parse("30 TGas")).toBe("30000000000000")
    expect(GasSchema.parse("30 tgas")).toBe("30000000000000")
  })

  test("should handle decimal Tgas values", () => {
    expect(GasSchema.parse("1.5 Tgas")).toBe("1500000000000")
    expect(GasSchema.parse("0.5 Tgas")).toBe("500000000000")
  })

  test("should reject negative gas", () => {
    expect(() => GasSchema.parse("-30 Tgas")).toThrow(/Invalid gas/)
    expect(() => GasSchema.parse("-100")).toThrow(/Invalid gas/)
  })

  test("should reject invalid string gas", () => {
    expect(() => GasSchema.parse("abc")).toThrow(/Invalid gas/)
    expect(() => GasSchema.parse("")).toThrow(/Invalid gas/)
  })

  test("normalizeGas() should normalize with explicit units", () => {
    expect(normalizeGas("30 Tgas")).toBe("30000000000000")
    expect(normalizeGas("30000000000000")).toBe("30000000000000")
    expect(normalizeGas(Gas.Tgas(30))).toBe("30000000000000")
  })
})

describe("Edge Cases", () => {
  test("should handle zero values", () => {
    expect(AmountSchema.parse("0 NEAR")).toBe("0")
    expect(AmountSchema.parse("0 yocto")).toBe("0")
    expect(AmountSchema.parse(Amount.NEAR(0))).toBe("0")

    expect(GasSchema.parse("0 Tgas")).toBe("0")
    expect(GasSchema.parse("0")).toBe("0")
    expect(GasSchema.parse(Gas.Tgas(0))).toBe("0")
  })

  test("should handle very large numbers as yocto", () => {
    const large = "999999999999999999999999"
    // Large numbers must have unit
    expect(AmountSchema.parse(`${large} yocto`)).toBe(large)
    expect(GasSchema.parse(large)).toBe(large) // Gas accepts raw numbers
  })

  test("should handle whitespace in amounts", () => {
    expect(AmountSchema.parse("10 NEAR")).toBe("10000000000000000000000000")
    expect(GasSchema.parse("30 Tgas")).toBe("30000000000000")
    // Note: Extra whitespace in gas strings may not be handled by the regex
  })
})
