/**
 * Manages nonces for concurrent transactions.
 *
 * Prevents nonce collisions when sending multiple transactions in parallel
 * by caching nonces in memory and incrementing them locally.
 *
 * @internal Used by {@link TransactionBuilder}; not typically needed directly.
 */
export class NonceManager {
  private nonces = new Map<string, bigint>()
  private fetching = new Map<string, Promise<void>>()

  /**
   * Get the next nonce for an account and public key
   *
   * Fetches from blockchain on first call, then increments locally.
   * Handles concurrent calls gracefully by deduplicating fetches.
   *
   * @param accountId - Account ID to get nonce for
   * @param publicKey - Public key to get nonce for
   * @param fetchFromBlockchain - Callback to fetch current nonce from blockchain
   * @returns Next nonce to use for transaction
   */
  async getNextNonce(
    accountId: string,
    publicKey: string,
    fetchFromBlockchain: () => Promise<bigint>,
  ): Promise<bigint> {
    const key = `${accountId}:${publicKey}`

    // Wait if another call is already fetching for this key
    const pendingFetch = this.fetching.get(key)
    if (pendingFetch) {
      await pendingFetch
    }

    // Fetch from blockchain if not cached
    if (!this.nonces.has(key)) {
      const fetchPromise = fetchFromBlockchain()
        .then((blockchainNonce) => {
          this.nonces.set(key, blockchainNonce + 1n)
          this.fetching.delete(key)
        })
        .catch((error) => {
          this.fetching.delete(key)
          throw error
        })

      this.fetching.set(key, fetchPromise)
      await fetchPromise
    }

    // Return current nonce and increment for next call
    const nonce = this.nonces.get(key)
    if (nonce === undefined) {
      throw new Error(`Nonce not found for ${key} after fetch`)
    }
    this.nonces.set(key, nonce + 1n)
    return nonce
  }

  /**
   * Invalidate cached nonce for an account and public key
   *
   * Call this when an InvalidNonceError occurs to force a fresh fetch
   * from the blockchain on the next transaction.
   *
   * @param accountId - Account ID to invalidate
   * @param publicKey - Public key to invalidate
   */
  invalidate(accountId: string, publicKey: string): void {
    this.nonces.delete(`${accountId}:${publicKey}`)
  }

  /**
   * Update the cached nonce to a known value and return the next nonce to use.
   *
   * Use this when you receive an InvalidNonce error with `akNonce` -
   * instead of invalidating and refetching, directly set the nonce
   * to avoid thundering herd on retry.
   *
   * @param accountId - Account ID
   * @param publicKey - Public key string (e.g., "ed25519:...")
   * @param currentNonce - The current nonce on chain (akNonce from error)
   * @returns The next nonce to use (currentNonce + 1, or higher if cache is ahead)
   */
  updateAndGetNext(
    accountId: string,
    publicKey: string,
    currentNonce: bigint,
  ): bigint {
    const key = `${accountId}:${publicKey}`
    const nextNonce = currentNonce + 1n

    const cached = this.nonces.get(key)
    if (cached !== undefined) {
      // Update to max of current cached value and new value
      // This handles case where another worker already advanced past this nonce
      if (nextNonce > cached) {
        this.nonces.set(key, nextNonce + 1n)
        return nextNonce
      } else {
        // Cached value is already higher, use it
        const result = cached
        this.nonces.set(key, cached + 1n)
        return result
      }
    }

    // No entry, create one
    this.nonces.set(key, nextNonce + 1n)
    return nextNonce
  }

  /**
   * Clear all cached nonces
   */
  clear(): void {
    this.nonces.clear()
  }
}
