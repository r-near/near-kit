import { Effect, Semaphore } from "effect"
import { fromPromise, runPromise } from "../effect/runtime.js"

type NonceState = {
  readonly semaphore: Semaphore.Semaphore
  generation: number
  next: bigint | undefined
}

/**
 * Allocates distinct nonces for concurrent transactions. The state belongs to
 * this manager, not the fiber that happens to perform the initial lookup.
 *
 * These entries are reservation state, not a read cache: TTL/LRU eviction could
 * reissue a nonce before the corresponding transaction has reached the chain.
 * @internal Used by {@link TransactionBuilder}.
 */
export class NonceManager {
  private readonly states = new Map<string, NonceState>()

  private state(accountId: string, publicKey: string): NonceState {
    const key = `${accountId}:${publicKey}`
    let state = this.states.get(key)
    if (!state) {
      state = {
        semaphore: Semaphore.makeUnsafe(1),
        generation: 0,
        next: undefined,
      }
      this.states.set(key, state)
    }
    return state
  }

  /** Promise compatibility boundary for external nonce lookups. */
  getNextNonce(
    accountId: string,
    publicKey: string,
    fetchFromBlockchain: () => Promise<bigint>,
  ): Promise<bigint> {
    return runPromise(
      this.getNextNonceEffect(
        accountId,
        publicKey,
        fromPromise(fetchFromBlockchain, "NonceManager.fetchFromBlockchain"),
      ),
    )
  }

  /**
   * Reserve a nonce in the caller's fiber. The per-key permit deduplicates
   * successful lookups and is released on failure or interruption; no detached
   * producer or poisoned pending Promise can prevent the next caller proceeding.
   */
  getNextNonceEffect<E, R>(
    accountId: string,
    publicKey: string,
    fetchFromBlockchain: Effect.Effect<bigint, E, R>,
  ): Effect.Effect<bigint, E, R> {
    return Effect.suspend(() => {
      const state = this.state(accountId, publicKey)
      return state.semaphore.withPermit(
        Effect.gen(function* () {
          while (state.next === undefined) {
            const generation = state.generation
            const onChain = yield* fetchFromBlockchain
            // A synchronous invalidation/update may have occurred while waiting.
            // Discard stale results, including results older than an explicit
            // updateAndGetNext reservation made by an InvalidNonce retry.
            if (generation === state.generation) state.next = onChain + 1n
          }
          const nonce = state.next
          state.next = nonce + 1n
          return nonce
        }),
      )
    }).pipe(Effect.withSpan("NonceManager.getNextNonce"))
  }

  /** Force a fresh chain lookup, including when a lookup is already in flight. */
  invalidate(accountId: string, publicKey: string): void {
    const state = this.state(accountId, publicKey)
    state.generation++
    state.next = undefined
  }

  /** Advance to a chain nonce and atomically reserve the next unused value. */
  updateAndGetNext(
    accountId: string,
    publicKey: string,
    currentNonce: bigint,
  ): bigint {
    const state = this.state(accountId, publicKey)
    const next = currentNonce + 1n
    const reserved =
      state.next !== undefined && state.next > next ? state.next : next
    state.generation++
    state.next = reserved + 1n
    return reserved
  }

  /** Invalidate every entry without splitting the locks of existing callers. */
  clear(): void {
    for (const state of this.states.values()) {
      state.generation++
      state.next = undefined
    }
  }
}
