/**
 * SLIP-0010 hardened-only hierarchical key derivation.
 *
 * Implements the HMAC-SHA512 derivation chain from
 * {@link https://github.com/satoshilabs/slips/blob/master/slip-0010.md | SLIP-0010}
 * for curves without public-key derivation: every path segment must be
 * hardened, and the derived 32-byte node secret is used directly as key
 * material (an ed25519 private key, or an ML-DSA-65 FIPS 204 seed ξ).
 *
 * The ML-DSA-65 variant uses the `"ML-DSA-65 seed"` master salt from
 * {@link https://github.com/satoshilabs/slips/pull/1968 | satoshilabs/slips#1968},
 * the same construction adopted by Quantus (QIP-0002) and proven secure in the
 * Lattice HD Wallets paper (https://eprint.iacr.org/2026/380).
 */

import { hmac } from "@noble/hashes/hmac.js"
import { sha512 } from "@noble/hashes/sha2.js"
import { InvalidKeyError } from "../errors/index.js"

/** SLIP-0010 master-node HMAC key for the ed25519 curve. */
export const ED25519_CURVE_SALT = "ed25519 seed"
/** Master-node HMAC key for ML-DSA-65, per satoshilabs/slips#1968. */
export const ML_DSA_65_CURVE_SALT = "ML-DSA-65 seed"

const HARDENED_OFFSET = 0x80000000

/** A SLIP-0010 node: 32-byte secret (I_L) and 32-byte chain code (I_R). */
export interface Slip10Node {
  key: Uint8Array
  chainCode: Uint8Array
}

/**
 * SLIP-0010 master node: `I = HMAC-SHA512(key = salt, data = seed)`.
 * @internal
 */
function masterNodeFromSeed(salt: string, seed: Uint8Array): Slip10Node {
  const I = hmac(sha512, new TextEncoder().encode(salt), seed)
  return {
    key: I.slice(0, 32),
    chainCode: I.slice(32),
  }
}

/**
 * SLIP-0010 hardened child step:
 * `I = HMAC-SHA512(key = c_par, data = 0x00 || k_par || ser32(index))`.
 * @internal
 */
function deriveChild(parent: Slip10Node, index: number): Slip10Node {
  const data = new Uint8Array(37)
  data[0] = 0
  data.set(parent.key, 1)
  const view = new DataView(data.buffer)
  view.setUint32(33, index, false) // big-endian

  const I = hmac(sha512, parent.chainCode, data)
  return {
    key: I.slice(0, 32),
    chainCode: I.slice(32),
  }
}

/**
 * Derive a SLIP-0010 node from a BIP-39 seed along a hardened BIP-32 path.
 *
 * @param salt - Master-node HMAC key selecting the scheme
 * ({@link ED25519_CURVE_SALT} or {@link ML_DSA_65_CURVE_SALT}).
 * @param seed - BIP-39 seed (typically 64 bytes from `mnemonicToSeedSync`).
 * @param path - Path like `"m/44'/397'/0'"`. Every segment must be hardened
 * (`'` suffix); `"m"` alone derives the master node.
 * @returns The derived node; `key` is the 32-byte secret (ed25519 private key
 * or ML-DSA-65 seed ξ).
 */
export function slip10DerivePath(
  salt: string,
  seed: Uint8Array,
  path: string,
): Slip10Node {
  if (!/^m(\/\d+')*$/.test(path)) {
    throw new InvalidKeyError(
      `Invalid derivation path: ${path}. Must be hardened (e.g., m/44'/397'/0')`,
    )
  }

  let node = masterNodeFromSeed(salt, seed)

  const segments = path
    .split("/")
    .slice(1) // Remove 'm'
    .map((s) => Number.parseInt(s.replace("'", ""), 10))

  for (const segment of segments) {
    if (segment >= HARDENED_OFFSET) {
      throw new InvalidKeyError(
        `Invalid derivation path: ${path}. Index ${segment} out of range`,
      )
    }
    node = deriveChild(node, segment + HARDENED_OFFSET)
  }

  return node
}
