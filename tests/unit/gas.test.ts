/**
 * Tests for gas utilities
 */

import { describe, expect, test } from "bun:test"
import { formatGas, Gas, parseGas } from "../../src/utils/gas.js"

describe("Gas", () => {
  describe("Gas.Tgas()", () => {
    test("creates gas amount from number", () => {
      expect(Gas.Tgas(30)).toBe("30 Tgas")
    })

    test("creates gas amount from decimal number", () => {
      expect(Gas.Tgas(30.5)).toBe("30.5 Tgas")
    })

    test("creates gas amount from string", () => {
      expect(Gas.Tgas("300")).toBe("300 Tgas")
    })
  })

  describe("Gas constants", () => {
    test("DEFAULT", () => {
      expect(Gas.DEFAULT).toBe("30 Tgas")
    })

    test("MAX", () => {
      expect(Gas.MAX).toBe("300 Tgas")
    })
  })
})

describe("parseGas", () => {
  describe("Tgas format", () => {
    test("parses Tgas amount", () => {
      const result = parseGas("30 Tgas")
      expect(result).toBe("30000000000000")
    })

    test("parses decimal Tgas amount", () => {
      const result = parseGas("30.5 Tgas")
      expect(result).toBe("30500000000000")
    })

    test("parses large Tgas amount", () => {
      const result = parseGas("300 Tgas")
      expect(result).toBe("300000000000000")
    })

    test("handles case insensitive Tgas", () => {
      expect(parseGas("30 tgas")).toBe("30000000000000")
      expect(parseGas("30 TGas")).toBe("30000000000000")
      expect(parseGas("30 TGAS")).toBe("30000000000000")
    })

    test("handles extra whitespace", () => {
      expect(parseGas("  30  Tgas  ")).toBe("30000000000000")
    })

    test("floors decimal Tgas values", () => {
      const result = parseGas("30.999 Tgas")
      expect(result).toBe("30999000000000")
    })
  })

  describe("raw gas format", () => {
    test("parses raw gas number", () => {
      const result = parseGas("30000000000000")
      expect(result).toBe("30000000000000")
    })

    test("parses large raw gas", () => {
      const result = parseGas("300000000000000")
      expect(result).toBe("300000000000000")
    })

    test("parses zero gas", () => {
      const result = parseGas("0")
      expect(result).toBe("0")
    })
  })

  describe("Gas.Tgas() output", () => {
    test("parses Gas.Tgas() result", () => {
      const gas = Gas.Tgas(30)
      const result = parseGas(gas)
      expect(result).toBe("30000000000000")
    })

    test("parses Gas.Tgas() with decimal", () => {
      const gas = Gas.Tgas(30.5)
      const result = parseGas(gas)
      expect(result).toBe("30500000000000")
    })
  })

  describe("Gas constants", () => {
    test("parses Gas.DEFAULT", () => {
      const result = parseGas(Gas.DEFAULT)
      expect(result).toBe("30000000000000")
    })

    test("parses Gas.MAX", () => {
      const result = parseGas(Gas.MAX)
      expect(result).toBe("300000000000000")
    })
  })

  describe("error cases", () => {
    test("throws on invalid format", () => {
      expect(() => parseGas("invalid")).toThrow("Invalid gas format")
    })

    test("throws on negative Tgas", () => {
      expect(() => parseGas("-30 Tgas")).toThrow("Invalid gas format")
    })

    test("throws on NaN Tgas", () => {
      expect(() => parseGas("abc Tgas")).toThrow("Invalid gas format")
    })

    test("throws on gas with wrong unit", () => {
      expect(() => parseGas("30 Ggas")).toThrow("Invalid gas format")
    })

    test("throws on empty string", () => {
      expect(() => parseGas("")).toThrow("Invalid gas format")
    })

    test("provides helpful error message", () => {
      try {
        parseGas("invalid")
        expect(false).toBe(true) // Should not reach here
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(Error)
        const err = error as Error
        expect(err.message).toContain("30 Tgas")
        expect(err.message).toContain("Gas.Tgas(30)")
      }
    })
  })
})

describe("formatGas", () => {
  test("formats gas to Tgas", () => {
    const result = formatGas("30000000000000")
    expect(result).toBe("30.00 Tgas")
  })

  test("formats large gas amount", () => {
    const result = formatGas("300000000000000")
    expect(result).toBe("300.00 Tgas")
  })

  test("formats decimal gas amount", () => {
    const result = formatGas("30500000000000")
    expect(result).toBe("30.50 Tgas")
  })

  test("formats zero gas", () => {
    const result = formatGas("0")
    expect(result).toBe("0.00 Tgas")
  })

  test("accepts bigint input", () => {
    const result = formatGas(30000000000000n)
    expect(result).toBe("30.00 Tgas")
  })

  describe("precision option", () => {
    test("respects custom precision", () => {
      const gas = "30500000000000"
      expect(formatGas(gas, 0)).toBe("31 Tgas") // Rounds to nearest
      expect(formatGas(gas, 1)).toBe("30.5 Tgas")
      expect(formatGas(gas, 4)).toBe("30.5000 Tgas")
    })

    test("uses 2 decimal places by default", () => {
      const gas = "30000000000000"
      expect(formatGas(gas)).toBe("30.00 Tgas")
    })
  })

  describe("round-trip conversion", () => {
    test("parse and format round-trip", () => {
      const original = "30 Tgas"
      const parsed = parseGas(original)
      const formatted = formatGas(parsed)
      expect(formatted).toBe("30.00 Tgas")
    })

    test("format and parse round-trip", () => {
      const raw = "30000000000000"
      const formatted = formatGas(raw)
      const parsed = parseGas(formatted)
      expect(parsed).toBe(raw)
    })
  })
})
