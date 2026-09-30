import { act, render, renderHook, waitFor } from "@testing-library/react"
import { Deferred, Effect, Fiber, SubscriptionRef } from "effect"
import {
  generateKey,
  Near,
  type FinalExecutionOutcome,
  type KeyPair,
  type KeyStore,
  type NearConfig,
} from "near-kit"
import {
  prepareClient,
  walletConnection,
  type WalletAccountState,
} from "near-kit/effect"
import { Component, StrictMode, type ReactNode } from "react"
import { renderToString } from "react-dom/server"
import { describe, expect, test, vi } from "vitest"
import { useAccount } from "../src/account.js"
import { useCall } from "../src/mutations.js"
import { NearProvider, useNear } from "../src/provider.js"

const observedWallet = (
  accountId: string,
  options: {
    release?: Effect.Effect<unknown>
    submit?: Effect.Effect<FinalExecutionOutcome>
  } = {},
) => {
  const state = Effect.runSync(
    SubscriptionRef.make<WalletAccountState>({
      _tag: "Ready",
      accounts: [{ accountId }],
    }),
  )
  const counts = {
    acquired: 0,
    released: 0,
    active: 0,
    peak: 0,
    directReads: 0,
  }
  const acquired = Deferred.makeUnsafe<void>()
  const wallet = walletConnection({
    getAccounts: () =>
      Effect.suspend(() => {
        counts.directReads++
        return Effect.die("The provider must use its shared account observer")
      }),
    signAndSendTransaction: () => options.submit ?? Effect.die("unused"),
    observeAccounts: () =>
      Effect.acquireRelease(
        Effect.gen(function* () {
          counts.acquired++
          counts.active++
          counts.peak = Math.max(counts.peak, counts.active)
          yield* Deferred.succeed(acquired, undefined)
          return {
            get: () => SubscriptionRef.get(state),
            changes: SubscriptionRef.changes(state),
            ready: Effect.void,
          }
        }),
        () =>
          (options.release ?? Effect.void).pipe(
            Effect.andThen(
              Effect.sync(() => {
                counts.released++
                counts.active--
              }),
            ),
          ),
      ),
  })
  return { wallet, state, counts, acquired }
}

const message = {
  message: "provider readiness",
  recipient: "app.near",
  nonce: new Uint8Array(32),
}

describe("provider-owned observation", () => {
  test("reports defective observation acquisition after cleanup to the application error boundary", async () => {
    const defect = new Error("native observation acquisition defect")
    const caught = Deferred.makeUnsafe<unknown>()
    const release = Deferred.makeUnsafe<void>()
    let cleanupStarted = false
    let released = 0
    const wallet = walletConnection({
      getAccounts: () => Effect.succeed([]),
      signAndSendTransaction: () => Effect.die("unused"),
      observeAccounts: () =>
        Effect.gen(function* () {
          yield* Effect.acquireRelease(Effect.void, () =>
            Effect.gen(function* () {
              cleanupStarted = true
              yield* Deferred.await(release)
              released++
            }),
          )
          return yield* Effect.die(defect)
        }),
    })
    class Boundary extends Component<
      { children: ReactNode },
      { failed: boolean }
    > {
      override state = { failed: false }
      static getDerivedStateFromError() {
        return { failed: true }
      }
      override componentDidCatch(error: unknown) {
        Deferred.doneUnsafe(caught, Effect.succeed(error))
      }
      override render() {
        return this.state.failed ? (
          <span>observation failed</span>
        ) : (
          this.props.children
        )
      }
    }
    function Child() {
      const account = useAccount()
      return <span>{account.isLoading ? "loading" : "ready"}</span>
    }
    const view = render(
      <Boundary>
        <NearProvider config={{ wallet }}>
          <Child />
        </NearProvider>
      </Boundary>,
    )
    await waitFor(() => expect(cleanupStarted).toBe(true))
    expect(view.queryByText("observation failed")).toBeNull()
    expect(released).toBe(0)
    await act(async () => {
      await Effect.runPromise(Deferred.succeed(release, undefined))
    })
    await waitFor(() =>
      expect(view.queryByText("observation failed")).not.toBeNull(),
    )
    expect(await Effect.runPromise(Deferred.await(caught))).toBe(defect)
    expect(released).toBe(1)
    view.unmount()
  })

  test.each(["replacement", "unmount"] as const)(
    "reports delayed cleanup defects after %s without updating a stale provider",
    async (ending) => {
      const release = Deferred.makeUnsafe<void>()
      const defect = new Error("observation release defect")
      const first = observedWallet("alice.near", {
        release: Deferred.await(release).pipe(
          Effect.andThen(Effect.die(defect)),
        ),
      })
      const second = observedWallet("bob.near")
      let config: NearConfig = { wallet: first.wallet }
      const wrapper = ({ children }: { children: ReactNode }) => (
        <NearProvider config={config}>{children}</NearProvider>
      )
      const log = vi.spyOn(console, "log").mockImplementation(() => {})
      const hook = renderHook(() => useAccount(), { wrapper })
      try {
        await waitFor(() =>
          expect(hook.result.current.accountId).toBe("alice.near"),
        )
        if (ending === "replacement") {
          config = { wallet: second.wallet }
          hook.rerender()
          expect(second.counts.acquired).toBe(0)
        } else {
          hook.unmount()
        }
        expect(log).not.toHaveBeenCalled()
        await act(async () => {
          await Effect.runPromise(Deferred.succeed(release, undefined))
        })
        await waitFor(() => expect(log).toHaveBeenCalledTimes(1))
        expect(log.mock.calls[0]?.[1]).toBe(
          "NearProvider observation cleanup failed",
        )
        expect(log.mock.calls[0]?.[2]).toContain(defect.message)
        if (ending === "replacement") {
          await waitFor(() =>
            expect(hook.result.current.accountId).toBe("bob.near"),
          )
          expect(second.counts.active).toBe(1)
          expect(second.counts.acquired).toBe(1)
        }
      } finally {
        await Effect.runPromise(Deferred.succeed(release, undefined))
        hook.unmount()
        log.mockRestore()
      }
    },
  )

  test("ordinary StrictMode cleanup and unmount do not report interruption as a defect", async () => {
    const fixture = observedWallet("alice.near")
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StrictMode>
        <NearProvider config={{ wallet: fixture.wallet }}>
          {children}
        </NearProvider>
      </StrictMode>
    )
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    const hook = renderHook(() => useAccount(), { wrapper })
    try {
      await waitFor(() =>
        expect(hook.result.current.accountId).toBe("alice.near"),
      )
      expect(fixture.counts.active).toBe(1)
      await act(async () => hook.unmount())
      expect(fixture.counts.active).toBe(0)
      expect(fixture.counts.released).toBe(fixture.counts.acquired)
      expect(log).not.toHaveBeenCalled()
    } finally {
      hook.unmount()
      log.mockRestore()
    }
  })

  test("SSR and abandoned renders retain children without starting keys or observation", () => {
    const key = generateKey()
    const fixture = observedWallet("alice.near")
    let writes = 0
    const keyStore: KeyStore = {
      add: async () => {
        writes++
      },
      get: async () => key,
      remove: async () => {},
      list: async () => [],
    }
    const config: NearConfig = {
      network: "testnet",
      privateKey: key.secretKey,
      defaultSignerId: "alice.near",
      keyStore,
      wallet: fixture.wallet,
    }
    function Child({ abandon = false }: { abandon?: boolean }) {
      const near = useNear()
      if (abandon) throw new Error("abandon this render")
      return (
        <span>
          {typeof near.view === "function"
            ? "child rendered"
            : "missing client"}
        </span>
      )
    }
    expect(
      renderToString(
        <NearProvider config={config}>
          <Child />
        </NearProvider>,
      ),
    ).toContain("child rendered")
    expect(() =>
      renderToString(
        <NearProvider config={config}>
          <Child abandon />
        </NearProvider>,
      ),
    ).toThrow("abandon this render")
    expect(writes).toBe(0)
    expect(fixture.counts.acquired).toBe(0)
  })

  test("StrictMode shares one live observer across account hooks and releases replacements", async () => {
    const first = observedWallet("alice.near")
    const second = observedWallet("bob.near")
    let config: NearConfig = { wallet: first.wallet }
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StrictMode>
        <NearProvider config={config}>{children}</NearProvider>
      </StrictMode>
    )
    const hook = renderHook(() => [useAccount(), useAccount()], { wrapper })
    await waitFor(() =>
      expect(hook.result.current.map((value) => value.accountId)).toEqual([
        "alice.near",
        "alice.near",
      ]),
    )
    expect(first.counts.active).toBe(1)
    expect(first.counts.peak).toBe(1)
    expect(first.counts.directReads).toBe(0)
    const beforeEvent = first.counts.acquired
    await act(async () => {
      await Effect.runPromise(
        SubscriptionRef.set(first.state, {
          _tag: "Ready",
          accounts: [{ accountId: "changed.near" }],
        }),
      )
    })
    await waitFor(() =>
      expect(hook.result.current.map((value) => value.accountId)).toEqual([
        "changed.near",
        "changed.near",
      ]),
    )
    expect(first.counts.acquired).toBe(beforeEvent)
    config = { wallet: second.wallet }
    hook.rerender()
    await waitFor(() =>
      expect(hook.result.current.map((value) => value.accountId)).toEqual([
        "bob.near",
        "bob.near",
      ]),
    )
    expect(first.counts.active).toBe(0)
    expect(first.counts.released).toBe(first.counts.acquired)
    expect(second.counts.active).toBe(1)
    hook.unmount()
    expect(second.counts.active).toBe(0)
    expect(second.counts.released).toBe(second.counts.acquired)
  })

  test("replacement waits for asynchronous cleanup before acquiring the next observer", async () => {
    const release = Deferred.makeUnsafe<void>()
    const first = observedWallet("alice.near", {
      release: Deferred.await(release),
    })
    const second = observedWallet("bob.near")
    let config: NearConfig = { wallet: first.wallet }
    const wrapper = ({ children }: { children: ReactNode }) => (
      <NearProvider config={config}>{children}</NearProvider>
    )
    const hook = renderHook(() => useAccount(), { wrapper })
    await waitFor(() =>
      expect(hook.result.current.accountId).toBe("alice.near"),
    )
    try {
      config = { wallet: second.wallet }
      hook.rerender()
      expect(first.counts.active).toBe(1)
      expect(second.counts.acquired).toBe(0)
      await act(async () => {
        await Effect.runPromise(Deferred.succeed(release, undefined))
        await Effect.runPromise(Deferred.await(second.acquired))
      })
      await waitFor(() =>
        expect(hook.result.current.accountId).toBe("bob.near"),
      )
      expect(first.counts.active).toBe(0)
      expect(second.counts.active).toBe(1)
    } finally {
      await Effect.runPromise(Deferred.succeed(release, undefined))
      hook.unmount()
    }
  })

  test("rapid replacements retain the oldest asynchronous cleanup barrier", async () => {
    const release = Deferred.makeUnsafe<void>()
    const first = observedWallet("alice.near", {
      release: Deferred.await(release),
    })
    const second = observedWallet("bob.near")
    const third = observedWallet("carol.near")
    let config: NearConfig = { wallet: first.wallet }
    const wrapper = ({ children }: { children: ReactNode }) => (
      <NearProvider config={config}>{children}</NearProvider>
    )
    const hook = renderHook(() => useAccount(), { wrapper })
    try {
      await waitFor(() =>
        expect(hook.result.current.accountId).toBe("alice.near"),
      )
      config = { wallet: second.wallet }
      await act(async () => hook.rerender())
      config = { wallet: third.wallet }
      await act(async () => hook.rerender())
      expect(first.counts.active).toBe(1)
      expect(second.counts.acquired).toBe(0)
      expect(third.counts.acquired).toBe(0)
      await act(async () => {
        await Effect.runPromise(Deferred.succeed(release, undefined))
      })
      await waitFor(() =>
        expect(hook.result.current.accountId).toBe("carol.near"),
      )
      expect(first.counts.active).toBe(0)
      expect(second.counts.acquired).toBe(0)
      expect(third.counts.active).toBe(1)
    } finally {
      await Effect.runPromise(Deferred.succeed(release, undefined))
      hook.unmount()
    }
    expect(third.counts.active).toBe(0)
  })

  test("an externally supplied Near retains its caller-owned observation after unmount", async () => {
    const fixture = observedWallet("alice.near")
    const prepared = Effect.runSync(prepareClient({ wallet: fixture.wallet }))
    const near = Near.fromClient(prepared.client)
    const owner = Effect.runFork(
      Effect.scoped(prepared.activate.pipe(Effect.andThen(Effect.never))),
    )
    const wrapper = ({ children }: { children: ReactNode }) => (
      <NearProvider near={near}>{children}</NearProvider>
    )
    const hook = renderHook(() => useAccount(), { wrapper })
    try {
      await waitFor(() =>
        expect(hook.result.current.accountId).toBe("alice.near"),
      )
      hook.unmount()
      expect(fixture.counts.active).toBe(1)
      expect(fixture.counts.released).toBe(0)
    } finally {
      await Effect.runPromise(Fiber.interrupt(owner))
    }
    expect(fixture.counts.active).toBe(0)
  })

  test("key readiness starts with signing and stays owned by that Promise across unmount", async () => {
    const key = generateKey()
    const release = Promise.withResolvers<void>()
    let writes = 0
    let stored: KeyPair | null = null
    const keyStore: KeyStore = {
      add: async (_accountId, value) => {
        writes++
        await release.promise
        stored = value
      },
      get: async () => stored,
      remove: async () => {},
      list: async () => [],
    }
    const config: NearConfig = {
      privateKey: key.secretKey,
      defaultSignerId: "alice.near",
      keyStore,
    }
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StrictMode>
        <NearProvider config={config}>{children}</NearProvider>
      </StrictMode>
    )
    const hook = renderHook(() => useNear(), { wrapper })
    expect(writes).toBe(0)
    const signed = hook.result.current.signMessage(message)
    expect(writes).toBe(1)
    hook.unmount()
    release.resolve()
    expect((await signed).publicKey).toBe(key.publicKey.toString())
    expect(writes).toBe(1)
  })

  test("closing provider observation does not interrupt a submitted wallet mutation", async () => {
    const submitted = Deferred.makeUnsafe<void>()
    const result = Deferred.makeUnsafe<FinalExecutionOutcome>()
    let finalized = false
    const fixture = observedWallet("alice.near", {
      submit: Deferred.succeed(submitted, undefined).pipe(
        Effect.andThen(Deferred.await(result)),
        Effect.ensuring(
          Effect.sync(() => {
            finalized = true
          }),
        ),
      ),
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <NearProvider config={{ wallet: fixture.wallet }}>
        {children}
      </NearProvider>
    )
    const hook = renderHook(
      () =>
        useCall<object, FinalExecutionOutcome>({
          contractId: "counter.near",
          method: "write",
          options: { waitUntil: "NONE" },
        }),
      { wrapper },
    )
    let mutation: Promise<FinalExecutionOutcome> | undefined
    await act(async () => {
      mutation = hook.result.current.mutate({})
      await Effect.runPromise(Deferred.await(submitted))
    })
    hook.unmount()
    expect(fixture.counts.active).toBe(0)
    expect(finalized).toBe(false)
    const outcome: FinalExecutionOutcome = { final_execution_status: "NONE" }
    await Effect.runPromise(Deferred.succeed(result, outcome))
    expect(await mutation).toBe(outcome)
    expect(finalized).toBe(true)
  })
})
