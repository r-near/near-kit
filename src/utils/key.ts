/**
 * Key generation and management utilities
 */

import { ed25519 } from "@noble/curves/ed25519.js"
import { base58 } from "@scure/base"
import { HDKey } from "@scure/bip32"
import * as bip39 from "@scure/bip39"
import { wordlist } from "@scure/bip39/wordlists/english.js"
import { ED25519_KEY_PREFIX } from "../core/constants.js"
import {
  type KeyPair,
  KeyType,
  type PublicKey,
  type Signature,
} from "../core/types.js"
import { InvalidKeyError } from "../errors/index.js"

/**
 * Ed25519 key pair implementation
 */
export class Ed25519KeyPair implements KeyPair {
  publicKey: PublicKey
  secretKey: string
  private privateKey: Uint8Array

  constructor(secretKey: Uint8Array) {
    // secretKey is 64 bytes: [32 bytes private key][32 bytes public key]
    this.privateKey = secretKey.slice(0, 32)
    const publicKeyData = secretKey.slice(32)

    this.publicKey = {
      keyType: KeyType.ED25519,
      data: publicKeyData,
      toString: () => ED25519_KEY_PREFIX + base58.encode(publicKeyData),
    }

    this.secretKey = ED25519_KEY_PREFIX + base58.encode(secretKey)
  }

  sign(message: Uint8Array): Signature {
    const signature = ed25519.sign(message, this.privateKey)
    return {
      keyType: KeyType.ED25519,
      data: signature,
    }
  }

  static fromRandom(): Ed25519KeyPair {
    const privateKey = ed25519.utils.randomSecretKey()
    const publicKey = ed25519.getPublicKey(privateKey)

    // Combine into 64-byte format for compatibility
    const secretKey = new Uint8Array(64)
    secretKey.set(privateKey, 0)
    secretKey.set(publicKey, 32)

    return new Ed25519KeyPair(secretKey)
  }

  static fromString(keyString: string): Ed25519KeyPair {
    const key = keyString.replace(ED25519_KEY_PREFIX, "")
    const decoded = base58.decode(key)
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

  throw new InvalidKeyError(`Unsupported key type: ${keyString}`)
}

/**
 * Parse a public key string to a PublicKey object
 * @param publicKeyString - Public key string (e.g., "ed25519:...")
 * @returns PublicKey instance
 */
export function parsePublicKey(publicKeyString: string): PublicKey {
  if (publicKeyString.startsWith(ED25519_KEY_PREFIX)) {
    const key = publicKeyString.replace(ED25519_KEY_PREFIX, "")
    const decoded = base58.decode(key)
    return {
      keyType: KeyType.ED25519,
      data: decoded,
      toString: () => publicKeyString,
    }
  }

  throw new InvalidKeyError(`Unsupported public key type: ${publicKeyString}`)
}

/**
 * Generate a BIP39 seed phrase (12 words by default)
 * Uses proper BIP39 implementation with cryptographically secure randomness
 * @param wordCount - Number of words (12, 15, 18, 21, or 24). Defaults to 12
 * @returns A BIP39 seed phrase string
 */
export function generateSeedPhrase(
  wordCount: 12 | 15 | 18 | 21 | 24 = 12,
): string {
  // Map word count to entropy bits (as per BIP39 spec)
  const entropyBits = wordCount * 11 - wordCount / 3
  const entropyBytes = entropyBits / 8

  // Generate cryptographically secure random entropy
  const entropy = new Uint8Array(entropyBytes)
  crypto.getRandomValues(entropy)

  // Generate mnemonic from entropy
  return bip39.entropyToMnemonic(entropy, wordlist)
}

/**
 * Parse a BIP39 seed phrase to derive a key pair using proper BIP32/SLIP10 derivation
 * @param phrase - BIP39 seed phrase (12-24 words)
 * @param path - BIP32 derivation path (defaults to "m/44'/397'/0'" for NEAR)
 * @returns KeyPair instance
 */
export function parseSeedPhrase(
  phrase: string,
  path: string = "m/44'/397'/0'",
): KeyPair {
  // Validate the mnemonic
  if (!bip39.validateMnemonic(phrase, wordlist)) {
    throw new InvalidKeyError("Invalid BIP39 seed phrase")
  }

  // Convert mnemonic to seed (64 bytes)
  const seed = bip39.mnemonicToSeedSync(phrase)

  // Derive HD key using BIP32 with ed25519 (SLIP10)
  // Note: HDKey from @scure/bip32 supports ed25519 via SLIP10
  const hdkey = HDKey.fromMasterSeed(seed)
  const derived = hdkey.derive(path)

  if (!derived.privateKey) {
    throw new InvalidKeyError("Failed to derive private key from seed phrase")
  }

  // Get the ed25519 public key from private key
  const privateKey = derived.privateKey
  const publicKey = ed25519.getPublicKey(privateKey)

  // Combine into 64-byte format for compatibility
  const secretKey = new Uint8Array(64)
  secretKey.set(privateKey, 0)
  secretKey.set(publicKey, 32)

  return new Ed25519KeyPair(secretKey)
}
