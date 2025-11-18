/**
 * Tests for gas utilities
 */

import { describe, expect, test } from "bun:test"
import { formatGas, Gas, parseGas, toGas, toTGas } from "../../src/utils/gas.js"

// Helper for testing runtime behavior with strings
// that are intentionally outside the GasInput type.
const parseGasUnsafe = (value: string) => parseGas(value as any)

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
      expect(parseGasUnsafe("30 tgas")).toBe("30000000000000")
      expect(parseGasUnsafe("30 TGas")).toBe("30000000000000")
      expect(parseGasUnsafe("30 TGAS")).toBe("30000000000000")
    })

    test("handles extra whitespace", () => {
      expect(parseGasUnsafe("  30  Tgas  ")).toBe("30000000000000")
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
      expect(() => parseGasUnsafe("invalid")).toThrow("Invalid gas format")
    })

    test("throws on negative Tgas", () => {
      expect(() => parseGasUnsafe("-30 Tgas")).toThrow("Invalid gas format")
    })

    test("throws on NaN Tgas", () => {
      expect(() => parseGasUnsafe("abc Tgas")).toThrow("Invalid gas format")
    })

    test("throws on gas with wrong unit", () => {
      expect(() => parseGasUnsafe("30 Ggas")).toThrow("Invalid gas format")
    })

    test("throws on empty string", () => {
      expect(() => parseGasUnsafe("")).toThrow("Invalid gas format")
    })

    test("throws on invalid numeric format in Tgas", () => {
      expect(() => parseGasUnsafe(".. Tgas")).toThrow("Invalid Tgas value")
    })

    test("throws on multiple dots that result in NaN", () => {
      expect(() => parseGasUnsafe("... Tgas")).toThrow("Invalid Tgas value")
    })

    test("provides helpful error message", () => {
      try {
        parseGasUnsafe("invalid")
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
      const parsed = parseGasUnsafe(formatted)
      expect(parsed).toBe(raw)
    })
  })
})

describe("toGas", () => {
  test("converts 0 TGas to raw gas", () => {
    const result = toGas(0)
    expect(result).toBe("0")
  })

  test("converts 1 TGas to raw gas", () => {
    const result = toGas(1)
    expect(result).toBe("1000000000000")
  })

  test("converts 30 TGas to raw gas", () => {
    const result = toGas(30)
    expect(result).toBe("30000000000000")
  })

  test("converts 300 TGas to raw gas", () => {
    const result = toGas(300)
    expect(result).toBe("300000000000000")
  })

  test("converts decimal TGas to raw gas", () => {
    const result = toGas(30.5)
    expect(result).toBe("30500000000000")
  })

  test("converts 0.001 TGas to raw gas", () => {
    const result = toGas(0.001)
    expect(result).toBe("1000000000")
  })

  test("rounds down decimal TGas values", () => {
    const result = toGas(30.999)
    expect(result).toBe("30999000000000")
  })
})

describe("toTGas", () => {
  test("converts 0 raw gas to TGas", () => {
    const result = toTGas("0")
    expect(result).toBe(0)
  })

  test("converts 1 Tgas raw gas to TGas from string", () => {
    const result = toTGas("1000000000000")
    expect(result).toBe(1)
  })

  test("converts 30 Tgas raw gas to TGas from string", () => {
    const result = toTGas("30000000000000")
    expect(result).toBe(30)
  })

  test("converts 300 Tgas raw gas to TGas from string", () => {
    const result = toTGas("300000000000000")
    expect(result).toBe(300)
  })

  test("converts raw gas to TGas from bigint", () => {
    const result = toTGas(30000000000000n)
    expect(result).toBe(30)
  })

  test("converts decimal raw gas to TGas from string", () => {
    const result = toTGas("30500000000000")
    expect(result).toBe(30.5)
  })

  test("converts decimal raw gas to TGas from bigint", () => {
    const result = toTGas(30500000000000n)
    expect(result).toBe(30.5)
  })

  test("toGas and toTGas round-trip with string input", () => {
    const original = 30
    const converted = toGas(original)
    const backToTGas = toTGas(converted)
    expect(backToTGas).toBe(original)
  })

  test("toGas and toTGas round-trip with bigint", () => {
    const raw = 30000000000000n
    const tgas = toTGas(raw)
    const backToRaw = toGas(tgas)
    expect(BigInt(backToRaw)).toBe(raw)
  })
})
