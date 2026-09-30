import * as Effect from "effect/Effect"
/**
 * In-memory key store implementation.
 */
import type { KeyPair, KeyStore } from "../core/types.js"
import { makeMemoryStorage } from "../effect/key-storage.js"
import {
  type ExternalError,
  fromPromise,
  runPromise,
  runSync,
} from "../effect/runtime.js"

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
  private readonly storage: Effect.Success<ReturnType<typeof makeMemoryStorage>>

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
    this.storage = runSync(makeMemoryStorage(initialKeys))
  }

  /**
   * Add a key to the keystore
   *
   * @param accountId - NEAR account ID
   * @param key - Key pair to store
   */
  add(accountId: string, key: KeyPair): Promise<void> {
    return runPromise(this.addProgram(accountId, key))
  }

  addEffect(
    accountId: string,
    key: KeyPair,
  ): Effect.Effect<void, ExternalError> {
    if (this.add !== originalMethods.add)
      return fromPromise(() => this.add(accountId, key), "InMemoryKeyStore.add")
    return this.addProgram(accountId, key)
  }

  private addProgram(
    accountId: string,
    key: KeyPair,
  ): Effect.Effect<void, ExternalError> {
    return this.storage.add(accountId, key)
  }

  /**
   * Get a key from the keystore
   *
   * @param accountId - NEAR account ID
   * @returns Key pair if found, null otherwise
   */
  get(accountId: string): Promise<KeyPair | null> {
    return runPromise(this.getProgram(accountId))
  }

  getEffect(accountId: string): Effect.Effect<KeyPair | null, ExternalError> {
    if (this.get !== originalMethods.get)
      return fromPromise(() => this.get(accountId), "InMemoryKeyStore.get")
    return this.getProgram(accountId)
  }

  private getProgram(
    accountId: string,
  ): Effect.Effect<KeyPair | null, ExternalError> {
    return this.storage.get(accountId)
  }

  /**
   * Remove a key from the keystore
   *
   * @param accountId - NEAR account ID
   */
  remove(accountId: string): Promise<void> {
    return runPromise(this.removeProgram(accountId))
  }

  removeEffect(accountId: string): Effect.Effect<void, ExternalError> {
    if (this.remove !== originalMethods.remove)
      return fromPromise(
        () => this.remove(accountId),
        "InMemoryKeyStore.remove",
      )
    return this.removeProgram(accountId)
  }

  private removeProgram(accountId: string): Effect.Effect<void, ExternalError> {
    return this.storage.remove(accountId)
  }

  /**
   * List all account IDs in the keystore
   *
   * @returns Array of account IDs
   */
  list(): Promise<string[]> {
    return runPromise(this.listProgram())
  }

  listEffect(): Effect.Effect<string[], ExternalError> {
    if (this.list !== originalMethods.list)
      return fromPromise(() => this.list(), "InMemoryKeyStore.list")
    return this.listProgram()
  }

  private listProgram(): Effect.Effect<string[], ExternalError> {
    return this.storage.list()
  }

  /**
   * Clear all keys from the keystore
   *
   * Useful for testing cleanup.
   */
  clear(): void {
    Effect.runSync(this.storage.clear())
  }
}

// Preserve supported Promise-method overrides without crossing a runtime boundary
// in the built-in Effect implementation.
// oxlint-disable typescript/unbound-method -- Compared by identity to honor user overrides; never invoked unbound.
const originalMethods = {
  add: InMemoryKeyStore.prototype.add,
  get: InMemoryKeyStore.prototype.get,
  remove: InMemoryKeyStore.prototype.remove,
  list: InMemoryKeyStore.prototype.list,
}

// oxlint-enable typescript/unbound-method
