import { Deferred, Effect, Fiber } from "effect"
import { describe, expect, test } from "vitest"
import { NonceManager } from "../../src/core/nonce-manager.js"

// The public reservation boundary owns invalidation races: a fetch begun before
// invalidation must never repopulate the cache or overwrite a newer chain nonce.
// Existing tests invalidate only after a fetch has completed.
describe("NonceManager in-flight invalidation", () => {
  test.each([
    "invalidate",
    "clear",
    "advance",
  ] as const)("%s prevents a stale fetch from replacing newer nonce state", async (operation) => {
    const manager = new NonceManager()
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
    const first = manager.getNextNonce("alice.near", "key", fetchNonce)
    await started.promise
    if (operation === "invalidate") manager.invalidate("alice.near", "key")
    else if (operation === "clear") manager.clear()
    else expect(manager.updateAndGetNext("alice.near", "key", 500n)).toBe(501n)
    const second = manager.getNextNonce("alice.near", "key", fetchNonce)
    pending.resolve(100n)
    const reserved = await Promise.all([first, second])
    expect(reserved.sort((a, b) => Number(a - b))).toEqual(
      operation === "advance" ? [502n, 503n] : [201n, 202n],
    )
    expect(fetchCount).toBe(operation === "advance" ? 1 : 2)
  })
})

// An interrupted lookup must release its per-key permit without cancelling
// unrelated waiters. Promise-only coverage cannot exercise fiber interruption.
describe("NonceManager fiber ownership", () => {
  test("an interrupted fetch does not poison the next reservation", async () => {
    const manager = new NonceManager()
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const started = yield* Deferred.make<void>()
          const first = yield* manager
            .getNextNonceEffect(
              "alice.near",
              "key",
              Effect.gen(function* () {
                yield* Deferred.succeed(started, undefined)
                return yield* Effect.never
              }),
            )
            .pipe(Effect.forkScoped)
          yield* Deferred.await(started)
          const second = yield* manager
            .getNextNonceEffect("alice.near", "key", Effect.succeed(200n))
            .pipe(Effect.forkScoped)
          yield* Fiber.interrupt(first)
          expect(yield* Fiber.join(second)).toBe(201n)
          expect(
            yield* manager.getNextNonceEffect(
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
    const manager = new NonceManager()
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const started = yield* Deferred.make<void>()
          const result = yield* Deferred.make<bigint>()
          const first = yield* manager
            .getNextNonceEffect(
              "alice.near",
              "key",
              Effect.gen(function* () {
                yield* Deferred.succeed(started, undefined)
                return yield* Deferred.await(result)
              }),
            )
            .pipe(Effect.forkScoped)
          yield* Deferred.await(started)
          const waiter = yield* manager
            .getNextNonceEffect(
              "alice.near",
              "key",
              Effect.die("must not start another lookup"),
            )
            .pipe(Effect.forkScoped)
          yield* Fiber.interrupt(waiter)
          yield* Deferred.succeed(result, 100n)
          expect(yield* Fiber.join(first)).toBe(101n)
          expect(
            yield* manager.getNextNonceEffect(
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
