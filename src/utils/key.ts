/**
 * Key generation and management utilities
 */

import { ed25519 } from "@noble/curves/ed25519.js"
import { secp256k1 } from "@noble/curves/secp256k1.js"
import { base58, base64 } from "@scure/base"
import { HDKey } from "@scure/bip32"
import * as bip39 from "@scure/bip39"
import { wordlist } from "@scure/bip39/wordlists/english.js"
import { ED25519_KEY_PREFIX, SECP256K1_KEY_PREFIX } from "../core/constants.js"
import {
  type KeyPair,
  KeyType,
  type PublicKey,
  type Signature,
  type SignedMessage,
  type SignMessageParams,
} from "../core/types.js"
import { InvalidKeyError } from "../errors/index.js"
import { serializeNep413Message } from "./nep413.js"

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

  /**
   * Sign a message according to NEP-413 specification
   *
   * NEP-413 enables off-chain message signing for authentication and ownership verification.
   * The message is signed with a full-access key but does not require gas or blockchain state.
   *
   * @param accountId - The NEAR account ID that owns this key
   * @param params - Message signing parameters (message, recipient, nonce)
   * @returns Signed message with account ID, public key, and base64-encoded signature
   *
   * @see https://github.com/near/NEPs/blob/master/neps/nep-0413.md
   *
   * @example
   * ```typescript
   * const nonce = crypto.getRandomValues(new Uint8Array(32))
   * const signedMessage = keyPair.signNep413Message("alice.near", {
   *   message: "Login to MyApp",
   *   recipient: "myapp.near",
   *   nonce,
   * })
   * console.log(signedMessage.signature) // Base64-encoded signature
   * ```
   */
  signNep413Message(
    accountId: string,
    params: SignMessageParams,
  ): SignedMessage {
    // Serialize and hash the message according to NEP-413
    const hash = serializeNep413Message(params)

    // Sign the hash
    const signature = ed25519.sign(hash, this.privateKey)

    // Return signed message with base64-encoded signature
    return {
      accountId,
      publicKey: this.publicKey.toString(),
      signature: base64.encode(signature),
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
 * Secp256k1 key pair implementation
 *
 * NEAR expects secp256k1 public keys to be 64 bytes (uncompressed without 0x04 header).
 * The secp256k1 library returns 65-byte uncompressed keys (with 0x04 header), so we
 * manually remove/add that byte as needed.
 *
 * Signatures are 65 bytes: 64-byte signature + 1-byte recovery ID.
 */
export class Secp256k1KeyPair implements KeyPair {
  publicKey: PublicKey
  secretKey: string
  private privateKey: Uint8Array

  constructor(secretKey: Uint8Array) {
    // secretKey is 96 bytes: [32 bytes private key][64 bytes public key]
    this.privateKey = secretKey.slice(0, 32)
    const publicKeyData = secretKey.slice(32) // 64 bytes without 0x04 header

    this.publicKey = {
      keyType: KeyType.SECP256K1,
      data: publicKeyData,
      toString: () => SECP256K1_KEY_PREFIX + base58.encode(publicKeyData),
    }

    this.secretKey = SECP256K1_KEY_PREFIX + base58.encode(secretKey)
  }

  sign(message: Uint8Array): Signature {
    // Sign with format: 'recovered' to get 65 bytes (recovery ID + signature)
    // This is what NEAR expects: [recovery][r][s]
    const signatureBytes = secp256k1.sign(message, this.privateKey, {
      format: "recovered",
    })

    return {
      keyType: KeyType.SECP256K1,
      data: signatureBytes, // 65 bytes
    }
  }

  /**
   * Sign a message according to NEP-413 specification
   *
   * NEP-413 enables off-chain message signing for authentication and ownership verification.
   * The message is signed with a full-access key but does not require gas or blockchain state.
   *
   * @param accountId - The NEAR account ID that owns this key
   * @param params - Message signing parameters (message, recipient, nonce)
   * @returns Signed message with account ID, public key, and base64-encoded signature
   *
   * @see https://github.com/near/NEPs/blob/master/neps/nep-0413.md
   *
   * @example
   * ```typescript
   * const nonce = crypto.getRandomValues(new Uint8Array(32))
   * const signedMessage = keyPair.signNep413Message("alice.near", {
   *   message: "Login to MyApp",
   *   recipient: "myapp.near",
   *   nonce,
   * })
   * console.log(signedMessage.signature) // Base64-encoded signature
   * ```
   */
  signNep413Message(
    accountId: string,
    params: SignMessageParams,
  ): SignedMessage {
    // Serialize and hash the message according to NEP-413
    const hash = serializeNep413Message(params)

    // Sign the hash with format: 'recovered' for secp256k1
    const signature = secp256k1.sign(hash, this.privateKey, {
      format: "recovered",
    })

    // Return signed message with base64-encoded signature
    return {
      accountId,
      publicKey: this.publicKey.toString(),
      signature: base64.encode(signature),
    }
  }

  static fromRandom(): Secp256k1KeyPair {
    // Generate random 32-byte private key
    const privateKey = new Uint8Array(32)
    crypto.getRandomValues(privateKey)

    // Get uncompressed public key (65 bytes with 0x04 header)
    const publicKeyFull = secp256k1.getPublicKey(privateKey, false)

    // Remove 0x04 header to get 64 bytes for NEAR
    const publicKey = publicKeyFull.slice(1)

    // Combine into 96-byte format: 32 bytes private + 64 bytes public
    const secretKey = new Uint8Array(96)
    secretKey.set(privateKey, 0)
    secretKey.set(publicKey, 32)

    return new Secp256k1KeyPair(secretKey)
  }

  static fromString(keyString: string): Secp256k1KeyPair {
    const key = keyString.replace(SECP256K1_KEY_PREFIX, "")
    const decoded = base58.decode(key)
    return new Secp256k1KeyPair(decoded)
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
 * @param keyString - Key string (e.g., "ed25519:..." or "secp256k1:...")
 * @returns KeyPair instance
 */
export function parseKey(keyString: string): KeyPair {
  if (keyString.startsWith(ED25519_KEY_PREFIX)) {
    return Ed25519KeyPair.fromString(keyString)
  }

  if (keyString.startsWith(SECP256K1_KEY_PREFIX)) {
    return Secp256k1KeyPair.fromString(keyString)
  }

  throw new InvalidKeyError(`Unsupported key type: ${keyString}`)
}

/**
 * Parse a public key string to a PublicKey object
 * @param publicKeyString - Public key string (e.g., "ed25519:..." or "secp256k1:...")
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

  if (publicKeyString.startsWith(SECP256K1_KEY_PREFIX)) {
    const key = publicKeyString.replace(SECP256K1_KEY_PREFIX, "")
    const decoded = base58.decode(key)
    return {
      keyType: KeyType.SECP256K1,
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
