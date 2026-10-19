import { keccak_256 } from "@noble/hashes/sha3.js"
import { encodeStateInit, type StateInit } from "./internal/state-init.js"

export type { StateInit } from "./internal/state-init.js"

/**
 * Calculates the network-independent NEP-616 V1 address from public storage
 * bytes. It does not establish existence, present state/code or ownership.
 * Inputs must stay stable during this synchronous call. Shared backing is
 * rejected; the caller's arrays and bytes are never changed.
 */
export function deterministicAccountId(input: StateInit): string {
  const digest = keccak_256(encodeStateInit(input))
  let suffix = ""
  for (const byte of digest.subarray(12))
    suffix += byte.toString(16).padStart(2, "0")
  return `0s${suffix}`
}
