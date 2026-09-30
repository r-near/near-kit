import { Effect } from "effect"
/**
 * Rotating key store implementation for concurrent transaction handling.
 */
import type { KeyPair, KeyStore } from "../core/types.js"
import { makeRotatingStorage } from "../effect/key-storage.js"
import {
  type ExternalError,
  fromPromise,
  runPromise,
} from "../effect/runtime.js"

/**
 * Rotating key store that cycles through multiple keys per account.
 *
 * This keystore enables high-throughput concurrent transactions by rotating
 * through multiple access keys for a single account. Each transaction uses
 * a different key in round-robin fashion, eliminating nonce collisions.
 *
 * ## Use Cases
 * - **High-throughput applications**: Send many concurrent transactions without nonce collisions
 * - **Load balancing**: Distribute transaction load across multiple access keys
 * - **Key rotation**: Seamlessly rotate keys without downtime
 *
 * ## How It Works
 * - Each account can have multiple keys registered
 * - `get()` returns the next key in round-robin order
 * - Each key has independent nonce tracking via NonceManager
 * - No nonce collisions between concurrent transactions
 *
 * @example
 * ```typescript
 * // Create keystore with multiple keys for one account
 * const keyStore = new RotatingKeyStore()
 * await keyStore.add("alice.near", parseKey("ed25519:key1..."))
 * await keyStore.add("alice.near", parseKey("ed25519:key2..."))
 * await keyStore.add("alice.near", parseKey("ed25519:key3..."))
 *
 * const near = new Near({ network: "testnet", keyStore })
 *
 * // Send 100 concurrent transactions - no nonce collisions!
 * await Promise.all(
 *   Array(100).fill(0).map(() =>
 *     near.transaction("alice.near")
 *       .transfer("bob.near", "0.1")
 *       .send()
 *   )
 * )
 * ```
 *
 * @example
 * ```typescript
 * // Initialize with keys
 * const keyStore = new RotatingKeyStore({
 *   "alice.near": [
 *     "ed25519:key1...",
 *     "ed25519:key2...",
 *     "ed25519:key3..."
 *   ]
 * })
 * ```
 *
 * @example
 * ```typescript
 * // Query rotation state
 * const keys = await keyStore.getAll("alice.near")
 * console.log(`Account has ${keys.length} keys`)
 *
 * const index = keyStore.getCurrentIndex("alice.near")
 * console.log(`Currently at key index ${index}`)
 * ```
 */
export class RotatingKeyStore implements KeyStore {
  private readonly storage: Effect.Success<
    ReturnType<typeof makeRotatingStorage>
  >

  /**
   * Create a new rotating keystore.
   *
   * @param initialKeys - Optional initial keys to populate the store.
   *   Maps account IDs to arrays of private key strings.
   *
   * @example
   * ```typescript
   * const keyStore = new RotatingKeyStore({
   *   "alice.near": ["ed25519:key1...", "ed25519:key2..."],
   *   "bob.near": ["ed25519:key3..."]
   * })
   * ```
   */
  constructor(initialKeys?: Record<string, string[]>) {
    this.storage = Effect.runSync(makeRotatingStorage(initialKeys))
  }

  /**
   * Get the next key for an account using round-robin rotation.
   *
   * Each call to `get()` advances to the next key in the rotation.
   * This is the core mechanism that enables concurrent transactions
   * without nonce collisions.
   *
   * @param accountId - NEAR account ID
   * @returns Next key in rotation, or null if no keys exist for account
   *
   * @example
   * ```typescript
   * // First call returns key1, second returns key2, third returns key3, fourth returns key1...
   * const key1 = await keyStore.get("alice.near")
   * const key2 = await keyStore.get("alice.near")
   * const key3 = await keyStore.get("alice.near")
   * const key4 = await keyStore.get("alice.near") // Back to key1
   * ```
   */
  get(accountId: string): Promise<KeyPair | null> {
    return runPromise(this.getProgram(accountId))
  }

  getEffect(accountId: string): Effect.Effect<KeyPair | null, ExternalError> {
    if (this.get !== originalMethods.get)
      return fromPromise(() => this.get(accountId), "RotatingKeyStore.get")
    return this.getProgram(accountId)
  }

  private getProgram(
    accountId: string,
  ): Effect.Effect<KeyPair | null, ExternalError> {
    return this.storage.get(accountId)
  }

  /**
   * Add a key to an account's rotation pool.
   *
   * If the account already has keys, the new key is appended to the rotation.
   * If this is the first key for the account, it becomes the starting key.
   *
   * @param accountId - NEAR account ID
   * @param key - Key pair to add to rotation
   * @param options - Optional metadata (preserved but not used for rotation)
   *
   * @example
   * ```typescript
   * await keyStore.add("alice.near", keyPair1)
   * await keyStore.add("alice.near", keyPair2) // Now rotates between both
   * ```
   */
  add(
    accountId: string,
    key: KeyPair,
    _options?: {
      seedPhrase?: string
      derivationPath?: string
      implicitAccountId?: string
    },
  ): Promise<void> {
    return runPromise(this.addProgram(accountId, key, _options))
  }

  addEffect(
    accountId: string,
    key: KeyPair,
    _options?: {
      seedPhrase?: string
      derivationPath?: string
      implicitAccountId?: string
    },
  ): Effect.Effect<void, ExternalError> {
    if (this.add !== originalMethods.add)
      return fromPromise(
        () => this.add(accountId, key, _options),
        "RotatingKeyStore.add",
      )
    return this.addProgram(accountId, key, _options)
  }

  private addProgram(
    accountId: string,
    key: KeyPair,
    _options?: {
      seedPhrase?: string
      derivationPath?: string
      implicitAccountId?: string
    },
  ): Effect.Effect<void, ExternalError> {
    return this.storage.add(accountId, key)
  }

  /**
   * Remove all keys for an account from the rotation pool.
   *
   * This also resets the rotation counter for the account.
   *
   * @param accountId - NEAR account ID
   *
   * @example
   * ```typescript
   * await keyStore.remove("alice.near")
   * ```
   */
  remove(accountId: string): Promise<void> {
    return runPromise(this.removeProgram(accountId))
  }

  removeEffect(accountId: string): Effect.Effect<void, ExternalError> {
    if (this.remove !== originalMethods.remove)
      return fromPromise(
        () => this.remove(accountId),
        "RotatingKeyStore.remove",
      )
    return this.removeProgram(accountId)
  }

  private removeProgram(accountId: string): Effect.Effect<void, ExternalError> {
    return this.storage.remove(accountId)
  }

  /**
   * List all account IDs in the keystore.
   *
   * @returns Array of account IDs that have at least one key
   *
   * @example
   * ```typescript
   * const accounts = await keyStore.list()
   * console.log(`Managing keys for: ${accounts.join(", ")}`)
   * ```
   */
  list(): Promise<string[]> {
    return runPromise(this.listProgram())
  }

  listEffect(): Effect.Effect<string[], ExternalError> {
    if (this.list !== originalMethods.list)
      return fromPromise(() => this.list(), "RotatingKeyStore.list")
    return this.listProgram()
  }

  private listProgram(): Effect.Effect<string[], ExternalError> {
    return this.storage.list()
  }

  /**
   * Get all keys for an account (non-rotating).
   *
   * Returns all keys in the rotation pool without advancing the counter.
   * Useful for inspecting or managing the key pool.
   *
   * @param accountId - NEAR account ID
   * @returns Array of all key pairs for the account, or empty array if none exist
   *
   * @example
   * ```typescript
   * const keys = await keyStore.getAll("alice.near")
   * console.log(`Account has ${keys.length} keys in rotation`)
   * ```
   */
  getAll(accountId: string): Promise<KeyPair[]> {
    return runPromise(this.getAllProgram(accountId))
  }

  getAllEffect(accountId: string): Effect.Effect<KeyPair[], ExternalError> {
    if (this.getAll !== originalMethods.getAll)
      return fromPromise(
        () => this.getAll(accountId),
        "RotatingKeyStore.getAll",
      )
    return this.getAllProgram(accountId)
  }

  private getAllProgram(
    accountId: string,
  ): Effect.Effect<KeyPair[], ExternalError> {
    return this.storage.getAll(accountId)
  }

  /**
   * Get the current rotation index for an account.
   *
   * The index indicates which key will be returned on the next `get()` call.
   *
   * @param accountId - NEAR account ID
   * @returns Current counter value (0-based index into key array)
   *
   * @example
   * ```typescript
   * const index = keyStore.getCurrentIndex("alice.near")
   * const totalKeys = (await keyStore.getAll("alice.near")).length
   * console.log(`Next key: ${index % totalKeys}`)
   * ```
   */
  getCurrentIndex(accountId: string): number {
    return Effect.runSync(this.storage.getCurrentIndex(accountId))
  }

  /**
   * Reset the rotation counter for an account.
   *
   * The next `get()` call will return the first key in the rotation.
   *
   * @param accountId - NEAR account ID
   *
   * @example
   * ```typescript
   * keyStore.resetCounter("alice.near")
   * const key = await keyStore.get("alice.near") // Returns first key
   * ```
   */
  resetCounter(accountId: string): void {
    Effect.runSync(this.storage.resetCounter(accountId))
  }

  /**
   * Clear all keys and counters from the keystore.
   *
   * Useful for testing cleanup or resetting state.
   *
   * @example
   * ```typescript
   * keyStore.clear()
   * ```
   */
  clear(): void {
    Effect.runSync(this.storage.clear())
  }
}

// Preserve supported Promise-method overrides without crossing a runtime boundary
// in the built-in Effect implementation.
const originalMethods = {
  get: RotatingKeyStore.prototype.get,
  add: RotatingKeyStore.prototype.add,
  remove: RotatingKeyStore.prototype.remove,
  list: RotatingKeyStore.prototype.list,
  getAll: RotatingKeyStore.prototype.getAll,
}
