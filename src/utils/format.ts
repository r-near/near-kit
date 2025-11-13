/**
 * Unit conversion utilities for NEAR tokens and gas
 */

import { GAS_PER_TGAS, YOCTO_PER_NEAR } from "../core/constants.js"

/**
 * Parse a human-readable NEAR amount to yoctoNEAR
 * @param amount - Amount in NEAR (e.g., "10", "10 NEAR", 10)
 * @returns Amount in yoctoNEAR as string
 */
export function parseNearAmount(amount: string | number): string {
  const amountStr = typeof amount === "number" ? amount.toString() : amount

  // Remove ' NEAR' suffix if present
  const cleaned = amountStr.replace(/\s*NEAR\s*$/i, "").trim()

  // Parse as decimal
  const parts = cleaned.split(".")
  const wholePart = parts[0] || "0"
  const fracPart = (parts[1] || "").padEnd(24, "0").substring(0, 24)

  // Convert to yoctoNEAR
  const yocto = BigInt(wholePart) * YOCTO_PER_NEAR + BigInt(fracPart)

  return yocto.toString()
}

/**
 * Format yoctoNEAR amount to human-readable NEAR
 * @param yocto - Amount in yoctoNEAR
 * @param precision - Number of decimal places (default: 2)
 * @returns Formatted amount with ' NEAR' suffix
 */
export function formatNearAmount(
  yocto: string | bigint,
  precision = 2,
): string {
  const amount = typeof yocto === "string" ? BigInt(yocto) : yocto

  // Convert to NEAR
  const wholePart = amount / YOCTO_PER_NEAR
  const fracPart = amount % YOCTO_PER_NEAR

  if (fracPart === BigInt(0)) {
    return `${wholePart} NEAR`
  }

  // Format fractional part
  const fracStr = fracPart.toString().padStart(24, "0")
  const trimmed = fracStr.substring(0, precision)

  return `${wholePart}.${trimmed} NEAR`
}

/**
 * Parse gas amount to raw gas units
 * @param gas - Gas amount (e.g., "30 Tgas", "30000000000000", 30)
 * @returns Gas amount as string
 */
export function parseGas(gas: string | number): string {
  const gasStr = typeof gas === "number" ? gas.toString() : gas

  // Check if it's in TGas format
  const tgasMatch = gasStr.match(/^(\d+(?:\.\d+)?)\s*T[Gg]as$/)
  if (tgasMatch) {
    const tgas = parseFloat(tgasMatch[1]!)
    return (BigInt(Math.floor(tgas * 1e12)) * BigInt(1)).toString()
  }

  // Otherwise, treat as raw gas
  return BigInt(gasStr).toString()
}

/**
 * Format gas amount to TGas
 * @param gas - Gas amount in raw units
 * @returns Formatted gas with ' Tgas' suffix
 */
export function formatGas(gas: string | bigint): string {
  const amount = typeof gas === "string" ? BigInt(gas) : gas
  const tgas = Number(amount) / Number(GAS_PER_TGAS)

  return `${tgas.toFixed(2)} Tgas`
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
