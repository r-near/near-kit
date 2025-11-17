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
   * Clear all cached nonces
   */
  clear(): void {
    this.nonces.clear()
  }
}
