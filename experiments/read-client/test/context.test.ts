import { it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/http"
import { expect } from "vitest"
import { Near } from "../src/index.js"
import { harness } from "./fixtures.js"

it.effect("preserves a borrowed Fetch client's captured request settings", () =>
  Effect.gen(function* () {
    const h = harness()
    const custom = FetchHttpClient.layer.pipe(
      Layer.provide(
        Layer.succeed(FetchHttpClient.RequestInit, {
          credentials: "include",
          cache: "no-store",
          redirect: "manual",
          headers: { "x-captured": "present" },
        }),
      ),
    )
    yield* Near.make({ url: "https://example.test" })
      .account("alice.testnet")
      .pipe(
        Effect.provide(custom),
        Effect.provideService(FetchHttpClient.Fetch, h.fetch),
      )
    expect(h.requests[0]?.init).toMatchObject({
      credentials: "include",
      cache: "no-store",
      redirect: "manual",
    })
    expect(new Headers(h.requests[0]?.init.headers).get("x-captured")).toBe(
      "present",
    )
  }),
)

it.effect(
  "allows deliberate caller Fetch policy override without claiming it is the default",
  () =>
    Effect.gen(function* () {
      const h = harness()
      yield* h
        .provide(
          Near.make({ url: "https://example.test" }).account("alice.testnet"),
        )
        .pipe(
          Effect.provideService(FetchHttpClient.RequestInit, {
            redirect: "manual",
          }),
        )
      expect(h.requests[0]?.init.redirect).toBe("manual")
    }),
)
