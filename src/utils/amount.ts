/**
 * Amount utilities for NEAR tokens.
 *
 * All amounts must specify units explicitly:
 * - `Amount.NEAR(10)` → `"10 NEAR"`
 * - `Amount.yocto(1000n)` → `"1000 yocto"`
 * - `"10 NEAR"` (string literal)
 * - `"1000 yocto"` (string literal)
 * - `1000n` (bigint literal, treated as yoctoNEAR)
 *
 * No bare numbers are accepted in order to prevent accidental unit confusion.
 */

import { YOCTO_PER_NEAR } from "../core/constants.js"

/**
 * String amount in NEAR units.
 *
 * Examples:
 * - "10 NEAR"
 * - "1.5 NEAR"
 */
export type NearAmountString = `${number} NEAR`

/**
 * String amount in yoctoNEAR units.
 *
 * Examples:
 * - "1000000 yocto"
 * - "1 yocto"
 */
export type YoctoAmountString = `${bigint} yocto`

/**
 * Amount input type - must be a string with unit specification or bigint.
 *
 * Accepts:
 * - Literal strings: "10 NEAR", "1.5 NEAR", "1000 yocto"
 * - Constructor output: Amount.NEAR(10), Amount.yocto(1000n)
 * - Raw bigint: 1000000n (interpreted as yoctoNEAR)
 */
export type AmountInput = NearAmountString | YoctoAmountString | bigint

/**
 * Amount namespace - explicit constructors for NEAR values.
 *
 * @example
 * Amount.NEAR(10)           // "10 NEAR"
 * Amount.NEAR(10.5)         // "10.5 NEAR"
 * Amount.NEAR("10.5")       // "10.5 NEAR"
 * Amount.yocto(1000000n)    // "1000000 yocto"
 * Amount.yocto("1000000")   // "1000000 yocto"
 */
export const Amount = {
  /**
   * Create a NEAR amount.
   * @param value - Amount in NEAR.
   * @returns Formatted string `"X NEAR"`.
   */
  NEAR(value: number | `${number}`): NearAmountString {
    return `${value} NEAR`
  },

  /**
   * Create a yoctoNEAR amount (10^-24 NEAR).
   * @param value - Amount in yoctoNEAR.
   * @returns Formatted string `"X yocto"`.
   */
  yocto(value: bigint | `${bigint}`): YoctoAmountString {
    return `${value} yocto`
  },

  /**
   * Common amount constants.
   */
  ZERO: "0 yocto" as YoctoAmountString,
  ONE_NEAR: "1 NEAR" as NearAmountString,
  ONE_YOCTO: "1 yocto" as YoctoAmountString,
}

/**
 * Parse amount to yoctoNEAR.
 *
 * @param amount - Amount with unit (e.g., `"10 NEAR"`, `"1000 yocto"`) or bigint (treated as yoctoNEAR).
 * @returns Amount in yoctoNEAR as a string.
 * @throws Error If the format is invalid or ambiguous (e.g. bare numbers).
 */
export function parseAmount(amount: AmountInput): string {
  // Handle bigint directly (treated as yoctoNEAR)
  if (typeof amount === "bigint") {
    return amount.toString()
  }

  const trimmed = amount.trim()

  // Parse "X NEAR" format (case insensitive)
  const nearMatch = trimmed.match(/^([\d.]+)\s+NEAR$/i)
  if (nearMatch) {
    // Safe to use non-null assertion after match check
    // biome-ignore lint/style/noNonNullAssertion: regex capture group guaranteed to exist when match succeeds
    const value = nearMatch[1]!
    return parseNearToYocto(value)
  }

  // Parse "X yocto" format
  const yoctoMatch = trimmed.match(/^(\d+)\s+yocto$/i)
  if (yoctoMatch) {
    // Safe to use non-null assertion after match check
    // biome-ignore lint/style/noNonNullAssertion: regex capture group guaranteed to exist when match succeeds
    return yoctoMatch[1]!
  }

  // Common mistake: bare number
  if (/^[\d.]+$/.test(trimmed)) {
    throw new Error(
      `Ambiguous amount: "${amount}". Did you mean "${amount} NEAR"?\n` +
        `  - Use Amount.NEAR(${amount}) for NEAR\n` +
        `  - Use Amount.yocto(${amount}n) for yoctoNEAR\n` +
        `  - Or write "${amount} NEAR" or "${amount} yocto"\n` +
        `  - Or pass ${amount}n as bigint for yoctoNEAR\n` +
        `\n` +
        `💡 TypeScript tip: Use 'as const' for variables:\n` +
        `   const amount = "10 NEAR" as const`,
    )
  }

  // Invalid format
  throw new Error(
    `Invalid amount format: "${amount}"\n` +
      `Expected formats:\n` +
      `  - "10 NEAR" or Amount.NEAR(10)\n` +
      `  - "1000000 yocto" or Amount.yocto(1000000n)\n` +
      `  - 1000000n (bigint, treated as yoctoNEAR)`,
  )
}

/**
 * Format yoctoNEAR to human-readable NEAR
 * @param yocto - Amount in yoctoNEAR
 * @param options - Formatting options
 * @returns Formatted string (e.g., "10.50 NEAR")
 */
export function formatAmount(
  yocto: string | bigint,
  options?: {
    precision?: number
    includeSuffix?: boolean
    trimZeros?: boolean
  },
): string {
  const {
    precision = 2,
    includeSuffix = true,
    trimZeros = false,
  } = options || {}

  const amount = typeof yocto === "string" ? BigInt(yocto) : yocto

  const wholePart = amount / YOCTO_PER_NEAR
  const fracPart = amount % YOCTO_PER_NEAR

  let result: string

  if (fracPart === BigInt(0)) {
    result = wholePart.toString()
  } else {
    const fracStr = fracPart.toString().padStart(24, "0")
    let decimals = fracStr.substring(0, precision)

    if (trimZeros) {
      decimals = decimals.replace(/0+$/, "")
    }

    result = decimals ? `${wholePart}.${decimals}` : wholePart.toString()
  }

  return includeSuffix ? `${result} NEAR` : result
}

/**
 * Internal: Parse NEAR value to yoctoNEAR
 * Note: The caller (parseAmount) already validates the format with the same regex,
 * so the value is guaranteed to match [\d.]+ pattern when it reaches this function.
 */
function parseNearToYocto(value: string): string {
  // Split into whole and fractional parts
  const parts = value.split(".")
  const wholePart = parts[0] || "0"
  const fracPart = (parts[1] || "").padEnd(24, "0").substring(0, 24)

  // Check for negative values
  if (wholePart.startsWith("-")) {
    throw new Error("NEAR amount must be non-negative")
  }

  // Convert to yoctoNEAR
  const yocto = BigInt(wholePart) * YOCTO_PER_NEAR + BigInt(fracPart)

  return yocto.toString()
}
