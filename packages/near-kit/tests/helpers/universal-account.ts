/**
 * Build a universal (`0u`) account's state init and id for tests, as
 * nearcore 2.15 does (core/primitives/src/universal_state_init.rs and
 * core/primitives-core/src/universal_account_id.rs).
 */

import { sha3_256 } from "@noble/hashes/sha3.js"

const CROCKFORD = "0123456789abcdefghjkmnpqrstvwxyz"

/**
 * Borsh of `UniversalStateInit::V1` with the code given by its global
 * contract hash, no data and no access keys.
 */
export function universalStateInit(codeHash: Uint8Array): Uint8Array {
  if (codeHash.length !== 32) throw new Error("code hash must be 32 bytes")
  return Uint8Array.from([
    0, // V1
    1, // Some(code)
    0, // GlobalContractIdentifier::CodeHash
    ...codeHash,
    0,
    0,
    0,
    0, // data: empty map
    0,
    0,
    0,
    0, // access_keys: empty set
  ])
}

/** `0u` + the SHA3-256 of the state init in 52 Crockford base32 symbols. */
export function universalAccountId(stateInit: Uint8Array): string {
  const hash = sha3_256(stateInit)
  let out = "0u"
  let acc = 0
  let bits = 0
  for (const byte of hash) {
    acc = ((acc << 8) | byte) & 0xfff
    bits += 8
    while (bits >= 5) {
      bits -= 5
      out += CROCKFORD[(acc >> bits) & 0x1f]
    }
  }
  if (bits > 0) out += CROCKFORD[(acc << (5 - bits)) & 0x1f]
  return out
}
