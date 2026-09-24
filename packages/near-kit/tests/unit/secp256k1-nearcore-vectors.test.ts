/**
 * Cross-implementation secp256k1 vectors generated with crates.io
 * near-crypto 0.37.4 (`SecretKey::sign` / `Signature::verify`).
 *
 * nearcore signs and verifies secp256k1 over the 32-byte data directly
 * (`secp256k1::Message::from_slice(data)`) and serializes signatures as
 * `[r (32)][s (32)][v (1)]`. Both ECDSA and RFC 6979 are deterministic, so
 * near-kit must reproduce these signatures byte for byte.
 */

import { secp256k1 } from "@noble/curves/secp256k1.js"
import { sha256 } from "@noble/hashes/sha2.js"
import { base58, base64, hex } from "@scure/base"
import { describe, expect, test } from "vitest"
import { InvalidKeyError } from "../../src/errors/index.js"
import { parseKey, Secp256k1KeyPair } from "../../src/utils/key.js"
import { serializeNep413Message } from "../../src/utils/nep413.js"

// Private key bytes 0x01..0x20, as a 32-byte near-crypto secret key string.
const SECRET_KEY = "secp256k1:4wBqpZM9xaSheZzJSMawUKKwhdpChKbZ5eu5ky4Vigw"
const PUBLIC_KEY =
  "secp256k1:3ewF4NQgt5bPC4poahSay91pL76oniREy2B81BQuYVWbvuGLAFvttB6XioKNyczqKykPyXBuQ5Md2uGU2dJBXPL3"

const VECTORS = [
  {
    // sha256("near-kit secp256k1 vector 1")
    hash: "8c42946cd10384191132f735807d86a229b137493ac5b82b0641625ffb7edd6c",
    signature:
      "314d9d8c3032b127a93ec039737f8717e30f45ec85dda1b0c43e2577cb53e97557195a837a371dca2c22ff55cb7f70419a21a2d142919f0cef146a92fe8fdf3801",
    // What near-crypto produces when it signs sha256(hash) instead of hash.
    signatureOverRehash:
      "7b46a76ef70a32bbf50264b69a4dbc2ee72c372bcd695795670b0145af838ca53ea5de7e141272fd63177ac33a9ba3b6a5bed287e12891d77dcf7e6400098d7500",
  },
  {
    // sha256("near-kit secp256k1 vector 2")
    hash: "94103c4e058b5f191ba09eb0bce3771539cbd7a74b6edbf70f76e0cc4c487e8e",
    signature:
      "384ecd6d795036f5d04bf5105fc6ab601362254f1d2831264edee5afc3f7d4b4098c9d1a804077d98b1f1b69a8f65d8d79633147e5e677a9d9947b60604b0f9b01",
    signatureOverRehash:
      "0469bb6b3ce482c769a2aa9ec88fa6db3f4253d7a11fe1b77f09fc74c8d350fb47e166d027b3abb6feef24f4c3bce3c4baf63a1e889ed377bad04522990b232e01",
  },
]

const FIRST = VECTORS[0] as (typeof VECTORS)[number]

/** Verify the way nearcore's `Signature::verify` does for secp256k1. */
function nearcoreVerify(
  data: Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array,
): boolean {
  if (data.length !== 32 || signature.length !== 65) return false
  if ((signature[64] as number) > 3) return false
  const uncompressed = new Uint8Array(65)
  uncompressed[0] = 4
  uncompressed.set(publicKey, 1)
  return secp256k1.verify(signature.subarray(0, 64), data, uncompressed, {
    prehash: false,
    lowS: true,
  })
}

describe("secp256k1 signing matches nearcore (near-crypto vectors)", () => {
  const keyPair = parseKey(SECRET_KEY)

  test("32-byte near-crypto secret key derives the same public key", () => {
    expect(keyPair).toBeInstanceOf(Secp256k1KeyPair)
    expect(keyPair.publicKey.toString()).toBe(PUBLIC_KEY)
  })

  test("96-byte [private][public] secret key is equivalent", () => {
    const priv = base58.decode(SECRET_KEY.slice("secp256k1:".length))
    const full = new Uint8Array(96)
    full.set(priv, 0)
    full.set(keyPair.publicKey.data, 32)
    const kp96 = parseKey(`secp256k1:${base58.encode(full)}`)
    expect(kp96.publicKey.toString()).toBe(PUBLIC_KEY)
    const digest = hex.decode(FIRST.hash)
    expect(hex.encode(kp96.sign(digest).data)).toBe(FIRST.signature)
  })

  test("rejects a 96-byte secret key whose public half does not match", () => {
    const full = new Uint8Array(96)
    full.set(base58.decode(SECRET_KEY.slice("secp256k1:".length)), 0)
    full.fill(7, 32)
    expect(() => parseKey(`secp256k1:${base58.encode(full)}`)).toThrow(
      InvalidKeyError,
    )
  })

  for (const [i, v] of VECTORS.entries()) {
    test(`vector ${i + 1}: sign(hash) is byte-identical to near-crypto`, () => {
      const sig = keyPair.sign(hex.decode(v.hash))
      expect(hex.encode(sig.data)).toBe(v.signature)
    })

    test(`vector ${i + 1}: signature verifies over the hash itself`, () => {
      const digest = hex.decode(v.hash)
      const sig = keyPair.sign(digest).data
      expect(nearcoreVerify(digest, sig, keyPair.publicKey.data)).toBe(true)
    })

    test(`vector ${i + 1}: a signature over sha256(hash) does not verify`, () => {
      const digest = hex.decode(v.hash)
      const rehashed = hex.decode(v.signatureOverRehash)
      expect(nearcoreVerify(digest, rehashed, keyPair.publicKey.data)).toBe(
        false,
      )
      expect(hex.encode(keyPair.sign(digest).data)).not.toBe(
        v.signatureOverRehash,
      )
      // The old [v][r][s] layout of the double-hashed signature must not
      // come back either.
      const legacy = new Uint8Array(65)
      legacy[0] = rehashed[64] as number
      legacy.set(rehashed.subarray(0, 64), 1)
      expect(keyPair.sign(digest).data).not.toEqual(legacy)
    })
  }

  test("recovery byte is last and recovers the signer's key", () => {
    const digest = sha256(new TextEncoder().encode("recovery"))
    const sig = keyPair.sign(digest).data
    expect(sig[64]).toBeLessThanOrEqual(3)
    const recovered = secp256k1.recoverPublicKey(
      Uint8Array.of(sig[64] as number, ...sig.subarray(0, 64)),
      digest,
      { prehash: false },
    )
    const uncompressed = secp256k1.Point.fromBytes(recovered).toBytes(false)
    expect(uncompressed.subarray(1)).toEqual(keyPair.publicKey.data)
  })

  test("NEP-413 signs the NEP-413 hash directly", () => {
    const params = {
      message: "Login to MyApp",
      recipient: "myapp.near",
      nonce: new Uint8Array(32).fill(1),
    }
    const signed = keyPair.signNep413Message("alice.near", params)
    const sig = base64.decode(signed.signature)
    const hash = serializeNep413Message(params)
    expect(sig).toEqual(keyPair.sign(hash).data)
    expect(nearcoreVerify(hash, sig, keyPair.publicKey.data)).toBe(true)
  })
})
