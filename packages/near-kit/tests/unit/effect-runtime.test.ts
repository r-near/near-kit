import { Effect } from "effect"
import { describe, expect, test } from "vitest"
import {
  ExternalError,
  fromPromise,
  runPromise,
} from "../../src/effect/runtime.js"
import { NetworkError } from "../../src/errors/index.js"

describe("Effect compatibility boundary", () => {
  test("preserves domain failure identity and data at the Promise API", async () => {
    const failure = new NetworkError("unavailable", 503, true)
    await expect(runPromise(Effect.fail(failure))).rejects.toBe(failure)
  })

  test.each([new Error("wallet rejected"), "rejected", undefined])(
    "exposes a typed extension failure natively and its exact rejection through the facade: %s",
    async (failure) => {
      const program = fromPromise(() => Promise.reject(failure), "wallet.sign")
      const native = await Effect.runPromise(Effect.flip(program))
      expect(native).toBeInstanceOf(ExternalError)
      expect(native.operation).toBe("wallet.sign")
      expect(native.cause).toBe(failure)
      await expect(runPromise(program)).rejects.toBe(failure)
    },
  )

  test("interrupts a cooperative external operation and waits for scoped cleanup", async () => {
    const controller = new AbortController()
    let wasAborted = false
    let released = false
    let started!: () => void
    const ready = new Promise<void>((resolve) => {
      started = resolve
    })
    const program = Effect.scoped(
      Effect.gen(function* () {
        yield* Effect.acquireRelease(Effect.void, () =>
          Effect.sync(() => {
            released = true
          }),
        )
        return yield* fromPromise(
          (signal) =>
            new Promise<never>((_resolve, reject) => {
              signal.addEventListener(
                "abort",
                () => {
                  wasAborted = true
                  reject(new Error("aborted"))
                },
                { once: true },
              )
              started()
            }),
          "transport.wait",
        )
      }),
    )
    const running = runPromise(program, { signal: controller.signal })
    // Attach the rejection observer before aborting to avoid unhandled rejection.
    const rejected = expect(running).rejects.toBeDefined()
    await ready
    controller.abort()
    await rejected
    expect(wasAborted).toBe(true)
    expect(released).toBe(true)
  })
})
