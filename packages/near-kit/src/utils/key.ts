import { ed25519 } from "@noble/curves/ed25519.js"
import { secp256k1 } from "@noble/curves/secp256k1.js"
import { hmac } from "@noble/hashes/hmac.js"
import { sha512 } from "@noble/hashes/sha2.js"
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js"
import { base58, base64 } from "@scure/base"
import * as bip39 from "@scure/bip39"
import { wordlist } from "@scure/bip39/wordlists/english.js"
import {
  ED25519_KEY_PREFIX,
  ML_DSA_65_HASH_LENGTH,
  ML_DSA_65_HASH_PREFIX,
  ML_DSA_65_KEY_PREFIX,
  ML_DSA_65_PUBLIC_KEY_LENGTH,
  ML_DSA_65_SECRET_KEY_LENGTH,
  ML_DSA_65_SEED_LENGTH,
  SECP256K1_KEY_PREFIX,
} from "../core/constants.js"
import {
  type KeyPair,
  KeyType,
  type MlDsa65PublicKey,
  type PublicKey,
  type Signature,
  type SignedMessage,
  type SignMessageParams,
} from "../core/types.js"
import { InvalidKeyError } from "../errors/index.js"
import { serializeNep413Message } from "./nep413.js"

/**
 * Ed25519 key pair implementation.
 *
 * @remarks
 * Implements the {@link KeyPair} interface used throughout the library and
 * provides NEP-413 message signing via {@link Ed25519KeyPair.signNep413Message}.
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

    // Return signed message with base64-encoded signature per NEP-413 spec
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
 * Secp256k1 key pair implementation.
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

    // Return signed message with base64-encoded signature per NEP-413 spec
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
 * ML-DSA-65 (FIPS 204) post-quantum key pair implementation.
 *
 * Keys are generated deterministically from a 32-byte seed via
 * {@link https://github.com/paulmillr/noble-post-quantum | @noble/post-quantum},
 * matching the FIPS 204 KeyGen used by nearcore. The 1952-byte public key is
 * what goes in `AddKey` actions and in a signed transaction's `public_key`.
 *
 * @remarks
 * The constructor accepts either form of ML-DSA-65 private-key material:
 * - a 32-byte seed (`ml-dsa-65:<seed>`), which is what this library serializes
 *   for a key it generated; the seed is expanded via `ml_dsa65.keygen(seed)`.
 * - the 4032-byte raw expanded secret key, which is what nearcore / near-cli
 *   `ml-dsa-65:` credentials store; the public key is derived with
 *   `ml_dsa65.getPublicKey(secretKey)` and the key is used directly (no keygen).
 *
 * `secretKey` round-trips whichever form it was constructed from: the 32-byte
 * seed stays `ml-dsa-65:<seed>`, the 4032-byte raw key stays
 * `ml-dsa-65:<raw key>`. Signatures are 3309 bytes.
 *
 * On-chain, an ML-DSA access key is stored as a 32-byte hash, so view RPCs
 * return an {@link MlDsa65PublicKeyHandle} (`ml-dsa-65-hash:`) that cannot be
 * turned back into a signing key.
 */
export class MlDsa65KeyPair implements KeyPair {
  publicKey: MlDsa65PublicKey
  secretKey: string
  private privateKey: Uint8Array

  /**
   * @param key - Either a 32-byte ML-DSA-65 seed or the 4032-byte raw expanded
   * secret key. Any other length throws {@link InvalidKeyError}.
   */
  constructor(key: Uint8Array) {
    let publicKey: Uint8Array
    if (key.length === ML_DSA_65_SEED_LENGTH) {
      // Seed form: expand to the full key pair.
      const expanded = ml_dsa65.keygen(key)
      publicKey = expanded.publicKey
      this.privateKey = expanded.secretKey
    } else if (key.length === ML_DSA_65_SECRET_KEY_LENGTH) {
      // Raw expanded secret key (nearcore / near-cli credential form): the
      // public key is derivable from the secret key, no keygen needed.
      this.privateKey = key
      publicKey = ml_dsa65.getPublicKey(key)
    } else {
      throw new InvalidKeyError(
        `ML-DSA-65 key must be a ${ML_DSA_65_SEED_LENGTH}-byte seed or a ` +
          `${ML_DSA_65_SECRET_KEY_LENGTH}-byte raw secret key, got ${key.length}`,
      )
    }

    this.publicKey = {
      keyType: KeyType.ML_DSA_65,
      data: publicKey,
      toString: () => ML_DSA_65_KEY_PREFIX + base58.encode(publicKey),
    }

    // Round-trip whichever private-key material we were given.
    this.secretKey = ML_DSA_65_KEY_PREFIX + base58.encode(key)
  }

  sign(message: Uint8Array): Signature {
    const signature = ml_dsa65.sign(message, this.privateKey)
    return {
      keyType: KeyType.ML_DSA_65,
      data: signature,
    }
  }

  static fromRandom(): MlDsa65KeyPair {
    const seed = new Uint8Array(ML_DSA_65_SEED_LENGTH)
    crypto.getRandomValues(seed)
    return new MlDsa65KeyPair(seed)
  }

  /**
   * Parse an `ml-dsa-65:<base58>` secret key string (a 32-byte seed or a
   * 4032-byte raw secret key).
   *
   * @throws {@link InvalidKeyError} if the string is a `ml-dsa-65-hash:` view
   * handle (a 32-byte hash, which cannot sign), is missing the `ml-dsa-65:`
   * prefix, or is not valid base58.
   */
  static fromString(keyString: string): MlDsa65KeyPair {
    if (keyString.startsWith(ML_DSA_65_HASH_PREFIX)) {
      throw new InvalidKeyError(
        "Cannot create an ML-DSA-65 key pair from an 'ml-dsa-65-hash:' view handle; " +
          "it is a 32-byte hash, not a signing key",
      )
    }
    if (!keyString.startsWith(ML_DSA_65_KEY_PREFIX)) {
      throw new InvalidKeyError(
        `ML-DSA-65 key must start with '${ML_DSA_65_KEY_PREFIX}': ${keyString}`,
      )
    }
    const key = keyString.slice(ML_DSA_65_KEY_PREFIX.length)
    let decoded: Uint8Array
    try {
      decoded = base58.decode(key)
    } catch {
      throw new InvalidKeyError(`Invalid base58 in ML-DSA-65 key: ${keyString}`)
    }
    return new MlDsa65KeyPair(decoded)
  }
}

/**
 * Read-only handle for an on-trie ML-DSA-65 access key (`ml-dsa-65-hash:`).
 *
 * View RPCs (`view_access_key_list`) return ML-DSA keys as a 32-byte hash, not
 * the full 1952-byte public key. This handle round-trips for display and
 * equality but is NOT usable for signing or as an `AddKey` public key - the
 * full key is not recoverable from it.
 */
export interface MlDsa65PublicKeyHandle {
  keyType: KeyType.ML_DSA_65
  /** The 32-byte on-trie hash. */
  hash: Uint8Array
  toString(): string
}

/**
 * Parse an `ml-dsa-65-hash:<base58-hash>` view handle into a read-only
 * {@link MlDsa65PublicKeyHandle}. The result cannot sign or be used in actions.
 */
export function parseMlDsa65Handle(
  handleString: string,
): MlDsa65PublicKeyHandle {
  if (!handleString.startsWith(ML_DSA_65_HASH_PREFIX)) {
    throw new InvalidKeyError(`Not an ML-DSA-65 view handle: ${handleString}`)
  }
  const decoded = base58.decode(
    handleString.slice(ML_DSA_65_HASH_PREFIX.length),
  )
  if (decoded.length !== ML_DSA_65_HASH_LENGTH) {
    throw new InvalidKeyError(
      `ML-DSA-65 handle must be ${ML_DSA_65_HASH_LENGTH} bytes, got ${decoded.length}`,
    )
  }
  return {
    keyType: KeyType.ML_DSA_65,
    hash: decoded,
    toString: () => handleString,
  }
}

/**
 * Generate a new random Ed25519 key pair.
 * @returns A new {@link KeyPair} instance.
 */
export function generateKey(): KeyPair {
  return Ed25519KeyPair.fromRandom()
}

/**
 * Parse a key string to a {@link KeyPair}.
 *
 * @param keyString - Key string (e.g. `"ed25519:..."` or `"secp256k1:..."`).
 * @returns A concrete {@link Ed25519KeyPair} or {@link Secp256k1KeyPair}.
 */
export function parseKey(keyString: string): KeyPair {
  if (keyString.startsWith(ED25519_KEY_PREFIX)) {
    return Ed25519KeyPair.fromString(keyString)
  }

  if (keyString.startsWith(SECP256K1_KEY_PREFIX)) {
    return Secp256k1KeyPair.fromString(keyString)
  }

  if (keyString.startsWith(ML_DSA_65_KEY_PREFIX)) {
    return MlDsa65KeyPair.fromString(keyString)
  }

  throw new InvalidKeyError(`Unsupported key type: ${keyString}`)
}

/**
 * Parse a public key string to a {@link PublicKey} object.
 *
 * @param publicKeyString - Public key string (e.g. `"ed25519:..."` or `"secp256k1:..."`).
 * @returns {@link PublicKey} instance.
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

  if (publicKeyString.startsWith(ML_DSA_65_KEY_PREFIX)) {
    const key = publicKeyString.replace(ML_DSA_65_KEY_PREFIX, "")
    const decoded = base58.decode(key)
    if (decoded.length !== ML_DSA_65_PUBLIC_KEY_LENGTH) {
      throw new InvalidKeyError(
        `ML-DSA-65 public key must be ${ML_DSA_65_PUBLIC_KEY_LENGTH} bytes, got ${decoded.length}`,
      )
    }
    return {
      keyType: KeyType.ML_DSA_65,
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
 * SLIP-0010 master key derivation for ed25519
 * Uses 'ed25519 seed' as the HMAC key per SLIP-0010 specification
 * @internal
 */
function getMasterKeyFromSeed(seed: Uint8Array): {
  key: Uint8Array
  chainCode: Uint8Array
} {
  const ED25519_SEED = new TextEncoder().encode("ed25519 seed")
  const I = hmac(sha512, ED25519_SEED, seed)
  return {
    key: I.slice(0, 32),
    chainCode: I.slice(32),
  }
}

/**
 * SLIP-0010 child key derivation for ed25519
 * Only supports hardened derivation (index >= 0x80000000)
 * @internal
 */
function deriveChild(
  parentKey: Uint8Array,
  parentChainCode: Uint8Array,
  index: number,
): { key: Uint8Array; chainCode: Uint8Array } {
  // Build data: 0x00 || parent_key || index (big-endian)
  const data = new Uint8Array(37)
  data[0] = 0
  data.set(parentKey, 1)
  const view = new DataView(data.buffer)
  view.setUint32(33, index, false) // big-endian

  const I = hmac(sha512, parentChainCode, data)
  return {
    key: I.slice(0, 32),
    chainCode: I.slice(32),
  }
}

/**
 * Parse derivation path and derive key using SLIP-0010 for ed25519
 * @internal
 */
function derivePath(path: string, seed: Uint8Array): Uint8Array {
  const HARDENED_OFFSET = 0x80000000

  // Validate path format
  if (!/^m(\/\d+')+$/.test(path)) {
    throw new InvalidKeyError(
      `Invalid derivation path: ${path}. Must be hardened (e.g., m/44'/397'/0')`,
    )
  }

  // Get master key
  let { key, chainCode } = getMasterKeyFromSeed(seed)

  // Parse and apply each path segment
  const segments = path
    .split("/")
    .slice(1) // Remove 'm'
    .map((s) => Number.parseInt(s.replace("'", ""), 10))

  for (const segment of segments) {
    const result = deriveChild(key, chainCode, segment + HARDENED_OFFSET)
    key = result.key
    chainCode = result.chainCode
  }

  return key
}

/**
 * Parse a BIP39 seed phrase to derive a key pair using SLIP-0010 for ed25519.
 *
 * This uses the correct 'ed25519 seed' HMAC key per SLIP-0010 specification,
 * which is compatible with NEAR CLI and wallet-generated seed phrases.
 *
 * @param phrase - BIP39 seed phrase (12-24 words)
 * @param path - Derivation path (defaults to "m/44'/397'/0'" for NEAR)
 * @returns KeyPair instance
 *
 * @example
 * ```typescript
 * const keyPair = parseSeedPhrase("word1 word2 ... word12")
 * console.log(keyPair.publicKey.toString()) // ed25519:...
 * ```
 */
export function parseSeedPhrase(
  phrase: string,
  path: string = "m/44'/397'/0'",
): KeyPair {
  // Normalize the seed phrase (trim, lowercase, single spaces)
  const normalizedPhrase = phrase
    .trim()
    .split(/\s+/)
    .map((word) => word.toLowerCase())
    .join(" ")

  // Validate the mnemonic
  if (!bip39.validateMnemonic(normalizedPhrase, wordlist)) {
    throw new InvalidKeyError("Invalid BIP39 seed phrase")
  }

  // Convert mnemonic to seed (64 bytes)
  const seed = bip39.mnemonicToSeedSync(normalizedPhrase)

  // Derive key using SLIP-0010 for ed25519
  const privateKey = derivePath(path, seed)

  // Get the ed25519 public key from private key
  const publicKey = ed25519.getPublicKey(privateKey)

  // Combine into 64-byte format for compatibility
  const secretKey = new Uint8Array(64)
  secretKey.set(privateKey, 0)
  secretKey.set(publicKey, 32)

  return new Ed25519KeyPair(secretKey)
}
