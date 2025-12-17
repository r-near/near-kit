/**
 * Gas utilities for NEAR transactions.
 *
 * Gas amounts should specify units explicitly:
 * - `Gas.Tgas(30)` → `"30 Tgas"`
 * - `"30 Tgas"` (string literal)
 *
 * Raw gas units (e.g. `"30000000000000"`) are also supported for advanced use cases.
 */

import { GAS_PER_TGAS } from "../core/constants.js"

// Number of decimal places for TGas (10^12)
const TGAS_DECIMALS = 12

/**
 * Gas input type - string with unit specification.
 *
 * Accepts:
 * - Literal strings: "30 Tgas", "30.5 Tgas"
 * - Raw gas strings: "30000000000000"
 * - Constructor output: Gas.Tgas(30)
 *
 * For variables, use 'as const' to preserve literal type:
 * @example
 * const gas = "30 Tgas" as const
 */
export type GasInput =
  | `${number} Tgas`
  | `${number}.${number} Tgas`
  | `${number}`

/**
 * Gas namespace - explicit constructors.
 *
 * @example
 * Gas.Tgas(30)        // "30 Tgas"
 * Gas.Tgas(300)       // "300 Tgas"
 */
export const Gas = {
  /**
   * Create gas amount in TGas (teragas).
   * @param value - Amount in TGas.
   */
  Tgas(value: number | `${number}`): `${number} Tgas` {
    return `${value} Tgas`
  },

  /**
   * Common gas amounts.
   */
  DEFAULT: "30 Tgas" as `${number} Tgas`,
  MAX: "300 Tgas" as `${number} Tgas`,
} as const

/**
 * Internal: Parse TGas value string to raw gas units using string manipulation.
 * Avoids floating point precision errors.
 */
function parseTgasToRawGas(value: string): string {
  // Validate format: integer or decimal with digits on at least one side of the dot
  if (!/^\d+(\.\d+)?$/.test(value) && !/^\d*\.\d+$/.test(value)) {
    throw new Error(`Invalid Tgas value: ${value}`)
  }

  // Split into whole and fractional parts
  const parts = value.split(".")
  const wholePart = parts[0] || "0"
  const fracPart = (parts[1] || "")
    .padEnd(TGAS_DECIMALS, "0")
    .substring(0, TGAS_DECIMALS)

  // Convert to raw gas units
  const rawGas = BigInt(wholePart) * GAS_PER_TGAS + BigInt(fracPart)

  return rawGas.toString()
}

/**
 * Parse gas string to raw gas units.
 *
 * @param gas - Gas with unit (e.g., `"30 Tgas"`) or raw gas number.
 * @returns Gas in raw units as a string.
 */
export function parseGas(gas: GasInput | number): string {
  const gasStr = typeof gas === "number" ? gas.toString() : gas
  const trimmed = gasStr.trim()

  // Parse "X Tgas" format (case insensitive)
  const tgasMatch = trimmed.match(/^([\d.]+)\s+Tgas$/i)
  if (tgasMatch) {
    // Safe to use non-null assertion after match check
    // biome-ignore lint/style/noNonNullAssertion: regex capture group guaranteed to exist when match succeeds
    return parseTgasToRawGas(tgasMatch[1]!)
  }

  // Raw number (no unit) - assume it's already in gas units
  // This allows power users to specify exact gas amounts
  if (/^\d+$/.test(trimmed)) {
    return trimmed
  }

  // Invalid format
  throw new Error(
    `Invalid gas format: "${gas}"\n` +
      `Expected: "30 Tgas" or Gas.Tgas(30)\n` +
      `Or provide raw gas units as a number string`,
  )
}

/**
 * Format gas to TGas using string-based BigInt division.
 *
 * @param gas - Gas in raw units.
 * @param precision - Decimal places (default: 2).
 * @returns Formatted gas with `' Tgas'` suffix.
 */
export function formatGas(gas: string | bigint, precision = 2): string {
  const amount = typeof gas === "string" ? BigInt(gas) : gas

  const wholePart = amount / GAS_PER_TGAS
  const fracPart = amount % GAS_PER_TGAS

  let result: string

  if (fracPart === BigInt(0)) {
    if (precision === 0) {
      result = wholePart.toString()
    } else {
      result = `${wholePart}.${"0".repeat(precision)}`
    }
  } else {
    const fracStr = fracPart.toString().padStart(TGAS_DECIMALS, "0")
    const decimals = fracStr.substring(0, precision)

    if (precision === 0) {
      // Round to nearest integer based on first decimal digit
      // fracStr always has TGAS_DECIMALS characters from padStart
      // biome-ignore lint/style/noNonNullAssertion: fracStr always has 12 chars from padStart
      const firstDecimalDigit = Number.parseInt(fracStr[0]!, 10)
      if (firstDecimalDigit >= 5) {
        result = (wholePart + BigInt(1)).toString()
      } else {
        result = wholePart.toString()
      }
    } else {
      result = `${wholePart}.${decimals}`
    }
  }

  return `${result} Tgas`
}

/**
 * Convert TGas to raw gas units using string manipulation.
 * Avoids floating point precision errors.
 *
 * @param tgas - Amount in TGas.
 * @returns Gas amount as string.
 */
export function toGas(tgas: number): string {
  // Convert number to string and use string manipulation
  return parseTgasToRawGas(tgas.toString())
}

/**
 * Convert raw gas to TGas.
 * Uses string-based BigInt division to avoid floating point division errors.
 *
 * Note: The final conversion to number may lose precision either when the result
 * exceeds Number.MAX_SAFE_INTEGER (~9007 TGas) or when it has more than
 * approximately 15–17 significant digits (for example, many fractional digits),
 * even if the whole part is within the safe integer range. For typical NEAR gas
 * limits (300 TGas max) without excessive decimal precision, this is not a concern.
 * For applications requiring arbitrary precision, use formatGas(), which returns
 * a formatted string.
 *
 * @param gas - Gas amount in raw units.
 * @returns Amount in TGas as a number.
 */
export function toTGas(gas: string | bigint): number {
  const amount = typeof gas === "string" ? BigInt(gas) : gas

  const wholePart = amount / GAS_PER_TGAS
  const fracPart = amount % GAS_PER_TGAS

  if (fracPart === BigInt(0)) {
    return Number(wholePart)
  }

  // Build decimal string to avoid floating point division
  const fracStr = fracPart.toString().padStart(TGAS_DECIMALS, "0")
  const decimalStr = `${wholePart}.${fracStr}`

  return Number.parseFloat(decimalStr)
}
