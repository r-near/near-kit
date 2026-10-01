import { Cause, Effect, Exit, Layer } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { describe, expect, test } from "vitest"
import { Rpc } from "../../src/effect/rpc.js"
import { rpcTransportHttpClient } from "../../src/effect/rpc-http.js"
import { runPromise } from "../../src/effect/runtime.js"

/* oxlint-disable effecttsgo/unstable-api-usage -- Independent lifecycle proof for the explicit pinned Effect HTTP integration. */
describe("opt-in Effect HTTP transport", () => {
  test.each([false, true])(
    "closes each attempt before retrying and preserves status classification (filtered client: %s)",
    async (filterStatus) => {
      const events: string[] = []
      const signals: AbortSignal[] = []
      const http = HttpClient.make((request, _url, signal) =>
        Effect.sync(() => {
          signals.push(signal)
          const attempt = signals.length
          events.push(`request ${attempt}`)
          signal.addEventListener(
            "abort",
            () => events.push(`close ${attempt}`),
            { once: true },
          )
          return HttpClientResponse.fromWeb(
            request,
            attempt === 1
              ? Response.json({
                  jsonrpc: "2.0",
                  id: 1,
                  result: { gas_price: "10" },
                })
              : new Response("unavailable", {
                  status: attempt === 2 ? 503 : 400,
                }),
          )
        }),
      )
      const rpcLayer = Rpc.layer({
        url: "https://rpc.test",
        retry: { maxRetries: 2, initialDelayMs: 0 },
      }).pipe(
        Layer.provide(rpcTransportHttpClient),
        Layer.provide(
          Layer.succeed(
            HttpClient.HttpClient,
            filterStatus ? HttpClient.filterStatusOk(http) : http,
          ),
        ),
      )
      await runPromise(
        Effect.gen(function* () {
          const rpc = yield* Rpc
          expect(yield* rpc.getGasPrice()).toEqual({ gas_price: "10" })
          expect(signals[0]?.aborted).toBe(true)
          const failure = yield* rpc.getGasPrice().pipe(Effect.flip)
          expect(failure).toMatchObject({
            code: "NETWORK_ERROR",
            statusCode: 400,
            retryable: false,
          })
          expect(signals).toHaveLength(3)
          expect(signals.every((signal) => signal.aborted)).toBe(true)
          expect(events).toEqual([
            "request 1",
            "close 1",
            "request 2",
            "close 2",
            "request 3",
            "close 3",
          ])
        }).pipe(Effect.provide(rpcLayer)),
      )
    },
  )

  test.each(["request", "body"] as const)(
    "interrupts a pending %s and closes its request scope without retrying",
    async (phase) => {
      const started = Promise.withResolvers<void>()
      const pendingBody = Promise.withResolvers<ArrayBuffer>()
      const controller = new AbortController()
      const signals: AbortSignal[] = []
      class PendingResponse extends Response {
        override arrayBuffer(): Promise<ArrayBuffer> {
          started.resolve()
          return pendingBody.promise
        }
      }
      const http = HttpClient.make((request, _url, signal) => {
        signals.push(signal)
        if (phase === "request") {
          started.resolve()
          return Effect.never
        }
        signal.addEventListener(
          "abort",
          () => pendingBody.reject(new DOMException("cancelled", "AbortError")),
          { once: true },
        )
        return Effect.succeed(
          HttpClientResponse.fromWeb(request, new PendingResponse()),
        )
      })
      const rpcLayer = Rpc.layer({
        url: "https://rpc.test",
        retry: { maxRetries: 2, initialDelayMs: 0 },
      }).pipe(
        Layer.provide(rpcTransportHttpClient),
        Layer.provide(Layer.succeed(HttpClient.HttpClient, http)),
      )
      const exitPromise = Effect.runPromiseExit(
        Effect.gen(function* () {
          const rpc = yield* Rpc
          return yield* rpc.getGasPrice()
        }).pipe(Effect.provide(rpcLayer)),
        { signal: controller.signal },
      )
      await started.promise
      controller.abort()
      const exit = await exitPromise
      expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true)
      expect(signals).toHaveLength(1)
      expect(signals[0]?.aborted).toBe(true)
    },
  )
})
/* oxlint-enable effecttsgo/unstable-api-usage */
