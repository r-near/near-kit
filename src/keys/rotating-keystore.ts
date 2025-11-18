/**
 * Rotating key store implementation for concurrent transaction handling.
 */
import type { KeyPair, KeyStore } from "../core/types.js"
import { parseKey } from "../utils/key.js"

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
  private keys: Map<string, KeyPair[]>
  private counters: Map<string, number>

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
    this.keys = new Map()
    this.counters = new Map()

    if (initialKeys) {
      for (const [accountId, keyStrings] of Object.entries(initialKeys)) {
        for (const keyString of keyStrings) {
          const keyPair = parseKey(keyString)
          const existing = this.keys.get(accountId) ?? []
          existing.push(keyPair)
          this.keys.set(accountId, existing)
        }
      }
    }
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
  async get(accountId: string): Promise<KeyPair | null> {
    const accountKeys = this.keys.get(accountId)
    if (!accountKeys || accountKeys.length === 0) {
      return null
    }

    // Get current counter and increment for next call
    const counter = this.counters.get(accountId) ?? 0
    const key = accountKeys[counter % accountKeys.length]
    this.counters.set(accountId, counter + 1)

    // We know key exists because we checked accountKeys.length > 0 above
    return key ?? null
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
  async add(
    accountId: string,
    key: KeyPair,
    _options?: {
      seedPhrase?: string
      derivationPath?: string
      implicitAccountId?: string
    },
  ): Promise<void> {
    const existing = this.keys.get(accountId) ?? []
    existing.push(key)
    this.keys.set(accountId, existing)
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
  async remove(accountId: string): Promise<void> {
    this.keys.delete(accountId)
    this.counters.delete(accountId)
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
  async list(): Promise<string[]> {
    return Array.from(this.keys.keys())
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
  async getAll(accountId: string): Promise<KeyPair[]> {
    return this.keys.get(accountId) ?? []
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
    return this.counters.get(accountId) ?? 0
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
    this.counters.set(accountId, 0)
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
    this.keys.clear()
    this.counters.clear()
  }
}
