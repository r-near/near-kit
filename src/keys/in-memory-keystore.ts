/**
 * In-memory key store implementation
 */

import type { KeyPair, KeyStore } from "../core/types.js"
import { parseKey } from "../utils/key.js"

/**
 * In-memory key store
 *
 * Keys are stored in memory and lost when the process exits.
 * Useful for testing, development, and temporary key storage.
 *
 * @example
 * ```typescript
 * // Empty keystore
 * const keyStore = new InMemoryKeyStore()
 *
 * // Pre-populate with keys
 * const keyStore = new InMemoryKeyStore({
 *   "alice.near": "ed25519:...",
 *   "bob.near": "ed25519:..."
 * })
 * ```
 */
export class InMemoryKeyStore implements KeyStore {
  private keys: Map<string, KeyPair>

  /**
   * Create a new in-memory keystore
   *
   * @param initialKeys - Optional initial keys to populate the store
   *
   * @example
   * ```typescript
   * const keyStore = new InMemoryKeyStore({
   *   "test.near": "ed25519:3D4c2v8K5x..."
   * })
   * ```
   */
  constructor(initialKeys?: Record<string, string>) {
    this.keys = new Map()

    if (initialKeys) {
      for (const [accountId, keyString] of Object.entries(initialKeys)) {
        const keyPair = parseKey(keyString)
        this.keys.set(accountId, keyPair)
      }
    }
  }

  /**
   * Add a key to the keystore
   *
   * @param accountId - NEAR account ID
   * @param key - Key pair to store
   */
  async add(accountId: string, key: KeyPair): Promise<void> {
    this.keys.set(accountId, key)
  }

  /**
   * Get a key from the keystore
   *
   * @param accountId - NEAR account ID
   * @returns Key pair if found, null otherwise
   */
  async get(accountId: string): Promise<KeyPair | null> {
    return this.keys.get(accountId) ?? null
  }

  /**
   * Remove a key from the keystore
   *
   * @param accountId - NEAR account ID
   */
  async remove(accountId: string): Promise<void> {
    this.keys.delete(accountId)
  }

  /**
   * List all account IDs in the keystore
   *
   * @returns Array of account IDs
   */
  async list(): Promise<string[]> {
    return Array.from(this.keys.keys())
  }

  /**
   * Clear all keys from the keystore
   *
   * Useful for testing cleanup.
   */
  clear(): void {
    this.keys.clear()
  }
}
