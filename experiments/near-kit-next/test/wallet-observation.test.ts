// Controlled connector evidence: real RxJS public Observable semantics, a typed
// mock of only WalletSelector's observation seam. No actual wallet is initialized
// or used. These tests do not establish extension/mobile/hardware compatibility.
import * as Near from "@near-kit/next"
import type {
  WalletSelector,
  WalletSelectorEvents,
  WalletSelectorState,
} from "@near-wallet-selector/core"
import {
  QueryClient,
  QueryClientProvider,
  QueryObserver,
} from "@tanstack/react-query"
import { createElement } from "react"
import { renderToString } from "react-dom/server"
import { BehaviorSubject, config, Observable, Subject } from "rxjs"
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import { readWalletAccount, WalletAccount } from "../examples/wallet-account.js"
import {
  WalletQueryAccount,
  walletAccountQueryOptions,
} from "../examples/wallet-query.js"
import {
  initialWalletSnapshot,
  observeWalletSelector,
  type ReadSource,
  type SelectorObservation,
  type WalletSnapshot,
} from "../examples/wallet-selector-observation.js"

const source = (revision = 0): ReadSource => ({
  client: Near.make({ url: "https://rpc.example.test" }),
  sourceKey: "public-test-fixture",
  networkId: "testnet",
  revision,
})
const state = (
  accountId: string | null = "alice.testnet",
  walletId = "wallet-a",
): WalletSelectorState => ({
  contract: null,
  modules: [],
  accounts: accountId === null ? [] : [{ accountId, active: true }],
  selectedWalletId: accountId === null ? null : walletId,
  recentlySignedInWallets: [],
  rememberRecentWallets: "",
})
function fixture(initial = state()) {
  const subject = new BehaviorSubject(initial)
  const listeners = new Map<
    keyof WalletSelectorEvents,
    Set<(event: never) => void>
  >()
  const removed = vi.fn()
  const on: WalletSelector["on"] = (name, callback) => {
    const own = callback as (event: never) => void
    const group = listeners.get(name) ?? new Set<(event: never) => void>()
    listeners.set(name, group)
    group.add(own)
    return {
      remove: () => {
        group.delete(own)
        removed(name)
      },
    }
  }
  const selector: SelectorObservation = {
    store: {
      getState: vi.fn(() => subject.getValue()),
      observable: subject.asObservable(),
    },
    on,
    options: {
      network: {
        networkId: "testnet",
        nodeUrl: "https://not-the-app-rpc.invalid",
        helperUrl: "",
        explorerUrl: "",
        indexerUrl: "",
      },
      languageCode: undefined,
      debug: false,
      optimizeWalletOrder: false,
      randomizeWalletOrder: false,
      relayerUrl: undefined,
    },
  }
  const emit = <K extends keyof WalletSelectorEvents>(
    name: K,
    event: WalletSelectorEvents[K],
  ) => {
    for (const callback of [...(listeners.get(name) ?? [])])
      callback(event as never)
  }
  const snapshots: WalletSnapshot[] = []
  const start = (binding = source()) =>
    observeWalletSelector({
      selector,
      source: binding,
      onChange: (next) => snapshots.push(next),
    })
  return { subject, selector, emit, removed, listeners, snapshots, start }
}
const wire = {
  amount: "1234567890123456789012345",
  locked: "0",
  storage_usage: 0,
  code_hash: "11111111111111111111111111111111",
  block_height: 0,
  block_hash: "11111111111111111111111111111111",
}
const successFetch: typeof fetch = async (_input, init) => {
  const request = JSON.parse(String(init?.body)) as { id: unknown }
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", id: request.id, result: wire }),
  )
}
// Effect's default Fetch reference is memoized on first use. Install one
// delegating transport rather than replacing a captured global between tests.
let currentFetch: typeof globalThis.fetch = successFetch
beforeAll(() =>
  vi.stubGlobal("fetch", (...args: Parameters<typeof globalThis.fetch>) =>
    currentFetch(...args),
  ),
)
afterEach(() => {
  currentFetch = successFetch
})
afterAll(() => vi.unstubAllGlobals())

describe("WalletSelector 10.1.4 public observation seam (mocked connector)", () => {
  it("uses the explicitly active account and the synchronous BehaviorSubject snapshot", () => {
    const input = state()
    input.accounts.unshift({ accountId: "inactive.testnet", active: false })
    const f = fixture(input)
    const binding = source()
    const observation = f.start(binding)
    expect(observation.getSnapshot()).toMatchObject({
      status: "connected",
      accountId: "alice.testnet",
      revision: 1,
    })
    expect(f.selector.store.getState).not.toHaveBeenCalled()
    expect(observation.getSnapshot().source).not.toBe(binding)
    expect(Object.isFrozen(observation.getSnapshot())).toBe(true)
    expect(Object.isFrozen(observation.getSnapshot().network)).toBe(true)
    observation.dispose()
  })

  it("never picks the first account when active selection is missing or ambiguous", () => {
    const input = state()
    const first = input.accounts[0]
    if (first === undefined) throw new Error("Missing first account")
    first.active = false
    const f = fixture(input)
    const observation = f.start()
    expect(observation.getSnapshot()).toMatchObject({
      status: "observation-failed",
      reason: "selection",
    })
    f.subject.next({
      ...state(),
      accounts: [
        { accountId: "alice.testnet", active: true },
        { accountId: "bob.testnet", active: true },
      ],
    })
    expect(observation.getSnapshot().status).toBe("observation-failed")
    f.subject.next(state("bob.testnet"))
    expect(observation.getSnapshot()).toMatchObject({
      status: "connected",
      accountId: "bob.testnet",
    })
    f.subject.next(state(null))
    expect(observation.getSnapshot().status).toBe("disconnected")
    observation.dispose()
  })

  it("advances synchronously through batched A→B→A and logout/reconnect", () => {
    const f = fixture()
    const observation = f.start()
    const first = observation.getSnapshot()
    f.subject.next(state("bob.testnet"))
    f.subject.next(state("alice.testnet"))
    const returned = observation.getSnapshot()
    expect(returned.revision).toBe(first.revision + 2)
    expect(returned.sessionRevision).toBeGreaterThan(first.sessionRevision)
    expect(
      f.snapshots
        .filter((s) => s.status === "connected")
        .map((s) => s.accountId),
    ).toEqual(["alice.testnet", "bob.testnet", "alice.testnet"])
    f.subject.next(state(null))
    f.subject.next(state())
    expect(observation.getSnapshot().revision).toBe(returned.revision + 2)
    observation.dispose()
  })

  it("distinguishes configured from observed network and ignores unselected-wallet events", () => {
    const f = fixture()
    f.selector.options.network.networkId = "mainnet"
    const observation = f.start()
    expect(observation.getSnapshot().network).toMatchObject({
      configuredNetworkId: "mainnet",
      kind: "unknown",
      observedNetworkId: undefined,
      mismatch: false,
    })
    const before = observation.getSnapshot()
    f.emit("networkChanged", { walletId: "unselected", networkId: "mainnet" })
    expect(observation.getSnapshot()).toBe(before)
    f.emit("networkChanged", { walletId: "wallet-a", networkId: "mainnet" })
    expect(observation.getSnapshot().network).toMatchObject({
      kind: "event",
      mismatch: true,
      observedNetworkId: "mainnet",
    })
    expect(walletAccountQueryOptions(observation.getSnapshot()).enabled).toBe(
      false,
    )
    f.emit("networkChanged", { walletId: "wallet-a", networkId: "testnet" })
    expect(walletAccountQueryOptions(observation.getSnapshot()).enabled).toBe(
      true,
    )
    expect(observation.getSnapshot().network.freshness).toBe(
      "no-event-generation-token",
    )
    observation.dispose()
  })

  it("clears network observations on wallet/session replacement and remount", () => {
    const f = fixture()
    const binding = source()
    const observation = f.start(binding)
    f.emit("networkChanged", { walletId: "wallet-a", networkId: "mainnet" })
    const firstSession = observation.getSnapshot().sessionRevision
    f.emit("signedIn", {
      walletId: "wallet-a",
      contractId: "example.testnet",
      methodNames: [],
      accounts: [{ accountId: "alice.testnet" }],
    })
    expect(observation.getSnapshot().network.kind).toBe("unknown")
    expect(observation.getSnapshot().sessionRevision).toBeGreaterThan(
      firstSession,
    )
    f.emit("networkChanged", { walletId: "wallet-a", networkId: "mainnet" })
    f.subject.next(state("alice.testnet", "wallet-b"))
    expect(observation.getSnapshot().network.kind).toBe("unknown")
    const selected = observation.getSnapshot()
    f.emit("networkChanged", { walletId: "wallet-a", networkId: "mainnet" })
    expect(observation.getSnapshot()).toBe(selected)
    observation.dispose()
    f.emit("networkChanged", { walletId: "wallet-b", networkId: "mainnet" })
    const remount = f.start(binding)
    expect(remount.getSnapshot().network.kind).toBe("unknown")
    expect(remount.getSnapshot().observerId).not.toBe(selected.observerId)
    // A delayed event from the same wallet cannot be identified as stale by this
    // upstream API. Record it as an event without asserting generation freshness.
    f.emit("networkChanged", { walletId: "wallet-b", networkId: "mainnet" })
    expect(remount.getSnapshot().network).toMatchObject({
      mismatch: true,
      freshness: "no-event-generation-token",
    })
    remount.dispose()
  })

  it.each([
    "error",
    "complete",
  ] as const)("turns store %s into observation-failed and releases owned subscriptions", (termination) => {
    const f = fixture()
    const other = vi.fn()
    const external = f.selector.on("networkChanged", other)
    const observation = f.start()
    if (termination === "error")
      f.subject.error(new Error("private connector detail"))
    else f.subject.complete()
    expect(observation.getSnapshot()).toMatchObject({
      status: "observation-failed",
      reason: termination === "error" ? "store-error" : "store-completed",
    })
    expect(JSON.stringify(observation.getSnapshot())).not.toContain(
      "private connector detail",
    )
    expect(f.subject.observed).toBe(false)
    expect(f.listeners.get("networkChanged")?.size).toBe(1)
    f.emit("networkChanged", { walletId: "wallet-a", networkId: "testnet" })
    expect(other).toHaveBeenCalledTimes(1)
    observation.dispose()
    expect(f.removed).toHaveBeenCalledTimes(2)
    external.remove()
  })

  it("releases subscriptions even when failure delivery throws an application defect", async () => {
    const f = fixture()
    const defect = new Error("application callback failed")
    const previous = config.onUnhandledError
    const errors: unknown[] = []
    config.onUnhandledError = (error) => {
      errors.push(error)
    }
    try {
      observeWalletSelector({
        selector: f.selector,
        source: source(),
        onChange: (value) => {
          if (value.status === "observation-failed") throw defect
        },
      })
      f.subject.error(new Error("connector failure"))
      expect(f.subject.observed).toBe(false)
      expect(f.listeners.get("networkChanged")?.size).toBe(0)
      expect(f.listeners.get("signedIn")?.size).toBe(0)
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(errors).toEqual([defect])
    } finally {
      config.onUnhandledError = previous
    }
  })

  it("does not misclassify a connected callback defect as a connector failure", async () => {
    const f = fixture()
    const defect = new Error("connected callback failed")
    const previous = config.onUnhandledError
    const errors: unknown[] = []
    config.onUnhandledError = (error) => {
      errors.push(error)
    }
    try {
      const observation = observeWalletSelector({
        selector: f.selector,
        source: source(),
        onChange: () => {
          throw defect
        },
      })
      expect(observation.getSnapshot().status).toBe("connected")
      expect(f.subject.observed).toBe(false)
      expect(f.listeners.get("networkChanged")?.size).toBe(0)
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(errors).toEqual([defect])
      const fallback = fixture()
      fallback.selector.store.observable =
        new Subject<WalletSelectorState>().asObservable()
      expect(() =>
        observeWalletSelector({
          selector: fallback.selector,
          source: source(),
          onChange: () => {
            throw defect
          },
        }),
      ).toThrow(defect)
      expect(fallback.listeners.get("networkChanged")?.size).toBe(0)
      expect(fallback.listeners.get("signedIn")?.size).toBe(0)
    } finally {
      config.onUnhandledError = previous
    }
  })

  it.each([
    "error",
    "complete",
  ] as const)("ignores a stale bootstrap error after reentrant store %s", (termination) => {
    const f = fixture()
    const subject = new Subject<WalletSelectorState>()
    f.selector.store.observable = subject.asObservable()
    f.selector.store.getState = () => {
      if (termination === "error") subject.error(new Error("current failure"))
      else subject.complete()
      throw new Error("stale bootstrap failure")
    }
    const observation = f.start()
    expect(observation.getSnapshot()).toMatchObject({
      status: "observation-failed",
      reason: termination === "error" ? "store-error" : "store-completed",
    })
    expect(subject.observed).toBe(false)
    expect(f.listeners.get("networkChanged")?.size).toBe(0)
    expect(f.listeners.get("signedIn")?.size).toBe(0)
  })

  it("unwinds synchronous partial registration failures", () => {
    const f = fixture()
    const on = f.selector.on
    f.selector.on = ((name, callback) => {
      if (name === "signedIn") throw new Error("registration failed")
      return on(name, callback)
    }) as WalletSelector["on"]
    const observation = f.start()
    expect(observation.getSnapshot()).toMatchObject({
      status: "observation-failed",
      reason: "registration",
    })
    expect(f.listeners.get("networkChanged")?.size).toBe(0)
    expect(f.subject.observed).toBe(false)
    observation.dispose()
  })

  it.each([
    "error",
    "complete",
  ] as const)("unwinds an observable that synchronously %ss while subscribing", (termination) => {
    const f = fixture()
    const release = vi.fn()
    f.selector.store.observable = new Observable((subscriber) => {
      if (termination === "error") subscriber.error(new Error("failure"))
      else subscriber.complete()
      return release
    })
    const observation = f.start()
    expect(observation.getSnapshot().status).toBe("observation-failed")
    expect(release).toHaveBeenCalledOnce()
    expect(f.removed).toHaveBeenCalledTimes(2)
    observation.dispose()
  })

  it.each([
    false,
    true,
  ])("ignores a reentrant stale bootstrap %s after newer store delivery", (throws) => {
    const f = fixture()
    const subject = new Subject<WalletSelectorState>()
    f.selector.store.observable = subject.asObservable()
    f.selector.store.getState = () => {
      subject.next(state("newer.testnet"))
      if (throws) throw new Error("old bootstrap failed")
      return state("older.testnet")
    }
    const observation = f.start()
    expect(observation.getSnapshot()).toMatchObject({
      status: "connected",
      accountId: "newer.testnet",
    })
    observation.dispose()
  })

  it("marks disposal before cleanup and ignores retained late event callbacks", () => {
    const f = fixture()
    const observation = f.start()
    const callbacks = [...(f.listeners.get("networkChanged") ?? [])]
    const before = observation.getSnapshot()
    observation.dispose()
    observation.dispose()
    callbacks.forEach((callback) => {
      callback({ walletId: "wallet-a", networkId: "mainnet" } as never)
    })
    f.subject.next(state("late.testnet"))
    expect(observation.getSnapshot()).toBe(before)
    expect(f.subject.observed).toBe(false)
    expect(f.removed).toHaveBeenCalledTimes(2)
  })
})

describe("copy-runnable React/query consumers using public near-kit imports", () => {
  it("renders stable initializing/setup failure/disabled SSR without acquiring a connector or fetching", () => {
    const f = fixture()
    const fetch = vi.fn(successFetch)
    currentFetch = fetch
    const binding = source()
    const props = {
      setup: { status: "ready" as const, selector: f.selector },
      source: binding,
    }
    const first = renderToString(createElement(WalletAccount, props))
    expect(first).toBe("<p>Loading wallet selection…</p>")
    expect(renderToString(createElement(WalletAccount, props))).toBe(first)
    expect(
      renderToString(
        createElement(WalletAccount, { ...props, setup: { status: "failed" } }),
      ),
    ).toContain("Wallet observation failed")
    expect(
      renderToString(
        createElement(WalletAccount, { ...props, enabled: false }),
      ),
    ).toContain("Account reads are disabled")
    const client = new QueryClient()
    expect(
      renderToString(
        createElement(
          QueryClientProvider,
          { client },
          createElement(WalletQueryAccount, props),
        ),
      ),
    ).toContain("Loading wallet selection")
    expect(client.getQueryCache().getAll()).toHaveLength(0)
    expect(f.subject.observed).toBe(false)
    expect(f.selector.store.getState).not.toHaveBeenCalled()
    expect(f.listeners.size).toBe(0)
    expect(fetch).not.toHaveBeenCalled()
    client.clear()
  })

  it("keys source/account/block/observer/session/revision and gives disabled reads a different key", () => {
    const f = fixture()
    const binding = source()
    const observation = f.start(binding)
    const first = observation.getSnapshot()
    const query = walletAccountQueryOptions(first, true, {
      height: 18446744073709551615n,
    })
    expect(query.queryKey).toEqual([
      "near.account",
      binding.sourceKey,
      0,
      "testnet",
      "alice.testnet",
      ["height", "18446744073709551615"],
      first.observerId,
      first.sessionRevision,
      first.revision,
      "enabled",
    ])
    expect(() => JSON.stringify(query.queryKey)).not.toThrow()
    expect(walletAccountQueryOptions(first, false).queryKey).not.toEqual(
      walletAccountQueryOptions(first).queryKey,
    )
    f.subject.next(state("bob.testnet"))
    f.subject.next(state("alice.testnet"))
    expect(
      walletAccountQueryOptions(observation.getSnapshot()).queryKey,
    ).not.toEqual(walletAccountQueryOptions(first).queryKey)
    const replaced = f.start({ ...binding, revision: 1 })
    expect(
      walletAccountQueryOptions(replaced.getSnapshot()).queryKey,
    ).not.toEqual(walletAccountQueryOptions(first).queryKey)
    observation.dispose()
    replaced.dispose()
  })

  it("pre-abort guards prevent native Effect and query execution from reaching fetch", async () => {
    const fetch = vi.fn(successFetch)
    currentFetch = fetch
    const controller = new AbortController()
    controller.abort()
    const f = fixture()
    const observation = f.start()
    await expect(
      readWalletAccount(
        source().client,
        "alice.testnet",
        "final",
        controller.signal,
      ),
    ).rejects.toBeDefined()
    expect(() =>
      walletAccountQueryOptions(observation.getSnapshot()).queryFn({
        signal: controller.signal,
      }),
    ).toThrow()
    expect(fetch).not.toHaveBeenCalled()
    observation.dispose()
  })

  it("executes a public native Effect read and deliberately serializes SSR bigint data", async () => {
    currentFetch = successFetch
    const result = await readWalletAccount(
      source().client,
      "alice.testnet",
      "final",
      new AbortController().signal,
    )
    expect(result.status).toBe("ready")
    if (result.status !== "ready") throw new Error("Expected fixture read")
    expect(result.account.amount).toBe(1234567890123456789012345n)
    const json = JSON.stringify({ amount: result.account.amount.toString() })
    const payload: { amount: string } = JSON.parse(json)
    expect(BigInt(payload.amount)).toBe(result.account.amount)
  })

  it("query option changes cancel pending reads on disable, logout and source/session replacement", async () => {
    const aborted: boolean[] = []
    const fetch = vi.fn<typeof globalThis.fetch>(
      async (_input, init) =>
        new Promise((_resolve, reject) => {
          const index = aborted.push(false) - 1
          init?.signal?.addEventListener(
            "abort",
            () => {
              aborted[index] = true
              reject(new DOMException("Aborted", "AbortError"))
            },
            { once: true },
          )
        }),
    )
    currentFetch = fetch
    const f = fixture()
    const observation = f.start()
    const client = new QueryClient()
    const query = new QueryObserver(
      client,
      walletAccountQueryOptions(observation.getSnapshot()),
    )
    const unsubscribe = query.subscribe(() => {})
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    query.setOptions(
      walletAccountQueryOptions(observation.getSnapshot(), false),
    )
    await vi.waitFor(() => expect(aborted[0]).toBe(true))
    expect(query.getCurrentResult().data).toBeUndefined()
    query.setOptions(walletAccountQueryOptions(observation.getSnapshot()))
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    f.subject.next(state(null))
    query.setOptions(walletAccountQueryOptions(observation.getSnapshot()))
    await vi.waitFor(() => expect(aborted[1]).toBe(true))
    f.subject.next(state())
    query.setOptions(walletAccountQueryOptions(observation.getSnapshot()))
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3))
    const replaced = f.start(source(1))
    query.setOptions(walletAccountQueryOptions(replaced.getSnapshot()))
    await vi.waitFor(() => expect(aborted[2]).toBe(true))
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(4))
    unsubscribe()
    await vi.waitFor(() => expect(aborted[3]).toBe(true))
    observation.dispose()
    replaced.dispose()
    client.clear()
  })

  it("keeps initializing and failed setup distinct from disconnected query state", () => {
    const binding = source()
    const initializing = initialWalletSnapshot(binding)
    const failed = initialWalletSnapshot(binding, true)
    expect(initializing.status).toBe("initializing")
    expect(failed.status).toBe("observation-failed")
    expect(walletAccountQueryOptions(initializing).enabled).toBe(false)
    expect(walletAccountQueryOptions(failed).enabled).toBe(false)
  })
})
