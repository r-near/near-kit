import { act, renderHook, waitFor } from "@testing-library/react"
import { Deferred, Effect } from "effect"
import type { Near } from "near-kit"
import type { ReactNode } from "react"
import { describe, expect, test } from "vitest"
import { useView } from "../src/hooks.js"
import { useCall } from "../src/mutations.js"
import { NearProvider } from "../src/provider.js"

const wrapperFor =
  (near: Near) =>
  ({ children }: { children: ReactNode }) => (
    <NearProvider near={near}>{children}</NearProvider>
  )

describe("Effect-owned React lifetimes", () => {
  test("unmount interrupts a native read and runs its resource finalizer", async () => {
    let started = 0
    let released = 0
    const legacyCleanup = new AbortController()
    const read = Effect.scoped(
      Effect.gen(function* () {
        yield* Effect.acquireRelease(
          Effect.sync(() => {
            started++
          }),
          () =>
            Effect.sync(() => {
              released++
            }),
        )
        return yield* Effect.never
      }),
    )
    const near = {
      effects: { view: () => read },
      view: () => Effect.runPromise(read, { signal: legacyCleanup.signal }),
    } as unknown as Near
    try {
      const hook = renderHook(
        () => useView({ contractId: "counter.testnet", method: "read" }),
        { wrapper: wrapperFor(near) },
      )
      await waitFor(() => expect(started).toBe(1))
      hook.unmount()
      await waitFor(() => expect(released).toBe(1))
    } finally {
      legacyCleanup.abort()
    }
  })

  test("changing query arguments interrupts the old read and ignores its stale result", async () => {
    const pending = Deferred.makeUnsafe<string>()
    let released = false
    const near = {
      effects: {
        view: (_contract: string, _method: string, args: { id: number }) =>
          args.id === 1
            ? Effect.scoped(
                Effect.gen(function* () {
                  yield* Effect.acquireRelease(Effect.void, () =>
                    Effect.sync(() => {
                      released = true
                    }),
                  )
                  return yield* Deferred.await(pending)
                }),
              )
            : Effect.succeed("new"),
      },
      view: () =>
        Promise.reject(
          new Error("native reads must not cross the Promise facade"),
        ),
    } as unknown as Near
    const hook = renderHook(
      ({ id }) =>
        useView<{ id: number }, string>({
          contractId: "counter.testnet",
          method: "read",
          args: { id },
        }),
      { initialProps: { id: 1 }, wrapper: wrapperFor(near) },
    )
    hook.rerender({ id: 2 })
    await waitFor(() => expect(hook.result.current.data).toBe("new"))
    expect(released).toBe(true)
    await act(async () => {
      await Effect.runPromise(Deferred.succeed(pending, "stale"))
    })
    expect(hook.result.current.data).toBe("new")
  })

  test("each native mutation keeps its result while the newest request owns UI state", async () => {
    const first = Deferred.makeUnsafe<string>()
    const second = Deferred.makeUnsafe<string>()
    const near = {
      effects: {
        call: (_contract: string, _method: string, args: { id: number }) =>
          Deferred.await(args.id === 1 ? first : second),
      },
      call: () =>
        Promise.reject(
          new Error("native mutations must not cross the Promise facade"),
        ),
    } as unknown as Near
    const hook = renderHook(
      () =>
        useCall<{ id: number }, string>({
          contractId: "counter.testnet",
          method: "write",
        }),
      { wrapper: wrapperFor(near) },
    )
    let a!: Promise<string>
    let b!: Promise<string>
    act(() => {
      a = hook.result.current.mutate({ id: 1 })
      b = hook.result.current.mutate({ id: 2 })
    })
    await act(async () => {
      await Effect.runPromise(Deferred.succeed(second, "second"))
      expect(await b).toBe("second")
    })
    expect(hook.result.current.data).toBe("second")
    hook.unmount()
    await Effect.runPromise(Deferred.succeed(first, "first"))
    expect(await a).toBe("first")
  })
})
