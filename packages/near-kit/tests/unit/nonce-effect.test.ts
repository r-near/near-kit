import { Deferred, Effect, Fiber } from "effect"
import { describe, expect, test } from "vitest"
import {
  makeNonceReservation,
  NonceReservation,
} from "../../src/effect/nonce.js"

// The public reservation boundary owns invalidation races: a fetch begun before
// invalidation must never repopulate the cache or overwrite a newer chain nonce.
// Existing tests invalidate only after a fetch has completed.
describe("NonceReservation in-flight invalidation", () => {
  test.each(["invalidate", "clear", "advance"] as const)(
    "%s prevents a stale fetch from replacing newer nonce state",
    async (operation) => {
      const manager = Effect.runSync(makeNonceReservation)
      const pending = Promise.withResolvers<bigint>()
      const started = Promise.withResolvers<void>()
      let fetchCount = 0
      const fetchNonce = () => {
        fetchCount++
        if (fetchCount === 1) {
          started.resolve()
          return pending.promise
        }
        return Promise.resolve(200n)
      }
      const first = Effect.runPromise(
        manager.reserve("alice.near", "key", Effect.promise(fetchNonce)),
      )
      await started.promise
      if (operation === "invalidate")
        Effect.runSync(manager.invalidate("alice.near", "key"))
      else if (operation === "clear") Effect.runSync(manager.clear())
      else
        expect(
          Effect.runSync(manager.updateAndGetNext("alice.near", "key", 500n)),
        ).toBe(501n)
      const second = Effect.runPromise(
        manager.reserve("alice.near", "key", Effect.promise(fetchNonce)),
      )
      pending.resolve(100n)
      const reserved = await Promise.all([first, second])
      expect(reserved.sort((a, b) => Number(a - b))).toEqual(
        operation === "advance" ? [502n, 503n] : [201n, 202n],
      )
      expect(fetchCount).toBe(operation === "advance" ? 1 : 2)
    },
  )
})

// An interrupted lookup must release its per-key permit without cancelling
// unrelated waiters. Promise-only coverage cannot exercise fiber interruption.
describe("NonceReservation fiber ownership", () => {
  test("an interrupted fetch does not poison the next reservation", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const service = yield* makeNonceReservation
          const started = yield* Deferred.make<void>()
          const first = yield* service
            .reserve(
              "alice.near",
              "key",
              Effect.gen(function* () {
                yield* Deferred.succeed(started, undefined)
                return yield* Effect.never
              }),
            )
            .pipe(Effect.forkScoped)
          yield* Deferred.await(started)
          const second = yield* service
            .reserve("alice.near", "key", Effect.succeed(200n))
            .pipe(Effect.forkScoped)
          yield* Fiber.interrupt(first)
          expect(yield* Fiber.join(second)).toBe(201n)
          expect(
            yield* service.reserve(
              "alice.near",
              "key",
              Effect.die("must use existing reservation state"),
            ),
          ).toBe(202n)
        }),
      ),
    )
  })

  test("cancelling a waiter leaves the active lookup and later reservations intact", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const service = yield* makeNonceReservation
          const started = yield* Deferred.make<void>()
          const result = yield* Deferred.make<bigint>()
          const first = yield* service
            .reserve(
              "alice.near",
              "key",
              Effect.gen(function* () {
                yield* Deferred.succeed(started, undefined)
                return yield* Deferred.await(result)
              }),
            )
            .pipe(Effect.forkScoped)
          yield* Deferred.await(started)
          const waiter = yield* service
            .reserve(
              "alice.near",
              "key",
              Effect.die("must not start another lookup"),
            )
            .pipe(Effect.forkScoped)
          // Let the waiter enter the semaphore queue before cancelling it.
          yield* Effect.yieldNow
          yield* Fiber.interrupt(waiter)
          yield* Deferred.succeed(result, 100n)
          expect(yield* Fiber.join(first)).toBe(101n)
          expect(
            yield* service.reserve(
              "alice.near",
              "key",
              Effect.die("must use existing reservation state"),
            ),
          ).toBe(102n)
        }),
      ),
    )
  })
})

// Unlike legacy globally shared clients, explicit native layers define their
// own reservation domain. Test DI sharing and isolation at the service boundary.
describe("NonceReservation service layers", () => {
  test("shares reservations within one layer and isolates explicitly fresh layers", async () => {
    const reserve = Effect.gen(function* () {
      const service = yield* NonceReservation
      return yield* service.reserve("alice.near", "key", Effect.succeed(50n))
    })
    const program = Effect.all([reserve, reserve, reserve], {
      concurrency: "unbounded",
    }).pipe(Effect.provide(NonceReservation.layer, { local: true }))
    expect(await Effect.runPromise(program)).toEqual([51n, 52n, 53n])
    expect(await Effect.runPromise(program)).toEqual([51n, 52n, 53n])
  })
})
