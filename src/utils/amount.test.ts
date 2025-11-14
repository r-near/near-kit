/**
 * Tests for amount utilities
 */

import { describe, expect, test } from "bun:test"
import { Amount, formatAmount, parseAmount } from "./amount.js"

describe("Amount", () => {
  describe("Amount.NEAR()", () => {
    test("creates NEAR amount from number", () => {
      expect(Amount.NEAR(10)).toBe("10 NEAR")
    })

    test("creates NEAR amount from decimal number", () => {
      expect(Amount.NEAR(10.5)).toBe("10.5 NEAR")
    })

    test("creates NEAR amount from string", () => {
      expect(Amount.NEAR("10.5")).toBe("10.5 NEAR")
    })

    test("preserves precision in string", () => {
      expect(Amount.NEAR("0.000000000000000000000001")).toBe(
        "0.000000000000000000000001 NEAR",
      )
    })
  })

  describe("Amount.yocto()", () => {
    test("creates yocto amount from bigint", () => {
      expect(Amount.yocto(1000000n)).toBe("1000000 yocto")
    })

    test("creates yocto amount from string", () => {
      expect(Amount.yocto("1000000")).toBe("1000000 yocto")
    })

    test("handles very large yocto amounts", () => {
      const largeAmount = "10000000000000000000000000"
      expect(Amount.yocto(largeAmount)).toBe(`${largeAmount} yocto`)
    })
  })

  describe("Amount constants", () => {
    test("ZERO", () => {
      expect(Amount.ZERO).toBe("0 yocto")
    })

    test("ONE_NEAR", () => {
      expect(Amount.ONE_NEAR).toBe("1 NEAR")
    })

    test("ONE_YOCTO", () => {
      expect(Amount.ONE_YOCTO).toBe("1 yocto")
    })
  })
})

describe("parseAmount", () => {
  describe("NEAR format", () => {
    test("parses whole NEAR amount", () => {
      const result = parseAmount("10 NEAR")
      expect(result).toBe("10000000000000000000000000")
    })

    test("parses decimal NEAR amount", () => {
      const result = parseAmount("10.5 NEAR")
      expect(result).toBe("10500000000000000000000000")
    })

    test("parses small NEAR amount", () => {
      const result = parseAmount("0.1 NEAR")
      expect(result).toBe("100000000000000000000000")
    })

    test("parses very small NEAR amount", () => {
      const result = parseAmount("0.000000000000000000000001 NEAR")
      expect(result).toBe("1")
    })

    test("handles case insensitive NEAR", () => {
      expect(parseAmount("10 near")).toBe("10000000000000000000000000")
      expect(parseAmount("10 Near")).toBe("10000000000000000000000000")
      expect(parseAmount("10 NEAR")).toBe("10000000000000000000000000")
    })

    test("handles extra whitespace", () => {
      expect(parseAmount("  10  NEAR  ")).toBe("10000000000000000000000000")
    })

    test("truncates precision beyond 24 decimals", () => {
      const result = parseAmount("1.0000000000000000000000001234567 NEAR")
      // Should only keep 24 decimal places
      expect(result).toBe("1000000000000000000000000")
    })
  })

  describe("yocto format", () => {
    test("parses yocto amount", () => {
      const result = parseAmount("1000000 yocto")
      expect(result).toBe("1000000")
    })

    test("parses large yocto amount", () => {
      const result = parseAmount("10000000000000000000000000 yocto")
      expect(result).toBe("10000000000000000000000000")
    })

    test("parses zero yocto", () => {
      const result = parseAmount("0 yocto")
      expect(result).toBe("0")
    })

    test("handles extra whitespace", () => {
      expect(parseAmount("  1000  yocto  ")).toBe("1000")
    })
  })

  describe("Amount.NEAR() output", () => {
    test("parses Amount.NEAR() result", () => {
      const amount = Amount.NEAR(10)
      const result = parseAmount(amount)
      expect(result).toBe("10000000000000000000000000")
    })

    test("parses Amount.NEAR() with decimal", () => {
      const amount = Amount.NEAR(10.5)
      const result = parseAmount(amount)
      expect(result).toBe("10500000000000000000000000")
    })
  })

  describe("Amount.yocto() output", () => {
    test("parses Amount.yocto() result", () => {
      const amount = Amount.yocto(1000000n)
      const result = parseAmount(amount)
      expect(result).toBe("1000000")
    })
  })

  describe("bigint input", () => {
    test("parses bigint as yoctoNEAR", () => {
      const result = parseAmount(1000000n)
      expect(result).toBe("1000000")
    })

    test("parses zero bigint", () => {
      const result = parseAmount(0n)
      expect(result).toBe("0")
    })

    test("parses large bigint", () => {
      const result = parseAmount(10000000000000000000000000n)
      expect(result).toBe("10000000000000000000000000")
    })

    test("parses very large bigint (multiple NEAR)", () => {
      const result = parseAmount(123456789000000000000000000n)
      expect(result).toBe("123456789000000000000000000")
    })
  })

  describe("error cases", () => {
    test("throws on bare number string", () => {
      expect(() => parseAmount("10")).toThrow("Ambiguous amount")
      expect(() => parseAmount("10")).toThrow("Did you mean")
    })

    test("throws on bare decimal string", () => {
      expect(() => parseAmount("10.5")).toThrow("Ambiguous amount")
    })

    test("throws on bare number (would be caught by TypeScript)", () => {
      // This would be a type error in TypeScript, but test runtime behavior
      expect(() => parseAmount("42" as any)).toThrow("Ambiguous amount")
    })

    test("throws on invalid format", () => {
      expect(() => parseAmount("invalid")).toThrow("Invalid amount format")
    })

    test("throws on negative NEAR", () => {
      expect(() => parseAmount("-10 NEAR")).toThrow("Invalid amount format")
    })

    test("throws on amount with wrong unit", () => {
      expect(() => parseAmount("10 USD")).toThrow("Invalid amount format")
    })

    test("throws on empty string", () => {
      expect(() => parseAmount("")).toThrow("Invalid amount format")
    })

    test("provides helpful error message for bare numbers", () => {
      try {
        parseAmount("100")
        expect(false).toBe(true) // Should not reach here
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(Error)
        const err = error as Error
        expect(err.message).toContain("Amount.NEAR(100)")
        expect(err.message).toContain("Amount.yocto(100n)")
        expect(err.message).toContain('"100 NEAR"')
        expect(err.message).toContain("100n as bigint")
      }
    })
  })
})

describe("formatAmount", () => {
  test("formats whole NEAR amount", () => {
    const result = formatAmount("10000000000000000000000000")
    expect(result).toBe("10 NEAR")
  })

  test("formats decimal NEAR amount", () => {
    const result = formatAmount("10500000000000000000000000")
    expect(result).toBe("10.50 NEAR")
  })

  test("formats small NEAR amount", () => {
    const result = formatAmount("100000000000000000000000")
    expect(result).toBe("0.10 NEAR")
  })

  test("formats very small amount", () => {
    const result = formatAmount("1")
    expect(result).toBe("0.00 NEAR")
  })

  test("formats zero", () => {
    const result = formatAmount("0")
    expect(result).toBe("0 NEAR")
  })

  test("accepts bigint input", () => {
    const result = formatAmount(10000000000000000000000000n)
    expect(result).toBe("10 NEAR")
  })

  describe("precision option", () => {
    test("respects custom precision", () => {
      const amount = "10500000000000000000000000"
      expect(formatAmount(amount, { precision: 4 })).toBe("10.5000 NEAR")
      expect(formatAmount(amount, { precision: 1 })).toBe("10.5 NEAR")
      expect(formatAmount(amount, { precision: 0 })).toBe("10 NEAR")
    })

    test("pads fractional part to precision", () => {
      const amount = "10100000000000000000000000"
      expect(formatAmount(amount, { precision: 4 })).toBe("10.1000 NEAR")
    })
  })

  describe("includeSuffix option", () => {
    test("excludes suffix when false", () => {
      const result = formatAmount("10500000000000000000000000", {
        includeSuffix: false,
      })
      expect(result).toBe("10.50")
    })

    test("includes suffix by default", () => {
      const result = formatAmount("10500000000000000000000000")
      expect(result).toBe("10.50 NEAR")
    })
  })

  describe("trimZeros option", () => {
    test("trims trailing zeros when true", () => {
      const amount = "10500000000000000000000000"
      expect(formatAmount(amount, { trimZeros: true })).toBe("10.5 NEAR")
    })

    test("keeps zeros by default", () => {
      const amount = "10500000000000000000000000"
      expect(formatAmount(amount)).toBe("10.50 NEAR")
    })

    test("handles whole numbers with trimZeros", () => {
      const amount = "10000000000000000000000000"
      expect(formatAmount(amount, { trimZeros: true })).toBe("10 NEAR")
    })
  })

  describe("combined options", () => {
    test("precision + trimZeros + includeSuffix", () => {
      const amount = "10500000000000000000000000"
      expect(
        formatAmount(amount, {
          precision: 4,
          trimZeros: true,
          includeSuffix: false,
        }),
      ).toBe("10.5")
    })
  })
})
