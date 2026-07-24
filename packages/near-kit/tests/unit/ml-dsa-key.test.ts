/**
 * Unit tests for ML-DSA-65 (FIPS 204) key handling.
 *
 * On-chain compatibility (seed -> keypair -> signature accepted by a 2.13 node)
 * is proven by tests/integration/ml-dsa.test.ts; these tests cover the local
 * surface: deterministic keygen, sign/verify, string round-trips, the
 * `ml-dsa-65-hash:` view handle, Borsh layout, and validation.
 */

import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js"
import { base58 } from "@scure/base"
import { describe, expect, test } from "vitest"
import { PublicKeySchema, SignatureSchema } from "../../src/core/schema.js"
import { KeyType } from "../../src/core/types.js"
import { InvalidKeyError } from "../../src/errors/index.js"
import {
  generateSeedPhrase,
  MlDsa65KeyPair,
  parseKey,
  parseMlDsa65Handle,
  parsePublicKey,
  parseSeedPhrase,
} from "../../src/utils/key.js"
import {
  isValidPublicKey,
  PrivateKeySchema,
  PublicKeySchema as PublicKeyStringSchema,
} from "../../src/utils/validation.js"

describe("MlDsa65KeyPair", () => {
  test("fromRandom produces a 1952-byte ML-DSA-65 public key", () => {
    const key = MlDsa65KeyPair.fromRandom()
    expect(key.publicKey.keyType).toBe(KeyType.ML_DSA_65)
    expect(key.publicKey.data.length).toBe(1952)
    expect(key.publicKey.toString()).toMatch(/^ml-dsa-65:/)
    expect(key.secretKey).toMatch(/^ml-dsa-65:/)
  })

  test("keygen is deterministic from a 32-byte seed", () => {
    const seed = new Uint8Array(32).fill(7)
    const a = new MlDsa65KeyPair(seed)
    const b = new MlDsa65KeyPair(seed)
    expect(a.publicKey.toString()).toBe(b.publicKey.toString())
    expect(a.secretKey).toBe(b.secretKey)
  })

  test("rejects key material that is neither a 32-byte seed nor a 4032-byte secret key", () => {
    expect(() => new MlDsa65KeyPair(new Uint8Array(31))).toThrow(
      InvalidKeyError,
    )
    expect(() => new MlDsa65KeyPair(new Uint8Array(33))).toThrow(
      InvalidKeyError,
    )
    // A 1952-byte public key is not valid private-key material.
    expect(() => new MlDsa65KeyPair(new Uint8Array(1952))).toThrow(
      InvalidKeyError,
    )
    expect(() => new MlDsa65KeyPair(new Uint8Array(4031))).toThrow(
      InvalidKeyError,
    )
  })

  test("accepts a 4032-byte raw expanded secret key and derives the matching public key", () => {
    const seed = new Uint8Array(32).fill(11)
    const seedPair = new MlDsa65KeyPair(seed)

    // The raw expanded secret key nearcore / near-cli credentials carry.
    const rawSecretKey = ml_dsa65.keygen(seed).secretKey
    expect(rawSecretKey.length).toBe(4032)

    const rawPair = new MlDsa65KeyPair(rawSecretKey)
    // Same key material -> identical public key as the seed-derived pair.
    expect(rawPair.publicKey.toString()).toBe(seedPair.publicKey.toString())
    expect(Array.from(rawPair.publicKey.data)).toEqual(
      Array.from(seedPair.publicKey.data),
    )

    // A signature from the raw-key pair verifies under that public key.
    const msg = new Uint8Array(32).fill(1)
    const sig = rawPair.sign(msg)
    expect(ml_dsa65.verify(sig.data, msg, rawPair.publicKey.data)).toBe(true)
  })

  test("fromString round-trips a raw 4032-byte secret key", () => {
    const rawSecretKey = ml_dsa65.keygen(new Uint8Array(32).fill(13)).secretKey
    const original = new MlDsa65KeyPair(rawSecretKey)
    // Serialized form carries the raw key, not a seed.
    expect(
      base58.decode(original.secretKey.replace("ml-dsa-65:", "")).length,
    ).toBe(4032)

    const restored = MlDsa65KeyPair.fromString(original.secretKey)
    expect(restored.publicKey.toString()).toBe(original.publicKey.toString())
    expect(restored.secretKey).toBe(original.secretKey)
  })

  test("signs a 32-byte message; signature is 3309 bytes and self-verifies", () => {
    const key = MlDsa65KeyPair.fromRandom()
    const msg = new Uint8Array(32).fill(1)
    const sig = key.sign(msg)
    expect(sig.keyType).toBe(KeyType.ML_DSA_65)
    expect(sig.data.length).toBe(3309)
    expect(ml_dsa65.verify(sig.data, msg, key.publicKey.data)).toBe(true)
  })

  test("signature does not verify against a different message", () => {
    const key = MlDsa65KeyPair.fromRandom()
    const sig = key.sign(new Uint8Array(32).fill(1))
    expect(
      ml_dsa65.verify(sig.data, new Uint8Array(32).fill(2), key.publicKey.data),
    ).toBe(false)
  })

  test("fromString round-trips the secret key (seed)", () => {
    const original = MlDsa65KeyPair.fromRandom()
    const restored = MlDsa65KeyPair.fromString(original.secretKey)
    expect(restored.publicKey.toString()).toBe(original.publicKey.toString())
    expect(restored.secretKey).toBe(original.secretKey)
  })

  test("fromString refuses an ml-dsa-65-hash: view handle", () => {
    const handle = `ml-dsa-65-hash:${base58.encode(new Uint8Array(32).fill(9))}`
    expect(() => MlDsa65KeyPair.fromString(handle)).toThrow(InvalidKeyError)
  })

  test("fromString throws InvalidKeyError when the ml-dsa-65: prefix is missing", () => {
    const seedB58 = base58.encode(new Uint8Array(32).fill(4))
    expect(() => MlDsa65KeyPair.fromString(`ed25519:${seedB58}`)).toThrow(
      InvalidKeyError,
    )
    expect(() => MlDsa65KeyPair.fromString(seedB58)).toThrow(InvalidKeyError)
  })

  test("fromString throws InvalidKeyError (not a raw base58 error) on invalid base58", () => {
    // '0' and 'O' are not in the base58 alphabet.
    expect(() => MlDsa65KeyPair.fromString("ml-dsa-65:0OIl")).toThrow(
      InvalidKeyError,
    )
  })
})

describe("parseKey / parsePublicKey for ML-DSA-65", () => {
  test("parseKey parses an ml-dsa-65: secret key", () => {
    const original = MlDsa65KeyPair.fromRandom()
    const parsed = parseKey(original.secretKey)
    expect(parsed.publicKey.keyType).toBe(KeyType.ML_DSA_65)
    expect(parsed.publicKey.toString()).toBe(original.publicKey.toString())
  })

  test("parseKey parses a raw 4032-byte ml-dsa-65: secret key to the same public key as its seed", () => {
    const seed = new Uint8Array(32).fill(17)
    const seedPub = new MlDsa65KeyPair(seed).publicKey.toString()

    const rawSecretKey = ml_dsa65.keygen(seed).secretKey
    const rawKeyString = `ml-dsa-65:${base58.encode(rawSecretKey)}`
    const parsed = parseKey(rawKeyString)

    expect(parsed.publicKey.keyType).toBe(KeyType.ML_DSA_65)
    expect(parsed.publicKey.toString()).toBe(seedPub)
  })

  test("parsePublicKey parses an ml-dsa-65: public key", () => {
    const original = MlDsa65KeyPair.fromRandom()
    const pk = parsePublicKey(original.publicKey.toString())
    expect(pk.keyType).toBe(KeyType.ML_DSA_65)
    expect(Array.from(pk.data)).toEqual(Array.from(original.publicKey.data))
    expect(pk.toString()).toBe(original.publicKey.toString())
  })

  test("parsePublicKey rejects a wrong-length ml-dsa-65: key", () => {
    const tooShort = `ml-dsa-65:${base58.encode(new Uint8Array(100))}`
    expect(() => parsePublicKey(tooShort)).toThrow(InvalidKeyError)
  })

  test("parsePublicKey rejects the hash handle form with a message pointing to parseMlDsa65Handle", () => {
    const handle = `ml-dsa-65-hash:${base58.encode(new Uint8Array(32).fill(9))}`
    expect(() => parsePublicKey(handle)).toThrow(InvalidKeyError)
    expect(() => parsePublicKey(handle)).toThrow(/parseMlDsa65Handle/)
  })
})

describe("parseMlDsa65Handle", () => {
  test("parses an ml-dsa-65-hash: view handle into a read-only handle", () => {
    const hash = new Uint8Array(32).fill(3)
    const str = `ml-dsa-65-hash:${base58.encode(hash)}`
    const handle = parseMlDsa65Handle(str)
    expect(handle.keyType).toBe(KeyType.ML_DSA_65)
    expect(Array.from(handle.hash)).toEqual(Array.from(hash))
    expect(handle.toString()).toBe(str)
  })

  test("rejects a non-handle string", () => {
    expect(() => parseMlDsa65Handle("ed25519:abc")).toThrow(InvalidKeyError)
  })

  test("rejects a wrong-length handle", () => {
    const bad = `ml-dsa-65-hash:${base58.encode(new Uint8Array(16))}`
    expect(() => parseMlDsa65Handle(bad)).toThrow(InvalidKeyError)
  })
})

describe("ML-DSA-65 Borsh layout", () => {
  test("public key serializes as [2][1952 bytes]", () => {
    const key = MlDsa65KeyPair.fromRandom()
    const bytes = PublicKeySchema.serialize({
      mlDsa65Key: { data: Array.from(key.publicKey.data) },
    })
    expect(bytes.length).toBe(1 + 1952)
    expect(bytes[0]).toBe(2)
    const back = PublicKeySchema.deserialize(bytes)
    expect("mlDsa65Key" in back).toBe(true)
  })

  test("signature serializes as [2][3309 bytes]", () => {
    const key = MlDsa65KeyPair.fromRandom()
    const sig = key.sign(new Uint8Array(32))
    const bytes = SignatureSchema.serialize({
      mlDsa65Signature: { data: Array.from(sig.data) },
    })
    expect(bytes.length).toBe(1 + 3309)
    expect(bytes[0]).toBe(2)
  })
})

describe("ML-DSA-65 validation schemas", () => {
  test("PublicKeySchema accepts ml-dsa-65: and ml-dsa-65-hash: forms", () => {
    const full = MlDsa65KeyPair.fromRandom().publicKey.toString()
    const handle = `ml-dsa-65-hash:${base58.encode(new Uint8Array(32).fill(5))}`
    expect(PublicKeyStringSchema.parse(full)).toBe(full)
    expect(PublicKeyStringSchema.parse(handle)).toBe(handle)
    expect(isValidPublicKey(full)).toBe(true)
    expect(isValidPublicKey(handle)).toBe(true)
  })

  test("PrivateKeySchema accepts ml-dsa-65: but not the hash form", () => {
    const sk = MlDsa65KeyPair.fromRandom().secretKey
    expect(PrivateKeySchema.parse(sk)).toBe(sk)
    const handle = `ml-dsa-65-hash:${base58.encode(new Uint8Array(32))}`
    expect(() => PrivateKeySchema.parse(handle)).toThrow()
  })
})

describe("parseSeedPhrase for ML-DSA-65", () => {
  // BIP-39 canonical test phrase; the expected value locks the slips#1968
  // derivation (HMAC-SHA512 "ML-DSA-65 seed" master + SLIP-0010 hardened
  // steps) at the default path m/44'/397'/0'.
  const TEST_PHRASE =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"

  test("derives the known FIPS 204 seed at the default path", () => {
    const key = parseSeedPhrase(TEST_PHRASE, { keyType: "ml-dsa-65" })
    expect(key.secretKey).toBe(
      "ml-dsa-65:7t9yn5gKtyA9EwqwGCHe6WeDdDhDQkRDVhASM7ZvRoum",
    )
    expect(key.publicKey.keyType).toBe(KeyType.ML_DSA_65)
    expect(key.publicKey.data.length).toBe(1952)
  })

  test("is deterministic and path-sensitive", () => {
    const phrase = generateSeedPhrase(12)
    const a = parseSeedPhrase(phrase, { keyType: "ml-dsa-65" })
    const b = parseSeedPhrase(phrase, {
      keyType: "ml-dsa-65",
      path: "m/44'/397'/0'",
    })
    const c = parseSeedPhrase(phrase, {
      keyType: "ml-dsa-65",
      path: "m/44'/397'/1'",
    })
    expect(a.publicKey.toString()).toBe(b.publicKey.toString())
    expect(a.publicKey.toString()).not.toBe(c.publicKey.toString())
  })

  test("yields a key unrelated to the ed25519 key from the same phrase", () => {
    const phrase = generateSeedPhrase(12)
    const pq = parseSeedPhrase(phrase, { keyType: "ml-dsa-65" })
    const ed = parseSeedPhrase(phrase)
    expect(pq.publicKey.keyType).toBe(KeyType.ML_DSA_65)
    expect(ed.publicKey.keyType).toBe(KeyType.ED25519)
  })

  test("derived key round-trips through parseKey and signs", () => {
    const key = parseSeedPhrase(generateSeedPhrase(12), {
      keyType: "ml-dsa-65",
    })
    const reparsed = parseKey(key.secretKey)
    expect(reparsed.publicKey.toString()).toBe(key.publicKey.toString())

    const message = new TextEncoder().encode("hello post-quantum")
    const signature = key.sign(message)
    expect(ml_dsa65.verify(signature.data, message, key.publicKey.data)).toBe(
      true,
    )
  })

  test("options object with explicit ed25519 matches the default", () => {
    const phrase = generateSeedPhrase(12)
    const viaOptions = parseSeedPhrase(phrase, { keyType: "ed25519" })
    const viaDefault = parseSeedPhrase(phrase)
    expect(viaOptions.publicKey.toString()).toBe(
      viaDefault.publicKey.toString(),
    )
  })

  test("rejects an invalid phrase and an unknown key type", () => {
    expect(() =>
      parseSeedPhrase("not a valid mnemonic", { keyType: "ml-dsa-65" }),
    ).toThrow(InvalidKeyError)
    expect(() =>
      parseSeedPhrase(TEST_PHRASE, {
        // @ts-expect-error runtime validation of unknown key types
        keyType: "sphincs+",
      }),
    ).toThrow(InvalidKeyError)
  })
})
