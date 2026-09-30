import { nativeKeyStore } from "../effect/keys.js"
import * as Effect from "effect/Effect"
/**
 * In-memory key store implementation.
 */
import type { KeyPair, KeyStore } from "../core/types.js"
import { makeMemoryStorage } from "../effect/key-storage.js"
import { runPromise, runSync } from "../effect/runtime.js"

/**
 * In-memory key store.
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
  readonly [nativeKeyStore]: Effect.Success<
    ReturnType<typeof makeMemoryStorage>
  >

  /**
   * Create a new in-memory keystore.
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
    this[nativeKeyStore] = runSync(makeMemoryStorage(initialKeys))
  }

  /**
   * Add a key to the keystore
   *
   * @param accountId - NEAR account ID
   * @param key - Key pair to store
   */
  add(accountId: string, key: KeyPair): Promise<void> {
    return runPromise(this[nativeKeyStore].add(accountId, key))
  }

  /**
   * Get a key from the keystore
   *
   * @param accountId - NEAR account ID
   * @returns Key pair if found, null otherwise
   */
  get(accountId: string): Promise<KeyPair | null> {
    return runPromise(this[nativeKeyStore].get(accountId))
  }

  /**
   * Remove a key from the keystore
   *
   * @param accountId - NEAR account ID
   */
  remove(accountId: string): Promise<void> {
    return runPromise(this[nativeKeyStore].remove(accountId))
  }

  /**
   * List all account IDs in the keystore
   *
   * @returns Array of account IDs
   */
  list(): Promise<string[]> {
    return runPromise(this[nativeKeyStore].list())
  }

  /**
   * Clear all keys from the keystore
   *
   * Useful for testing cleanup.
   */
  clear(): void {
    Effect.runSync(this[nativeKeyStore].clear())
  }
}
