/**
 * NEP-616 StateInit utilities for deterministic account IDs
 *
 * This module provides utilities for working with NEP-616 Deterministic AccountIds.
 * These account IDs are derived from the contract initialization state using the formula:
 * `"0s" + hex(keccak256(borsh(state_init))[12..32])`
 *
 * @see https://github.com/near/NEPs/pull/616
 */

import { keccak_256 } from "@noble/hashes/sha3.js"
import { base58, hex } from "@scure/base"
import { b } from "@zorsh/zorsh"

/**
 * Contract code reference - either by hash or by account ID
 */
export type ContractCode =
  | { type: "codeHash"; hash: Uint8Array }
  | { type: "accountId"; accountId: string }

/**
 * StateInit structure for NEP-616 deterministic account IDs
 */
export interface StateInit {
  code: ContractCode
  data: Map<Uint8Array, Uint8Array>
}

/**
 * Options for creating a StateInit
 */
export interface StateInitOptions {
  /**
   * Reference to the contract code
   * - Use { codeHash: Uint8Array | string } for hash-based reference (base58 string or raw bytes)
   * - Use { accountId: string } for account-based reference
   */
  code: { codeHash: Uint8Array | string } | { accountId: string }
  /**
   * Initial key-value pairs to populate in the contract's storage
   * Keys and values should be Borsh-serialized bytes
   */
  data?: Map<Uint8Array, Uint8Array>
}

// ==================== Helper Functions ====================

/**
 * Parse and validate a code hash from either base58 string or Uint8Array
 *
 * @param codeHash - Code hash as base58 string or Uint8Array
 * @returns Validated 32-byte hash as Uint8Array
 * @throws Error if base58 is invalid or hash is not 32 bytes
 */
export function parseCodeHash(codeHash: string | Uint8Array): Uint8Array {
  let hashBytes: Uint8Array

  if (typeof codeHash === "string") {
    try {
      hashBytes = base58.decode(codeHash)
    } catch {
      throw new Error(`Invalid base58 code hash: ${codeHash}`)
    }
  } else {
    hashBytes = codeHash
  }

  if (hashBytes.length !== 32) {
    throw new Error(`Code hash must be 32 bytes, got ${hashBytes.length} bytes`)
  }

  return hashBytes
}

// ==================== Borsh Schemas for StateInit ====================

/**
 * GlobalContractIdentifier enum for Borsh serialization
 * 0 = CodeHash (32-byte hash)
 * 1 = AccountId (string)
 */
const GlobalContractIdentifierSchema = b.enum({
  CodeHash: b.array(b.u8(), 32),
  AccountId: b.string(),
})

/**
 * StateInitV1 struct for Borsh serialization
 */
const StateInitV1Schema = b.struct({
  code: GlobalContractIdentifierSchema,
  data: b.hashMap(b.bytes(), b.bytes()),
})

/**
 * StateInit enum (versioned) for Borsh serialization
 */
const StateInitSchema = b.enum({
  V1: StateInitV1Schema,
})

/**
 * Create a StateInit object from options
 *
 * @param options - StateInit configuration
 * @returns StateInit object
 */
export function createStateInit(options: StateInitOptions): StateInit {
  let code: ContractCode

  if ("accountId" in options.code) {
    code = { type: "accountId", accountId: options.code.accountId }
  } else {
    const hashBytes = parseCodeHash(options.code.codeHash)
    code = { type: "codeHash", hash: hashBytes }
  }

  return {
    code,
    data: options.data ?? new Map(),
  }
}

/**
 * Serialize a StateInit to Borsh bytes
 *
 * @param stateInit - StateInit object to serialize
 * @returns Borsh-serialized bytes
 */
export function serializeStateInit(stateInit: StateInit): Uint8Array {
  let codeIdentifier: { CodeHash: number[] } | { AccountId: string }

  if (stateInit.code.type === "accountId") {
    codeIdentifier = { AccountId: stateInit.code.accountId }
  } else {
    codeIdentifier = { CodeHash: Array.from(stateInit.code.hash) as number[] }
  }

  // Sort the data map by keys to ensure deterministic serialization
  // NEP-616 specifies BTreeMap which has sorted order, but JavaScript Map
  // maintains insertion order. We must sort to ensure the same key-value pairs
  // produce the same account ID regardless of insertion order.
  const sortedData = new Map(
    Array.from(stateInit.data.entries()).sort((a, b) => {
      const [keyA] = a
      const [keyB] = b
      // Compare byte-by-byte
      for (let i = 0; i < Math.min(keyA.length, keyB.length); i++) {
        if (keyA[i] !== keyB[i]) {
          return keyA[i] - keyB[i]
        }
      }
      // If all bytes match, shorter key comes first
      return keyA.length - keyB.length
    }),
  )

  return StateInitSchema.serialize({
    V1: {
      code: codeIdentifier,
      data: sortedData,
    },
  })
}

/**
 * Derive a deterministic account ID from a StateInit according to NEP-616.
 *
 * The account ID is derived as: `"0s" + hex(keccak256(borsh(state_init))[12..32])`
 *
 * This produces a 42-character account ID that:
 * - Starts with "0s" prefix (distinguishes from Ethereum implicit accounts "0x")
 * - Followed by 40 hex characters (20 bytes from the keccak256 hash)
 *
 * @param stateInit - StateInit object or options to create one
 * @returns The deterministically derived account ID
 *
 * @example
 * ```typescript
 * // From a global contract by account ID
 * const accountId = deriveAccountId({
 *   code: { accountId: "publisher.near" },
 * })
 * // => "0s1234567890abcdef1234567890abcdef12345678"
 *
 * // From a global contract by code hash
 * const accountId = deriveAccountId({
 *   code: { codeHash: hashBytes },
 * })
 *
 * // With initial storage data
 * const accountId = deriveAccountId({
 *   code: { accountId: "publisher.near" },
 *   data: new Map([[key1, value1], [key2, value2]]),
 * })
 * ```
 */
export function deriveAccountId(options: StateInitOptions): string {
  const stateInit = createStateInit(options)
  const serialized = serializeStateInit(stateInit)
  const hash = keccak_256(serialized)
  // Take last 20 bytes (indices 12-32) of the hash
  const suffix = hash.slice(12, 32)
  return `0s${hex.encode(suffix)}`
}

/**
 * Verify that an account ID matches the expected deterministic derivation from a StateInit.
 *
 * @param accountId - The account ID to verify
 * @param options - StateInit options to derive the expected account ID from
 * @returns true if the account ID matches the derivation, false otherwise
 *
 * @example
 * ```typescript
 * const isValid = verifyDeterministicAccountId(
 *   "0s1234567890abcdef1234567890abcdef12345678",
 *   { code: { accountId: "publisher.near" } }
 * )
 * ```
 */
export function verifyDeterministicAccountId(
  accountId: string,
  options: StateInitOptions,
): boolean {
  const expected = deriveAccountId(options)
  return accountId === expected
}

/**
 * Check if an account ID is a deterministic account ID (NEP-616).
 *
 * Deterministic account IDs start with "0s" followed by 40 hex characters.
 *
 * @param accountId - The account ID to check
 * @returns true if it's a deterministic account ID, false otherwise
 *
 * @example
 * ```typescript
 * isDeterministicAccountId("0s1234567890abcdef1234567890abcdef12345678") // true
 * isDeterministicAccountId("alice.near") // false
 * isDeterministicAccountId("0x1234567890abcdef1234567890abcdef12345678") // false (Ethereum)
 * ```
 */
export function isDeterministicAccountId(accountId: string): boolean {
  // Must be exactly 42 characters: "0s" + 40 hex chars
  if (accountId.length !== 42) {
    return false
  }

  // Must start with "0s"
  if (!accountId.startsWith("0s")) {
    return false
  }

  // Rest must be valid hex
  const hexPart = accountId.slice(2)
  return /^[0-9a-f]+$/.test(hexPart)
}
