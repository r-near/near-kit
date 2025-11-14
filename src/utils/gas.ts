/**
 * Gas utilities for NEAR transactions
 *
 * Gas amounts should specify units explicitly:
 * - Gas.Tgas(30) → "30 Tgas"
 * - "30 Tgas" (string literal)
 *
 * Raw gas units are also supported for advanced use cases.
 */

import { GAS_PER_TGAS } from "../core/constants.js"

/**
 * Gas input type - string with unit specification
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
  | ReturnType<typeof Gas.Tgas>

/**
 * Gas namespace - explicit constructors
 *
 * @example
 * Gas.Tgas(30)        // "30 Tgas"
 * Gas.Tgas(300)       // "300 Tgas"
 */
export const Gas = {
  /**
   * Create gas amount in TGas (teragas)
   * @param value - Amount in TGas
   */
  Tgas(value: number | string): string {
    return `${value} Tgas`
  },

  /**
   * Common gas amounts
   */
  DEFAULT: "30 Tgas",
  MAX: "300 Tgas",
} as const

/**
 * Parse gas string to raw gas units
 * @param gas - Gas with unit (e.g., "30 Tgas") or raw gas number
 * @returns Gas in raw units as string
 */
export function parseGas(gas: GasInput | number): string {
  const gasStr = typeof gas === "number" ? gas.toString() : gas
  const trimmed = gasStr.trim()

  // Parse "X Tgas" format (case insensitive)
  const tgasMatch = trimmed.match(/^([\d.]+)\s+Tgas$/i)
  if (tgasMatch) {
    // Safe to use non-null assertion after match check
    // biome-ignore lint/style/noNonNullAssertion: regex capture group guaranteed to exist when match succeeds
    const tgas = parseFloat(tgasMatch[1]!)
    if (Number.isNaN(tgas) || tgas < 0) {
      // biome-ignore lint/style/noNonNullAssertion: same capture group as above
      throw new Error(`Invalid Tgas value: ${tgasMatch[1]!}`)
    }
    return BigInt(Math.floor(tgas * 1e12)).toString()
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
 * Format gas to TGas
 * @param gas - Gas in raw units
 * @param precision - Decimal places (default: 2)
 * @returns Formatted gas with ' Tgas' suffix
 */
export function formatGas(gas: string | bigint, precision = 2): string {
  const amount = typeof gas === "string" ? BigInt(gas) : gas
  const tgas = Number(amount) / Number(GAS_PER_TGAS)
  return `${tgas.toFixed(precision)} Tgas`
}

/**
 * Convert TGas to raw gas units
 * @param tgas - Amount in TGas
 * @returns Gas amount as string
 */
export function toGas(tgas: number): string {
  return (BigInt(Math.floor(tgas * 1e12)) * BigInt(1)).toString()
}

/**
 * Convert raw gas to TGas
 * @param gas - Gas amount in raw units
 * @returns Amount in TGas
 */
export function toTGas(gas: string | bigint): number {
  const amount = typeof gas === "string" ? BigInt(gas) : gas
  return Number(amount) / Number(GAS_PER_TGAS)
}
