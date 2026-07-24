/**
 * SLIP-0010 derivation test vectors.
 *
 * Ed25519 vectors are the official ones from
 * https://github.com/satoshilabs/slips/blob/master/slip-0010.md.
 * ML-DSA-65 vectors come from https://github.com/satoshilabs/slips/pull/1968,
 * whose key generation is validated against the NIST ACVP
 * ML-DSA-keyGen-FIPS204 known-answer tests. The vectors' 1952-byte public
 * keys are inlined as their SHA-256 digests to keep the table readable; the
 * chain codes are verbatim from the proposal.
 */

import { sha256 } from "@noble/hashes/sha2.js"
import { hexToBytes } from "@noble/hashes/utils.js"
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js"
import { describe, expect, test } from "vitest"
import { InvalidKeyError } from "../../src/errors/index.js"
import {
  ED25519_CURVE_SALT,
  ML_DSA_65_CURVE_SALT,
  slip10DerivePath,
} from "../../src/utils/hd.js"

function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex")
}

const SEED_1 = "000102030405060708090a0b0c0d0e0f"
const SEED_2 =
  "fffcf9f6f3f0edeae7e4e1dedbd8d5d2cfccc9c6c3c0bdbab7b4b1aeaba8a5a2" +
  "9f9c999693908d8a8784817e7b7875726f6c696663605d5a5754514e4b484542"

describe("SLIP-0010 ed25519 official vectors", () => {
  // [path, private key (I_L)]
  const vector1: Array<[string, string]> = [
    ["m", "2b4be7f19ee27bbf30c667b642d5f4aa69fd169872f8fc3059c08ebae2eb19e7"],
    [
      "m/0'",
      "68e0fe46dfb67e368c75379acec591dad19df3cde26e63b93a8e704f1dade7a3",
    ],
    [
      "m/0'/1'",
      "b1d0bad404bf35da785a64ca1ac54b2617211d2777696fbffaf208f746ae84f2",
    ],
    [
      "m/0'/1'/2'",
      "92a5b23c0b8a99e37d07df3fb9966917f5d06e02ddbd909c7e184371463e9fc9",
    ],
    [
      "m/0'/1'/2'/2'",
      "30d1dc7e5fc04c31219ab25a27ae00b50f6fd66622f6e9c913253d6511d1e662",
    ],
    [
      "m/0'/1'/2'/2'/1000000000'",
      "8f94d394a8e8fd6b1bc2f3f49f5c47e385281d5c17e65324b0f62483e37e8793",
    ],
  ]

  test.each(vector1)("vector 1 chain %s", (path, privateKey) => {
    const node = slip10DerivePath(ED25519_CURVE_SALT, hexToBytes(SEED_1), path)
    expect(toHex(node.key)).toBe(privateKey)
  })

  const vector2: Array<[string, string]> = [
    ["m", "171cb88b1b3c1db25add599712e36245d75bc65a1a5c9e18d76f9f2b1eab4012"],
    [
      "m/0'",
      "1559eb2bbec5790b0c65d8693e4d0875b1747f4970ae8b650486ed7470845635",
    ],
    [
      "m/0'/2147483647'/1'/2147483646'/2'",
      "551d333177df541ad876a60ea71f00447931c0a9da16f227c11ea080d7391b8d",
    ],
  ]

  test.each(vector2)("vector 2 chain %s", (path, privateKey) => {
    const node = slip10DerivePath(ED25519_CURVE_SALT, hexToBytes(SEED_2), path)
    expect(toHex(node.key)).toBe(privateKey)
  })
})

describe("SLIP-0010 ML-DSA-65 vectors (satoshilabs/slips#1968)", () => {
  // [path, chain code, sha256 of the vector's ML-DSA-65 public key]
  const vector1: Array<[string, string, string]> = [
    [
      "m",
      "7e74b6275f92cc4fb2cbdac0c63cb5e7ac2bce1ded2b7dbc7bf2232f772578d5",
      "f41b8366cd9b720dbab9dfcefde673e4c19798192d7543f30f277e57e77ba457",
    ],
    [
      "m/0'",
      "d8b27c87ec212d6501629199262a9d0d66ec26deab313c26a474bc4ddd5dce7c",
      "1d9d7fce0a1560acef9b117f3e3022cb0bdd46f30a3134db33165baf66b53e7e",
    ],
    [
      "m/0'/1'",
      "60219beef857bd0bc7870424c4f60464decb097a18ae37b035df22ebaa7515b9",
      "0fdc416cbe544a493b59ae8112a907d5acf09ed4583eb8e12d6c769bcf394943",
    ],
    [
      "m/0'/1'/2'",
      "dc7b0e1379b3f1acd02d1e25f13d8bb16830ca68c73b00d900b9030a41d6a658",
      "6db4146987c59099709622700d66bcb07b8d49e1007ea6570e15fc3f6dac1c53",
    ],
    [
      "m/0'/1'/2'/2'",
      "565cb34027c3b54773f7f48e329bc86db7ffc6f618b112af6d59a3f82501e17a",
      "d487dcf16e74ddd731fafe780d0e5e8b8d338d4f7a3b7e209f8b4c519419764d",
    ],
    [
      "m/0'/1'/2'/2'/1000000000'",
      "dc65d6cf4fa993c2f04fae2b41d70d8c5ba4c9d2042ea5720bf42a2315a6b7db",
      "9591ff122a7eff9cd64100f2123e678db9c257815ec5570b0b6acd8847e62f24",
    ],
  ]

  const vector2: Array<[string, string, string]> = [
    [
      "m",
      "0e696f43f0e71c1c9febf61f43f10903385b78cee5871915472027b25ba755cc",
      "36233a01384e7081becf4da903d10fe7d357da9061cbed1983819fe0a0ced509",
    ],
    [
      "m/0'",
      "d977be3c8525364e155764ef76b985126d8f6be41b55e6e50a9915ae29f27a56",
      "577dc77b0987d6cc587a88605590b183f3a7580577dab08cac1ede0a9636b882",
    ],
    [
      "m/0'/2147483647'",
      "45406bac7fc36390d89ac938bff6ca1ebf9fc6da2057d1580b26a8f2e25a0d2f",
      "a0155112060496906db18bd46cdd7e18dd35e6e14621083300a0027fd6a421a2",
    ],
    [
      "m/0'/2147483647'/1'",
      "10ffddec3c4acf719afe528b1ced03e0f7d8555999c11b69376bd5ff4e04dbea",
      "41357d47d1269fe94f9fc66396d7dc768e5bcaae700a0b877471a06ef2e12d27",
    ],
    [
      "m/0'/2147483647'/1'/2147483646'",
      "3580d842e9d8d6a072b77d95e08b0a87648edfaec9bc25cee6c9127d1aa4a679",
      "e947963f404e03be513bdccf23c5a3cb9bd4455f306276fcd9acd4b0d3e16e75",
    ],
    [
      "m/0'/2147483647'/1'/2147483646'/2'",
      "55a202d3f7803dd79e31c454e65eb7da49dee824b467bfed5204df980e71571d",
      "4b6c9f1dd1a811fe704c1355e32c43b63007317868ed6c3fce385f11c1b5da39",
    ],
  ]

  function check(seedHex: string, path: string, cc: string, pkHash: string) {
    const node = slip10DerivePath(
      ML_DSA_65_CURVE_SALT,
      hexToBytes(seedHex),
      path,
    )
    expect(toHex(node.chainCode)).toBe(cc)

    // The derived 32-byte node secret is the FIPS 204 seed ξ; expanding it
    // must reproduce the vector's public key.
    const { publicKey } = ml_dsa65.keygen(node.key)
    expect(toHex(sha256(publicKey))).toBe(pkHash)
  }

  test.each(vector1)("vector 1 chain %s", (path, cc, pkHash) => {
    check(SEED_1, path, cc, pkHash)
  })

  test.each(vector2)("vector 2 chain %s", (path, cc, pkHash) => {
    check(SEED_2, path, cc, pkHash)
  })

  test("ed25519 and ML-DSA-65 salts derive unrelated keys from the same seed", () => {
    const seed = hexToBytes(SEED_1)
    const path = "m/44'/397'/0'"
    const ed = slip10DerivePath(ED25519_CURVE_SALT, seed, path)
    const pq = slip10DerivePath(ML_DSA_65_CURVE_SALT, seed, path)
    expect(toHex(ed.key)).not.toBe(toHex(pq.key))
  })
})

describe("slip10DerivePath path validation", () => {
  const seed = hexToBytes(SEED_1)

  test("rejects non-hardened segments", () => {
    expect(() =>
      slip10DerivePath(ED25519_CURVE_SALT, seed, "m/44'/397'/0"),
    ).toThrow(InvalidKeyError)
  })

  test("rejects malformed paths", () => {
    for (const path of ["", "44'/397'/0'", "m//0'", "m/abc'", "m/0'/"]) {
      expect(() => slip10DerivePath(ED25519_CURVE_SALT, seed, path)).toThrow(
        InvalidKeyError,
      )
    }
  })

  test("rejects indexes at or above 2^31", () => {
    expect(() =>
      slip10DerivePath(ED25519_CURVE_SALT, seed, "m/2147483648'"),
    ).toThrow(InvalidKeyError)
  })

  test("accepts bare 'm' as the master node", () => {
    const node = slip10DerivePath(ED25519_CURVE_SALT, seed, "m")
    expect(toHex(node.key)).toBe(
      "2b4be7f19ee27bbf30c667b642d5f4aa69fd169872f8fc3059c08ebae2eb19e7",
    )
  })
})
