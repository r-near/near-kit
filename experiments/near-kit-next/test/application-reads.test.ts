import { it } from "@effect/vitest"
import * as Near from "@near-kit/next"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Stream from "effect/Stream"
import * as TestClock from "effect/testing/TestClock"
import { expect } from "vitest"
import { accountSamples } from "../examples/poll-account.js"
import { rawReadRequest } from "../examples/raw-inspection.js"
import { accountWire, HASH, harness, unknownAccount } from "./fixtures.js"

const client = Near.make({ url: "https://example.test" })
it.effect(
  "application polling is lazy, sequential and stops at the caller's take",
  () =>
    Effect.gen(function* () {
      const h = harness(() => accountWire)
      const samples = accountSamples(client, "fixture", "0 millis")
      expect(h.requests).toHaveLength(0)
      const result = yield* h.provide(
        samples.pipe(Stream.take(3), Stream.runCollect),
      )
      expect(result).toHaveLength(3)
      expect(h.requests).toHaveLength(3)
      expect(
        h.requests.every((row) => row.request.params.finality === "final"),
      ).toBe(true)
    }),
)
it.effect(
  "polling does not retry account absence as a transient transport failure",
  () =>
    Effect.gen(function* () {
      const h = harness(
        (request) => unknownAccount(request.id, "fixture"),
        false,
      )
      const failure = yield* h.provide(
        accountSamples(client, "fixture", "0 millis").pipe(
          Stream.runCollect,
          Effect.flip,
        ),
      )
      expect(failure._tag).toBe("AccountNotFound")
      expect(h.requests).toHaveLength(1)
    }),
)
it("raw inspection accepts only the documented read commands and validated hashes", () => {
  expect(rawReadRequest("block", HASH)).toEqual({
    method: "block",
    params: { block_id: HASH },
  })
  expect(rawReadRequest("chunk", HASH)).toEqual({
    method: "chunk",
    params: { chunk_id: HASH },
  })
  expect(rawReadRequest("genesis")).toEqual({
    method: "genesis_config",
    params: [],
  })
  expect(rawReadRequest("config")).toEqual({
    method: "EXPERIMENTAL_protocol_config",
    params: { finality: "final" },
  })
  for (const [method, hash] of [
    ["unknown", undefined],
    ["block", "bad"],
    ["config", HASH],
  ] as const)
    expect(() => rawReadRequest(method, hash)).toThrow()
})

it.effect("poll spacing uses the caller clock and fiber", () =>
  Effect.gen(function* () {
    const h = harness(() => accountWire)
    const fiber = yield* h.provide(
      accountSamples(client, "fixture").pipe(
        Stream.take(2),
        Stream.runCollect,
        Effect.forkChild,
      ),
    )
    yield* TestClock.adjust("5 seconds")
    const values = yield* Fiber.join(fiber)
    expect(values).toHaveLength(2)
    expect(h.requests).toHaveLength(2)
  }),
)

it.effect(
  "poll transport retries are explicitly bounded by the application",
  () =>
    Effect.gen(function* () {
      const h = harness(() => {
        throw new Error("transport fixture")
      })
      const fiber = yield* h.provide(
        accountSamples(client, "fixture").pipe(
          Stream.runCollect,
          Effect.flip,
          Effect.forkChild,
        ),
      )
      yield* TestClock.adjust("1 second")
      expect((yield* Fiber.join(fiber))._tag).toBe("TransportError")
      expect(h.requests).toHaveLength(3)
    }),
)
