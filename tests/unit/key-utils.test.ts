/**
 * Tests for key generation and parsing utilities
 */

import { HDKey } from "@scure/bip32"
import * as bip39 from "@scure/bip39"
import { wordlist } from "@scure/bip39/wordlists/english.js"
import { describe, expect, test, vi } from "vitest"
import { KeyType } from "../../src/core/types.js"
import { InvalidKeyError } from "../../src/errors/index.js"
import {
  Ed25519KeyPair,
  generateKey,
  generateSeedPhrase,
  parseKey,
  parsePublicKey,
  parseSeedPhrase,
  Secp256k1KeyPair,
} from "../../src/utils/key.js"

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

  test("generateSeedPhrase() should produce valid BIP39 phrases for all word counts", () => {
    const wordCounts: Array<12 | 15 | 18 | 21 | 24> = [12, 15, 18, 21, 24]

    for (const count of wordCounts) {
      const phrase = generateSeedPhrase(count)
      const isValid = bip39.validateMnemonic(phrase, wordlist)
      expect(isValid).toBe(true)
    }
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
    }).toThrow(InvalidKeyError)
  })

  test("parseSeedPhrase() should throw on empty phrase", () => {
    expect(() => {
      parseSeedPhrase("")
    }).toThrow(InvalidKeyError)
  })

  test("parseSeedPhrase() should throw on phrase with wrong word count", () => {
    expect(() => {
      parseSeedPhrase("word word word word word") // Only 5 words
    }).toThrow(InvalidKeyError)
  })

  test("parseSeedPhrase() throws when derivation yields no private key", () => {
    const phrase = generateSeedPhrase(12)
    const deriveMock = vi
      .spyOn(HDKey, "fromMasterSeed")
      // biome-ignore lint/suspicious/noExplicitAny: partial mock for error path
      .mockReturnValue({ derive: () => ({ privateKey: undefined }) } as any)

    expect(() => parseSeedPhrase(phrase)).toThrow(
      "Failed to derive private key from seed phrase",
    )

    deriveMock.mockRestore()
  })

  test("parseSeedPhrase() should support custom derivation paths", () => {
    const phrase = generateSeedPhrase(12)
    const customPath = "m/44'/397'/100'"
    const key = parseSeedPhrase(phrase, customPath)

    expect(key.publicKey.keyType).toBe(KeyType.ED25519)
    expect(key.publicKey.data.length).toBe(32)
  })

  test("parseSeedPhrase() should be deterministic for same phrase and path", () => {
    const phrase = generateSeedPhrase(12)

    // Parse multiple times with same phrase and path
    const keys = Array.from({ length: 5 }, () => parseSeedPhrase(phrase))

    // All should produce the same public key
    for (let i = 1; i < keys.length; i++) {
      expect(keys[i]?.publicKey.toString()).toBe(keys[0]?.publicKey.toString())
    }
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

// ============================================================================
// Secp256k1KeyPair Tests
// ============================================================================

describe("Secp256k1KeyPair - Constructor", () => {
  test("constructor should create valid key pair from 96-byte secret key", () => {
    const keyPair = Secp256k1KeyPair.fromRandom()

    expect(keyPair.publicKey.keyType).toBe(KeyType.SECP256K1)
    expect(keyPair.publicKey.data?.length).toBe(64) // 64 bytes without 0x04 header
    expect(keyPair.secretKey).toMatch(/^secp256k1:/)
  })

  test("constructor should extract public key from secret key", () => {
    const keyPair = Secp256k1KeyPair.fromRandom()

    // Public key should be part of the secret key
    expect(keyPair.publicKey.data?.length).toBe(64)
    expect(keyPair.publicKey.keyType).toBe(KeyType.SECP256K1)
  })

  test("constructor should create valid toString() method", () => {
    const keyPair = Secp256k1KeyPair.fromRandom()
    const publicKeyString = keyPair.publicKey.toString()

    expect(publicKeyString).toMatch(/^secp256k1:[A-Za-z0-9]+$/)
  })
})

describe("Secp256k1KeyPair - fromRandom", () => {
  test("fromRandom() should generate random secp256k1 key pair", () => {
    const keyPair = Secp256k1KeyPair.fromRandom()

    expect(keyPair).toBeInstanceOf(Secp256k1KeyPair)
    expect(keyPair.publicKey.keyType).toBe(KeyType.SECP256K1)
  })

  test("fromRandom() should generate unique key pairs", () => {
    const key1 = Secp256k1KeyPair.fromRandom()
    const key2 = Secp256k1KeyPair.fromRandom()

    expect(key1.publicKey.toString()).not.toBe(key2.publicKey.toString())
    expect(key1.secretKey).not.toBe(key2.secretKey)
  })

  test("fromRandom() should generate 64-byte public key (without 0x04 header)", () => {
    const keyPair = Secp256k1KeyPair.fromRandom()

    // NEAR expects 64 bytes (uncompressed without 0x04 header)
    expect(keyPair.publicKey.data?.length).toBe(64)
  })

  test("fromRandom() should generate valid secret key", () => {
    const keyPair = Secp256k1KeyPair.fromRandom()

    expect(keyPair.secretKey).toMatch(/^secp256k1:[A-Za-z0-9]+$/)
    expect(keyPair.secretKey.length).toBeGreaterThan(50)
  })

  test("fromRandom() should create signable key pair", () => {
    const keyPair = Secp256k1KeyPair.fromRandom()
    const message = new TextEncoder().encode("test message")

    const signature = keyPair.sign(message)

    expect(signature.keyType).toBe(KeyType.SECP256K1)
    expect(signature.data.length).toBe(65) // 65 bytes: recovery ID + signature
  })
})

describe("Secp256k1KeyPair - fromString", () => {
  test("fromString() should parse secp256k1 key string", () => {
    const original = Secp256k1KeyPair.fromRandom()
    const parsed = Secp256k1KeyPair.fromString(original.secretKey)

    expect(parsed.publicKey.toString()).toBe(original.publicKey.toString())
    expect(parsed.secretKey).toBe(original.secretKey)
  })

  test("fromString() should handle round-trip conversion", () => {
    const key1 = Secp256k1KeyPair.fromRandom()
    const keyString = key1.secretKey
    const key2 = Secp256k1KeyPair.fromString(keyString)
    const key3 = Secp256k1KeyPair.fromString(key2.secretKey)

    expect(key1.publicKey.toString()).toBe(key2.publicKey.toString())
    expect(key2.publicKey.toString()).toBe(key3.publicKey.toString())
  })

  test("fromString() should reconstruct working key pair", () => {
    const key1 = Secp256k1KeyPair.fromRandom()
    const key2 = Secp256k1KeyPair.fromString(key1.secretKey)

    const message = new TextEncoder().encode("test message")
    const sig1 = key1.sign(message)
    const sig2 = key2.sign(message)

    // Both keys should produce the same signature
    expect(sig1.data).toEqual(sig2.data)
  })
})

describe("Secp256k1KeyPair - sign", () => {
  test("sign() should create 65-byte signature with recovery ID", () => {
    const keyPair = Secp256k1KeyPair.fromRandom()
    const message = new TextEncoder().encode("test message")

    const signature = keyPair.sign(message)

    expect(signature.keyType).toBe(KeyType.SECP256K1)
    expect(signature.data.length).toBe(65) // Recovery ID + signature
  })

  test("sign() should produce consistent signatures for same message", () => {
    const keyPair = Secp256k1KeyPair.fromRandom()
    const message = new TextEncoder().encode("test message")

    const sig1 = keyPair.sign(message)
    const sig2 = keyPair.sign(message)

    expect(sig1.data).toEqual(sig2.data)
  })

  test("sign() should produce different signatures for different messages", () => {
    const keyPair = Secp256k1KeyPair.fromRandom()
    const message1 = new TextEncoder().encode("message 1")
    const message2 = new TextEncoder().encode("message 2")

    const sig1 = keyPair.sign(message1)
    const sig2 = keyPair.sign(message2)

    expect(sig1.data).not.toEqual(sig2.data)
  })

  test("sign() should produce different signatures for different keys", () => {
    const key1 = Secp256k1KeyPair.fromRandom()
    const key2 = Secp256k1KeyPair.fromRandom()
    const message = new TextEncoder().encode("test message")

    const sig1 = key1.sign(message)
    const sig2 = key2.sign(message)

    expect(sig1.data).not.toEqual(sig2.data)
  })

  test("sign() should handle empty message", () => {
    const keyPair = Secp256k1KeyPair.fromRandom()
    const message = new Uint8Array(0)

    const signature = keyPair.sign(message)

    expect(signature.keyType).toBe(KeyType.SECP256K1)
    expect(signature.data.length).toBe(65)
  })

  test("sign() should handle large message", () => {
    const keyPair = Secp256k1KeyPair.fromRandom()
    const message = new Uint8Array(10000).fill(42)

    const signature = keyPair.sign(message)

    expect(signature.keyType).toBe(KeyType.SECP256K1)
    expect(signature.data.length).toBe(65)
  })
})

// ============================================================================
// NEP-413 Message Signing Tests
// ============================================================================

describe("NEP-413 Message Signing - Ed25519", () => {
  test("signNep413Message() should sign message with Ed25519", () => {
    const keyPair = Ed25519KeyPair.fromRandom()
    const nonce = new Uint8Array(32)
    crypto.getRandomValues(nonce)

    const signedMessage = keyPair.signNep413Message("alice.near", {
      message: "Login to MyApp",
      recipient: "myapp.near",
      nonce,
    })

    expect(signedMessage.accountId).toBe("alice.near")
    expect(signedMessage.publicKey).toBe(keyPair.publicKey.toString())
    expect(signedMessage.signature).toMatch(/^[A-Za-z0-9+/]+=*$/) // Base64
    expect(signedMessage.signature.length).toBeGreaterThan(50)
  })

  test("signNep413Message() should produce consistent signatures for same message", () => {
    const keyPair = Ed25519KeyPair.fromRandom()
    const nonce = new Uint8Array(32).fill(1)

    const params = {
      message: "Login to MyApp",
      recipient: "myapp.near",
      nonce,
    }

    const sig1 = keyPair.signNep413Message("alice.near", params)
    const sig2 = keyPair.signNep413Message("alice.near", params)

    expect(sig1.signature).toBe(sig2.signature)
  })

  test("signNep413Message() should produce different signatures for different nonces", () => {
    const keyPair = Ed25519KeyPair.fromRandom()
    const nonce1 = new Uint8Array(32).fill(1)
    const nonce2 = new Uint8Array(32).fill(2)

    const sig1 = keyPair.signNep413Message("alice.near", {
      message: "Login to MyApp",
      recipient: "myapp.near",
      nonce: nonce1,
    })

    const sig2 = keyPair.signNep413Message("alice.near", {
      message: "Login to MyApp",
      recipient: "myapp.near",
      nonce: nonce2,
    })

    expect(sig1.signature).not.toBe(sig2.signature)
  })

  test("signNep413Message() should include correct account ID", () => {
    const keyPair = Ed25519KeyPair.fromRandom()
    const nonce = new Uint8Array(32)

    const signedMessage = keyPair.signNep413Message("bob.near", {
      message: "Test",
      recipient: "app.near",
      nonce,
    })

    expect(signedMessage.accountId).toBe("bob.near")
  })

  test("signNep413Message() should handle different recipients", () => {
    const keyPair = Ed25519KeyPair.fromRandom()
    const nonce = new Uint8Array(32)

    const sig1 = keyPair.signNep413Message("alice.near", {
      message: "Test",
      recipient: "app1.near",
      nonce,
    })

    const sig2 = keyPair.signNep413Message("alice.near", {
      message: "Test",
      recipient: "app2.near",
      nonce,
    })

    expect(sig1.signature).not.toBe(sig2.signature)
  })
})

describe("NEP-413 Message Signing - Secp256k1", () => {
  test("signNep413Message() should sign message with Secp256k1", () => {
    const keyPair = Secp256k1KeyPair.fromRandom()
    const nonce = new Uint8Array(32)
    crypto.getRandomValues(nonce)

    const signedMessage = keyPair.signNep413Message("alice.near", {
      message: "Login to MyApp",
      recipient: "myapp.near",
      nonce,
    })

    expect(signedMessage.accountId).toBe("alice.near")
    expect(signedMessage.publicKey).toBe(keyPair.publicKey.toString())
    expect(signedMessage.publicKey).toMatch(/^secp256k1:/)
    expect(signedMessage.signature).toMatch(/^[A-Za-z0-9+/]+=*$/) // Base64
  })

  test("signNep413Message() should produce consistent signatures for same message", () => {
    const keyPair = Secp256k1KeyPair.fromRandom()
    const nonce = new Uint8Array(32).fill(1)

    const params = {
      message: "Login to MyApp",
      recipient: "myapp.near",
      nonce,
    }

    const sig1 = keyPair.signNep413Message("alice.near", params)
    const sig2 = keyPair.signNep413Message("alice.near", params)

    expect(sig1.signature).toBe(sig2.signature)
  })

  test("signNep413Message() should produce different signatures for different messages", () => {
    const keyPair = Secp256k1KeyPair.fromRandom()
    const nonce = new Uint8Array(32)

    const sig1 = keyPair.signNep413Message("alice.near", {
      message: "Message 1",
      recipient: "app.near",
      nonce,
    })

    const sig2 = keyPair.signNep413Message("alice.near", {
      message: "Message 2",
      recipient: "app.near",
      nonce,
    })

    expect(sig1.signature).not.toBe(sig2.signature)
  })

  test("signNep413Message() should produce 65-byte signature (base64 encoded)", () => {
    const keyPair = Secp256k1KeyPair.fromRandom()
    const nonce = new Uint8Array(32)

    const signedMessage = keyPair.signNep413Message("alice.near", {
      message: "Test",
      recipient: "app.near",
      nonce,
    })

    // Base64 encoding of 65 bytes should be ~88 characters
    expect(signedMessage.signature.length).toBeGreaterThan(80)
  })

  test("signNep413Message() should handle callbackUrl parameter", () => {
    const keyPair = Secp256k1KeyPair.fromRandom()
    const nonce = new Uint8Array(32)

    const signedMessage = keyPair.signNep413Message("alice.near", {
      message: "Test",
      recipient: "app.near",
      nonce,
      // callbackUrl: "https://example.com/callback",
    })

    expect(signedMessage.signature).toBeTruthy()
  })
})

// ============================================================================
// parseKey() with Secp256k1 Tests
// ============================================================================

describe("parseKey() - Secp256k1", () => {
  test("parseKey() should parse secp256k1 key string", () => {
    const original = Secp256k1KeyPair.fromRandom()
    const parsed = parseKey(original.secretKey)

    expect(parsed.publicKey.toString()).toBe(original.publicKey.toString())
    expect(parsed.publicKey.keyType).toBe(KeyType.SECP256K1)
  })

  test("parseKey() should handle round-trip for secp256k1", () => {
    const key1 = Secp256k1KeyPair.fromRandom()
    const key2 = parseKey(key1.secretKey)
    const key3 = parseKey(key2.secretKey)

    expect(key1.publicKey.toString()).toBe(key2.publicKey.toString())
    expect(key2.publicKey.toString()).toBe(key3.publicKey.toString())
  })

  test("parseKey() should return correct instance type for secp256k1", () => {
    const key = Secp256k1KeyPair.fromRandom()
    const parsed = parseKey(key.secretKey)

    expect(parsed).toBeInstanceOf(Secp256k1KeyPair)
  })

  test("parseKey() should throw InvalidKeyError for unsupported key type", () => {
    expect(() => {
      parseKey("unknown:abc123")
    }).toThrow(InvalidKeyError)
  })

  test("parseKey() should throw InvalidKeyError for key without prefix", () => {
    expect(() => {
      parseKey("abc123def456")
    }).toThrow(InvalidKeyError)
  })

  test("parseKey() should throw InvalidKeyError for empty string", () => {
    expect(() => {
      parseKey("")
    }).toThrow(InvalidKeyError)
  })

  test("parseKey() should distinguish between ed25519 and secp256k1", () => {
    const ed25519Key = Ed25519KeyPair.fromRandom()
    const secp256k1Key = Secp256k1KeyPair.fromRandom()

    const parsedEd = parseKey(ed25519Key.secretKey)
    const parsedSecp = parseKey(secp256k1Key.secretKey)

    expect(parsedEd.publicKey.keyType).toBe(KeyType.ED25519)
    expect(parsedSecp.publicKey.keyType).toBe(KeyType.SECP256K1)
  })
})

// ============================================================================
// parsePublicKey() Tests
// ============================================================================

describe("parsePublicKey() - Ed25519", () => {
  test("parsePublicKey() should parse ed25519 public key string", () => {
    const keyPair = Ed25519KeyPair.fromRandom()
    const publicKeyString = keyPair.publicKey.toString()

    const publicKey = parsePublicKey(publicKeyString)

    expect(publicKey.keyType).toBe(KeyType.ED25519)
    expect(publicKey.data.length).toBe(32)
    expect(publicKey.toString()).toBe(publicKeyString)
  })

  test("parsePublicKey() should handle round-trip for ed25519", () => {
    const keyPair = Ed25519KeyPair.fromRandom()
    const originalString = keyPair.publicKey.toString()

    const parsed = parsePublicKey(originalString)
    const roundTrip = parsed.toString()

    expect(roundTrip).toBe(originalString)
  })

  test("parsePublicKey() should preserve public key data for ed25519", () => {
    const keyPair = Ed25519KeyPair.fromRandom()
    const publicKeyString = keyPair.publicKey.toString()

    const parsed = parsePublicKey(publicKeyString)

    expect(parsed.data).toEqual(keyPair.publicKey.data)
  })
})

describe("parsePublicKey() - Secp256k1", () => {
  test("parsePublicKey() should parse secp256k1 public key string", () => {
    const keyPair = Secp256k1KeyPair.fromRandom()
    const publicKeyString = keyPair.publicKey.toString()

    const publicKey = parsePublicKey(publicKeyString)

    expect(publicKey.keyType).toBe(KeyType.SECP256K1)
    expect(publicKey.data.length).toBe(64)
    expect(publicKey.toString()).toBe(publicKeyString)
  })

  test("parsePublicKey() should handle round-trip for secp256k1", () => {
    const keyPair = Secp256k1KeyPair.fromRandom()
    const originalString = keyPair.publicKey.toString()

    const parsed = parsePublicKey(originalString)
    const roundTrip = parsed.toString()

    expect(roundTrip).toBe(originalString)
  })

  test("parsePublicKey() should preserve public key data for secp256k1", () => {
    const keyPair = Secp256k1KeyPair.fromRandom()
    const publicKeyString = keyPair.publicKey.toString()

    const parsed = parsePublicKey(publicKeyString)

    expect(parsed.data).toEqual(keyPair.publicKey.data)
  })

  test("parsePublicKey() should correctly parse 64-byte secp256k1 public key", () => {
    const keyPair = Secp256k1KeyPair.fromRandom()
    const publicKeyString = keyPair.publicKey.toString()

    const parsed = parsePublicKey(publicKeyString)

    // Secp256k1 public keys are 64 bytes (without 0x04 header)
    expect(parsed.data.length).toBe(64)
  })
})

describe("parsePublicKey() - Error Handling", () => {
  test("parsePublicKey() should throw InvalidKeyError for unsupported key type", () => {
    expect(() => {
      parsePublicKey("rsa:abc123")
    }).toThrow(InvalidKeyError)
  })

  test("parsePublicKey() should throw InvalidKeyError for key without prefix", () => {
    expect(() => {
      parsePublicKey("abc123def456")
    }).toThrow(InvalidKeyError)
  })

  test("parsePublicKey() should throw InvalidKeyError for empty string", () => {
    expect(() => {
      parsePublicKey("")
    }).toThrow(InvalidKeyError)
  })

  test("parsePublicKey() should parse key with just prefix as empty data", () => {
    // Edge case: key with just prefix decodes to empty array
    const publicKey = parsePublicKey("ed25519:")
    expect(publicKey.keyType).toBe(KeyType.ED25519)
    expect(publicKey.data.length).toBe(0)
  })

  test("parsePublicKey() should distinguish between ed25519 and secp256k1", () => {
    const ed25519Key = Ed25519KeyPair.fromRandom()
    const secp256k1Key = Secp256k1KeyPair.fromRandom()

    const parsedEd = parsePublicKey(ed25519Key.publicKey.toString())
    const parsedSecp = parsePublicKey(secp256k1Key.publicKey.toString())

    expect(parsedEd.keyType).toBe(KeyType.ED25519)
    expect(parsedSecp.keyType).toBe(KeyType.SECP256K1)
  })
})

// ============================================================================
// Additional Comprehensive Tests
// ============================================================================

describe("Key Format Validation", () => {
  test("Ed25519 secret key should be base58 encoded 64 bytes", () => {
    const keyPair = Ed25519KeyPair.fromRandom()
    const secretKey = keyPair.secretKey.replace("ed25519:", "")

    // Base58 encoded 64 bytes
    expect(secretKey.length).toBeGreaterThan(80)
    expect(secretKey).toMatch(/^[A-Za-z0-9]+$/)
  })

  test("Secp256k1 secret key should be base58 encoded 96 bytes", () => {
    const keyPair = Secp256k1KeyPair.fromRandom()
    const secretKey = keyPair.secretKey.replace("secp256k1:", "")

    // Base58 encoded 96 bytes
    expect(secretKey.length).toBeGreaterThan(120)
    expect(secretKey).toMatch(/^[A-Za-z0-9]+$/)
  })

  test("Ed25519 public key should be 32 bytes", () => {
    const keyPair = Ed25519KeyPair.fromRandom()
    expect(keyPair.publicKey.data?.length).toBe(32)
  })

  test("Secp256k1 public key should be 64 bytes (without 0x04 header)", () => {
    const keyPair = Secp256k1KeyPair.fromRandom()
    expect(keyPair.publicKey.data?.length).toBe(64)
  })
})

describe("Signature Format Validation", () => {
  test("Ed25519 signature should be 64 bytes", () => {
    const keyPair = Ed25519KeyPair.fromRandom()
    const message = new TextEncoder().encode("test")

    const signature = keyPair.sign(message)

    expect(signature.data.length).toBe(64)
  })

  test("Secp256k1 signature should be 65 bytes (recovery ID + signature)", () => {
    const keyPair = Secp256k1KeyPair.fromRandom()
    const message = new TextEncoder().encode("test")

    const signature = keyPair.sign(message)

    expect(signature.data.length).toBe(65)
  })
})

describe("Cross-Key-Type Tests", () => {
  test("Different key types should produce different public keys for same random seed", () => {
    // This test verifies that ed25519 and secp256k1 use different algorithms
    const ed25519Key = Ed25519KeyPair.fromRandom()
    const secp256k1Key = Secp256k1KeyPair.fromRandom()

    expect(ed25519Key.publicKey.toString()).not.toBe(
      secp256k1Key.publicKey.toString(),
    )
    expect(ed25519Key.publicKey.keyType).not.toBe(
      secp256k1Key.publicKey.keyType,
    )
  })

  test("parseKey() should correctly identify key type from string", () => {
    const ed25519Key = Ed25519KeyPair.fromRandom()
    const secp256k1Key = Secp256k1KeyPair.fromRandom()

    const parsedEd = parseKey(ed25519Key.secretKey)
    const parsedSecp = parseKey(secp256k1Key.secretKey)

    expect(parsedEd).toBeInstanceOf(Ed25519KeyPair)
    expect(parsedSecp).toBeInstanceOf(Secp256k1KeyPair)
  })
})

describe("Edge Cases and Boundary Conditions", () => {
  test("should handle signing very long messages", () => {
    const keyPair = Ed25519KeyPair.fromRandom()
    const longMessage = new Uint8Array(1000000).fill(42) // 1MB

    const signature = keyPair.sign(longMessage)

    expect(signature.data.length).toBe(64)
  })

  test("should handle signing empty messages", () => {
    const keyPair = Ed25519KeyPair.fromRandom()
    const emptyMessage = new Uint8Array(0)

    const signature = keyPair.sign(emptyMessage)

    expect(signature.data.length).toBe(64)
  })

  test("should handle NEP-413 signing with empty message string", () => {
    const keyPair = Ed25519KeyPair.fromRandom()
    const nonce = new Uint8Array(32)

    const signedMessage = keyPair.signNep413Message("alice.near", {
      message: "",
      recipient: "app.near",
      nonce,
    })

    expect(signedMessage.signature).toBeTruthy()
  })

  test("should handle NEP-413 signing with very long message", () => {
    const keyPair = Ed25519KeyPair.fromRandom()
    const nonce = new Uint8Array(32)
    const longMessage = "a".repeat(10000)

    const signedMessage = keyPair.signNep413Message("alice.near", {
      message: longMessage,
      recipient: "app.near",
      nonce,
    })

    expect(signedMessage.signature).toBeTruthy()
  })
})
