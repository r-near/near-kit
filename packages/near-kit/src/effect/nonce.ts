import { Context, Effect, HashMap, Layer, Option, Ref, Semaphore } from "effect"

export interface NonceReservationService {
  readonly reserve: <E, R>(
    accountId: string,
    publicKey: string,
    fetchFromBlockchain: Effect.Effect<bigint, E, R>,
  ) => Effect.Effect<bigint, E, R>
  readonly invalidate: (
    accountId: string,
    publicKey: string,
  ) => Effect.Effect<void>
  readonly updateAndGetNext: (
    accountId: string,
    publicKey: string,
    currentNonce: bigint,
  ) => Effect.Effect<bigint>
  readonly clear: () => Effect.Effect<void>
}

type ReservationState = {
  readonly semaphore: Semaphore.Semaphore
  readonly generation: number
  readonly next: bigint | undefined
}

type Reservation =
  | { readonly _tag: "Reserved"; readonly nonce: bigint }
  | { readonly _tag: "Fetch"; readonly generation: number }

/**
 * Allocate one explicit nonce-coordination domain. This is reservation state,
 * not a TTL/LRU read cache: eviction could reissue a nonce while a previously
 * signed transaction is still in flight. Separate services must not coordinate
 * the same signing key unless their caller supplies an external allocator.
 */
export const makeNonceReservation: Effect.Effect<NonceReservationService> =
  Effect.gen(function* () {
    const states = yield* Ref.make(HashMap.empty<string, ReservationState>())

    const getOrCreate = Effect.fn("NonceReservation.state")(function* (
      key: string,
    ) {
      const known = HashMap.get(yield* Ref.get(states), key)
      if (Option.isSome(known)) return known.value
      const semaphore = yield* Semaphore.make(1)
      const initial: ReservationState = {
        semaphore,
        generation: 0,
        next: undefined,
      }
      return yield* Ref.modify(states, (entries) => {
        const current = HashMap.get(entries, key)
        return Option.isSome(current)
          ? [current.value, entries]
          : [initial, HashMap.set(entries, key, initial)]
      })
    })

    const reserve = Effect.fn("NonceReservation.reserve")(function* <E, R>(
      accountId: string,
      publicKey: string,
      fetchFromBlockchain: Effect.Effect<bigint, E, R>,
    ): Effect.fn.Return<bigint, E, R> {
      const key = `${accountId}:${publicKey}`
      const { semaphore } = yield* getOrCreate(key)
      return yield* semaphore.withPermit(
        Effect.gen(function* () {
          while (true) {
            const reservation = yield* Ref.modify(
              states,
              (
                entries,
              ): [Reservation, HashMap.HashMap<string, ReservationState>] => {
                const current = HashMap.getUnsafe(entries, key)
                if (current.next === undefined) {
                  return [
                    { _tag: "Fetch", generation: current.generation },
                    entries,
                  ]
                }
                return [
                  { _tag: "Reserved", nonce: current.next },
                  HashMap.set(entries, key, {
                    ...current,
                    next: current.next + 1n,
                  }),
                ]
              },
            )
            if (reservation._tag === "Reserved") return reservation.nonce
            const onChain = yield* fetchFromBlockchain
            yield* Ref.update(states, (entries) => {
              const current = HashMap.getUnsafe(entries, key)
              // Never let an older lookup undo invalidation or a retry reservation.
              return current.generation === reservation.generation
                ? HashMap.set(entries, key, { ...current, next: onChain + 1n })
                : entries
            })
          }
        }),
      )
    })

    const invalidate = Effect.fn("NonceReservation.invalidate")(function* (
      accountId: string,
      publicKey: string,
    ) {
      const key = `${accountId}:${publicKey}`
      yield* getOrCreate(key)
      yield* Ref.update(states, (entries) => {
        const current = HashMap.getUnsafe(entries, key)
        return HashMap.set(entries, key, {
          ...current,
          generation: current.generation + 1,
          next: undefined,
        })
      })
    })

    const updateAndGetNext = Effect.fn("NonceReservation.updateAndGetNext")(
      function* (accountId: string, publicKey: string, currentNonce: bigint) {
        const key = `${accountId}:${publicKey}`
        yield* getOrCreate(key)
        return yield* Ref.modify(states, (entries) => {
          const current = HashMap.getUnsafe(entries, key)
          const requested = currentNonce + 1n
          const nonce =
            current.next !== undefined && current.next > requested
              ? current.next
              : requested
          return [
            nonce,
            HashMap.set(entries, key, {
              ...current,
              generation: current.generation + 1,
              next: nonce + 1n,
            }),
          ]
        })
      },
    )

    const clear = Effect.fn("NonceReservation.clear")(() =>
      Ref.update(
        states,
        HashMap.map((current) => ({
          ...current,
          generation: current.generation + 1,
          next: undefined,
        })),
      ),
    )

    return NonceReservation.of({ reserve, invalidate, updateAndGetNext, clear })
  })

/** Explicit, injectable coordination shared by all users of one provided layer. */
export class NonceReservation extends Context.Service<
  NonceReservation,
  NonceReservationService
>()("near-kit/NonceReservation") {
  static readonly layer = Layer.effect(NonceReservation, makeNonceReservation)
}

/** Existing Promise clients intentionally share one process-wide allocator. */
export const sharedNonceReservation = Effect.runSync(makeNonceReservation)
