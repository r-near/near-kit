const U128_MAX = (1n << 128n) - 1n
const U64_MAX = (1n << 64n) - 1n
const NEAR_SCALE = 10n ** 24n
const TGAS_SCALE = 10n ** 12n

function parseDecimal(
  value: string,
  decimals: number,
  scale: bigint,
  max: bigint,
): bigint {
  if (typeof value !== "string")
    throw new TypeError("Expected a decimal string")
  // The largest valid fixed-point spelling has max's digit count plus a dot.
  // Bound input before matching or constructing any bigint.
  if (value.length > max.toString().length + 1)
    throw new RangeError("Decimal value is out of range")
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(value)
  // JavaScript's $ can precede a final newline; require the entire string.
  if (!match || match[0] !== value || match[1] === undefined)
    throw new RangeError("Invalid decimal representation")
  const whole = match[1]
  const fraction = match[2] ?? ""
  if (fraction.length > decimals)
    throw new RangeError("Decimal precision exceeds the supported range")
  const result = BigInt(whole) * scale + BigInt(fraction.padEnd(decimals, "0"))
  if (result > max) throw new RangeError("Decimal value is out of range")
  return result
}

function formatDecimal(
  value: bigint,
  decimals: number,
  scale: bigint,
  max: bigint,
): string {
  if (typeof value !== "bigint")
    throw new TypeError("Expected a bigint quantity")
  if (value < 0n || value > max)
    throw new RangeError("Quantity is out of range")
  const whole = (value / scale).toString()
  const fraction = (value % scale)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "")
  return fraction.length === 0 ? whole : `${whole}.${fraction}`
}

/** Parses NEAR into unsigned u128 yoctoNEAR, rejecting excess precision. */
export function parseNear(value: string): bigint {
  return parseDecimal(value, 24, NEAR_SCALE, U128_MAX)
}

/** Formats unsigned u128 yoctoNEAR as exact NEAR without rounding or a suffix. */
export function formatNear(value: bigint): string {
  return formatDecimal(value, 24, NEAR_SCALE, U128_MAX)
}

/** Parses Tgas into unsigned u64 gas units, rejecting excess precision. */
export function parseTgas(value: string): bigint {
  return parseDecimal(value, 12, TGAS_SCALE, U64_MAX)
}

/** Formats unsigned u64 gas units as exact Tgas without rounding or a suffix. */
export function formatTgas(value: bigint): string {
  return formatDecimal(value, 12, TGAS_SCALE, U64_MAX)
}
