/**
 * Tests for key generation and parsing utilities
 */

import { describe, expect, test } from "bun:test"
import {
  Ed25519KeyPair,
  generateKey,
  generateSeedPhrase,
  parseKey,
  parseSeedPhrase,
} from "../../src/utils/key.js"
import { KeyType } from "../../src/core/types.js"

describe("Key Generation", () => {
  test("generateKey() should create valid Ed25519 key pair", () => {
    const key = generateKey()

    expect(key.publicKey.keyType).toBe(KeyType.ED25519)
    expect(key.publicKey.data.length).toBe(32)
    expect(key.secretKey).toMatch(/^ed25519:/)
  })

  test("generateKey() should create unique keys", () => {
    const key1 = generateKey()
    const key2 = generateKey()

    expect(key1.publicKey.toString()).not.toBe(key2.publicKey.toString())
    expect(key1.secretKey).not.toBe(key2.secretKey)
  })

  test("Ed25519KeyPair.fromRandom() should create valid key", () => {
    const key = Ed25519KeyPair.fromRandom()

    expect(key.publicKey.keyType).toBe(KeyType.ED25519)
    expect(key.publicKey.data.length).toBe(32)
  })
})

describe("Key Parsing", () => {
  test("parseKey() should parse Ed25519 key string", () => {
    const original = generateKey()
    const parsed = parseKey(original.secretKey)

    expect(parsed.publicKey.toString()).toBe(original.publicKey.toString())
    expect(parsed.publicKey.keyType).toBe(KeyType.ED25519)
  })

  test("parseKey() should handle round-trip conversion", () => {
    const key1 = generateKey()
    const key2 = parseKey(key1.secretKey)
    const key3 = parseKey(key2.secretKey)

    expect(key1.publicKey.toString()).toBe(key2.publicKey.toString())
    expect(key2.publicKey.toString()).toBe(key3.publicKey.toString())
  })

  test("Ed25519KeyPair.fromString() should parse key string", () => {
    const key = generateKey() as Ed25519KeyPair
    const parsed = Ed25519KeyPair.fromString(key.secretKey)

    expect(parsed.publicKey.toString()).toBe(key.publicKey.toString())
  })
})

describe("Key Signing", () => {
  test("sign() should create valid signature", () => {
    const key = generateKey()
    const message = new TextEncoder().encode("test message")

    const signature = key.sign(message)

    expect(signature.keyType).toBe(KeyType.ED25519)
    expect(signature.data.length).toBe(64)
  })

  test("sign() should produce consistent signatures for same message", () => {
    const key = generateKey()
    const message = new TextEncoder().encode("test message")

    const sig1 = key.sign(message)
    const sig2 = key.sign(message)

    expect(sig1.data).toEqual(sig2.data)
  })

  test("sign() should produce different signatures for different messages", () => {
    const key = generateKey()
    const message1 = new TextEncoder().encode("test message 1")
    const message2 = new TextEncoder().encode("test message 2")

    const sig1 = key.sign(message1)
    const sig2 = key.sign(message2)

    expect(sig1.data).not.toEqual(sig2.data)
  })
})

describe("Seed Phrase Generation", () => {
  test("generateSeedPhrase() should generate valid 12-word phrase", () => {
    const phrase = generateSeedPhrase(12)
    const words = phrase.split(" ")

    expect(words.length).toBe(12)
    expect(phrase).toMatch(/^[a-z]+(?: [a-z]+){11}$/)
  })

  test("generateSeedPhrase() should generate unique phrases", () => {
    const phrase1 = generateSeedPhrase(12)
    const phrase2 = generateSeedPhrase(12)

    expect(phrase1).not.toBe(phrase2)
  })

  test("generateSeedPhrase() should support 15-word phrase", () => {
    const phrase = generateSeedPhrase(15)
    const words = phrase.split(" ")

    expect(words.length).toBe(15)
  })

  test("generateSeedPhrase() should support 18-word phrase", () => {
    const phrase = generateSeedPhrase(18)
    const words = phrase.split(" ")

    expect(words.length).toBe(18)
  })

  test("generateSeedPhrase() should support 21-word phrase", () => {
    const phrase = generateSeedPhrase(21)
    const words = phrase.split(" ")

    expect(words.length).toBe(21)
  })

  test("generateSeedPhrase() should support 24-word phrase", () => {
    const phrase = generateSeedPhrase(24)
    const words = phrase.split(" ")

    expect(words.length).toBe(24)
  })

  test("generateSeedPhrase() should default to 12 words", () => {
    const phrase = generateSeedPhrase()
    const words = phrase.split(" ")

    expect(words.length).toBe(12)
  })
})

describe("Seed Phrase Parsing", () => {
  test("parseSeedPhrase() should derive key from phrase", () => {
    const phrase = generateSeedPhrase(12)
    const key = parseSeedPhrase(phrase)

    expect(key.publicKey.keyType).toBe(KeyType.ED25519)
    expect(key.publicKey.data.length).toBe(32)
    expect(key.secretKey).toMatch(/^ed25519:/)
  })

  test("parseSeedPhrase() should produce consistent keys from same phrase", () => {
    const phrase = generateSeedPhrase(12)
    const key1 = parseSeedPhrase(phrase)
    const key2 = parseSeedPhrase(phrase)

    expect(key1.publicKey.toString()).toBe(key2.publicKey.toString())
  })

  test("parseSeedPhrase() should use NEAR derivation path", () => {
    const phrase = generateSeedPhrase(12)
    const key1 = parseSeedPhrase(phrase, "m/44'/397'/0'")
    const key2 = parseSeedPhrase(phrase, "m/44'/397'/1'")

    // Different paths should give different keys
    expect(key1.publicKey.toString()).not.toBe(key2.publicKey.toString())
  })

  test("parseSeedPhrase() should work with default path", () => {
    const phrase = generateSeedPhrase(12)
    const keyWithPath = parseSeedPhrase(phrase, "m/44'/397'/0'")
    const keyWithoutPath = parseSeedPhrase(phrase)

    // Default path should be m/44'/397'/0'
    expect(keyWithoutPath.publicKey.toString()).toBe(
      keyWithPath.publicKey.toString(),
    )
  })

  test("parseSeedPhrase() should work with 24-word phrase", () => {
    const phrase = generateSeedPhrase(24)
    const key = parseSeedPhrase(phrase)

    expect(key.publicKey.keyType).toBe(KeyType.ED25519)
  })

  test("parseSeedPhrase() should throw on invalid phrase", () => {
    expect(() => {
      parseSeedPhrase("invalid seed phrase that is not valid")
    }).toThrow()
  })

  test("parseSeedPhrase() should throw on empty phrase", () => {
    expect(() => {
      parseSeedPhrase("")
    }).toThrow()
  })

  test("parseSeedPhrase() should throw on phrase with wrong word count", () => {
    expect(() => {
      parseSeedPhrase("word word word word word") // Only 5 words
    }).toThrow()
  })
})

describe("Key Serialization", () => {
  test("publicKey.toString() should return formatted string", () => {
    const key = generateKey()
    const publicKeyString = key.publicKey.toString()

    expect(publicKeyString).toMatch(/^ed25519:[A-Za-z0-9]+$/)
  })

  test("secretKey should be base58 encoded with prefix", () => {
    const key = generateKey()

    expect(key.secretKey).toMatch(/^ed25519:[A-Za-z0-9]+$/)
    expect(key.secretKey.length).toBeGreaterThan(50)
  })
})
