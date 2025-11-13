/**
 * Key generation and management utilities
 */

import * as nacl from "tweetnacl"
import { ED25519_KEY_PREFIX } from "../core/constants.js"
import {
  type KeyPair,
  KeyType,
  type PublicKey,
  type Signature,
} from "../core/types.js"

/**
 * Base58 encoding/decoding utilities
 */
const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

function base58Encode(buffer: Uint8Array): string {
  const digits = [0]

  for (let i = 0; i < buffer.length; i++) {
    let carry = buffer[i]!
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j]! << 8
      digits[j] = carry % 58
      carry = (carry / 58) | 0
    }

    while (carry > 0) {
      digits.push(carry % 58)
      carry = (carry / 58) | 0
    }
  }

  let result = ""
  for (let i = 0; i < buffer.length && buffer[i] === 0; i++) {
    result += BASE58_ALPHABET[0]
  }

  for (let i = digits.length - 1; i >= 0; i--) {
    result += BASE58_ALPHABET[digits[i]!]
  }

  return result
}

function base58Decode(str: string): Uint8Array {
  const bytes = [0]

  for (let i = 0; i < str.length; i++) {
    const char = str[i]!
    const value = BASE58_ALPHABET.indexOf(char)

    if (value === -1) {
      throw new Error(`Invalid base58 character: ${char}`)
    }

    let carry = value
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j]! * 58
      bytes[j] = carry & 0xff
      carry >>= 8
    }

    while (carry > 0) {
      bytes.push(carry & 0xff)
      carry >>= 8
    }
  }

  for (let i = 0; i < str.length && str[i] === BASE58_ALPHABET[0]; i++) {
    bytes.push(0)
  }

  return new Uint8Array(bytes.reverse())
}

/**
 * Ed25519 key pair implementation
 */
class Ed25519KeyPair implements KeyPair {
  publicKey: PublicKey
  secretKey: string
  private privateKey: Uint8Array

  constructor(secretKey: Uint8Array) {
    this.privateKey = secretKey
    const publicKeyData = secretKey.slice(32)

    this.publicKey = {
      keyType: KeyType.ED25519,
      data: publicKeyData,
      toString: () => ED25519_KEY_PREFIX + base58Encode(publicKeyData),
    }

    this.secretKey = ED25519_KEY_PREFIX + base58Encode(secretKey)
  }

  sign(message: Uint8Array): Signature {
    const signature = nacl.sign.detached(message, this.privateKey)
    return {
      keyType: KeyType.ED25519,
      data: signature,
    }
  }

  static fromRandom(): Ed25519KeyPair {
    const keyPair = nacl.sign.keyPair()
    const secretKey = new Uint8Array(64)
    secretKey.set(keyPair.secretKey.slice(0, 32))
    secretKey.set(keyPair.publicKey, 32)
    return new Ed25519KeyPair(secretKey)
  }

  static fromString(keyString: string): Ed25519KeyPair {
    const key = keyString.replace(ED25519_KEY_PREFIX, "")
    const decoded = base58Decode(key)
    return new Ed25519KeyPair(decoded)
  }
}

/**
 * Generate a new random Ed25519 key pair
 * @returns A new KeyPair instance
 */
export function generateKey(): KeyPair {
  return Ed25519KeyPair.fromRandom()
}

/**
 * Parse a key string to a KeyPair
 * @param keyString - Key string (e.g., "ed25519:...")
 * @returns KeyPair instance
 */
export function parseKey(keyString: string): KeyPair {
  if (keyString.startsWith(ED25519_KEY_PREFIX)) {
    return Ed25519KeyPair.fromString(keyString)
  }

  throw new Error(`Unsupported key type: ${keyString}`)
}

/**
 * Generate a seed phrase (12 words)
 * Note: This is a placeholder implementation. In production, use a proper BIP39 library
 * @returns A seed phrase string
 */
export function generateSeedPhrase(): string {
  // This is a simplified version. In production, use a BIP39 library
  const wordList = [
    "abandon",
    "ability",
    "able",
    "about",
    "above",
    "absent",
    "absorb",
    "abstract",
    "absurd",
    "abuse",
    "access",
    "accident",
    "account",
    "accuse",
    "achieve",
    "acid",
  ]

  const words: string[] = []
  for (let i = 0; i < 12; i++) {
    const randomIndex = Math.floor(Math.random() * wordList.length)
    words.push(wordList[randomIndex]!)
  }

  return words.join(" ")
}

/**
 * Parse a seed phrase to derive a key pair
 * Note: This is a placeholder implementation
 * @param phrase - Seed phrase
 * @param path - Derivation path (optional)
 * @returns KeyPair instance
 */
export function parseSeedPhrase(phrase: string, _path?: string): KeyPair {
  // This is a simplified version. In production, use proper BIP32/BIP39/SLIP10 derivation
  // For now, we'll just generate a key based on the hash of the phrase
  const encoder = new TextEncoder()
  const data = encoder.encode(phrase)

  // Simple hash (not cryptographically secure for production)
  let hash = 0
  for (let i = 0; i < data.length; i++) {
    hash = (hash << 5) - hash + data[i]!
    hash = hash & hash
  }

  // Generate deterministic key (this is NOT secure, just for demonstration)
  const seed = new Uint8Array(32)
  for (let i = 0; i < 32; i++) {
    seed[i] = (hash >> (i % 32)) & 0xff
  }

  const keyPair = nacl.sign.keyPair.fromSeed(seed)
  const secretKey = new Uint8Array(64)
  secretKey.set(keyPair.secretKey.slice(0, 32))
  secretKey.set(keyPair.publicKey, 32)

  return new Ed25519KeyPair(secretKey)
}

/**
 * Encode binary data to base58
 */
export { base58Encode, base58Decode }
