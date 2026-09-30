import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as HashMap from "effect/HashMap"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Ref from "effect/Ref"
import * as Semaphore from "effect/Semaphore"

export interface NonceReservationService {
  /** Order local automatic sends through their requested submission result. */
  readonly withSubmission: <A, E, R>(
    accountId: string,
    publicKey: string,
    operation: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>
  /** Strict reservations read chain+1 and keep later monotonic reservations ahead. */
  readonly reserve: <E, R>(
    accountId: string,
    publicKey: string,
    fetchFromBlockchain: Effect.Effect<bigint, E, R>,
    options?: { readonly strict?: boolean },
  ) => Effect.Effect<bigint, E, R>
  readonly invalidate: (
    accountId: string,
    publicKey: string,
  ) => Effect.Effect<void>
  // oxlint-disable-next-line effecttsgo/lazy-effect -- Kit service operations remain named Effect.fn functions, including zero-argument methods.
  readonly clear: () => Effect.Effect<void>
}

type ReservationState = {
  readonly semaphore: Semaphore.Semaphore
  readonly submission: Semaphore.Semaphore
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
      const submission = yield* Semaphore.make(1)
      const initial: ReservationState = {
        semaphore,
        submission,
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

    const withSubmission = Effect.fn("NonceReservation.withSubmission")(
      function* <A, E, R>(
        accountId: string,
        publicKey: string,
        operation: Effect.Effect<A, E, R>,
      ): Effect.fn.Return<A, E, R> {
        const { submission } = yield* getOrCreate(`${accountId}:${publicKey}`)
        return yield* submission.withPermit(operation)
      },
    )

    const reserve = Effect.fn("NonceReservation.reserve")(function* <E, R>(
      accountId: string,
      publicKey: string,
      fetchFromBlockchain: Effect.Effect<bigint, E, R>,
      options?: { readonly strict?: boolean },
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
                if (options?.strict || current.next === undefined) {
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
            const nonce = (yield* fetchFromBlockchain) + 1n
            const claimed = yield* Ref.modify(states, (entries) => {
              const current = HashMap.getUnsafe(entries, key)
              // Never let an older lookup undo explicit invalidation.
              if (current.generation !== reservation.generation)
                return [false, entries]
              // Strict mode still chooses chain+1, including after a signing failure,
              // but its reservation must not be reused by a later monotonic send.
              const next =
                current.next !== undefined && current.next > nonce + 1n
                  ? current.next
                  : nonce + 1n
              return [true, HashMap.set(entries, key, { ...current, next })]
            })
            if (claimed) return nonce
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

    return NonceReservation.of({
      withSubmission,
      reserve,
      invalidate,
      clear,
    })
  })

/** Explicit, injectable coordination shared by all users of one provided layer. */
// oxlint-disable-next-line effecttsgo/lazy-effect -- Kit service operations remain named Effect.fn functions, including zero-argument methods.
export class NonceReservation extends Context.Service<
  NonceReservation,
  NonceReservationService
>()("near-kit/NonceReservation") {
  static readonly layer = Layer.effect(NonceReservation, makeNonceReservation)
}

/** Existing Promise clients intentionally share one process-wide allocator. */
export const sharedNonceReservation = Effect.runSync(makeNonceReservation)
