/**
 * Observation-only integration for @near-wallet-selector/core@10.1.4.
 * The app supplies an already-created selector. No wallet/module initialization,
 * connection, switching, signing or sign-out is performed here.
 *
 * This optional example needs the upstream declaration dependency @types/node:
 * 10.1.4's public declarations refer to global Buffer. The import below is erased;
 * neither this recipe nor near-kit installs a runtime Buffer shim. Its published
 * extensionless ESM declarations also require a separate Bundler-resolution
 * consumer check. Keep skipLibCheck:false and the core/data/units NodeNext and
 * browser-only checks strict; do not hide these upstream requirements there.
 * tsconfig.wallet.json also maps two broken upstream type-only references,
 * @near-js/types/lib/esm/provider/{protocol,response}, to their actual installed
 * .d.ts files. These are compiler paths only, not runtime aliases or type shims.
 */
import type { Client } from "@near-kit/next"
import type {
  WalletSelector,
  WalletSelectorState,
} from "@near-wallet-selector/core"

/** A real public selector can be passed directly; tests mock only this seam. */
export type SelectorObservation = Pick<
  WalletSelector,
  "options" | "store" | "on"
>
export type WalletSetup =
  | { readonly status: "initializing" }
  | { readonly status: "failed" }
  | { readonly status: "ready"; readonly selector: SelectorObservation }

/** Immutable application binding. Never put RPC URLs/credentials in sourceKey. */
export interface ReadSource {
  readonly client: Client
  readonly sourceKey: string
  readonly networkId: string
  /** Advance for endpoint/credential changes and local-chain resets. */
  readonly revision: number
}
export interface NetworkKnowledge {
  readonly configuredNetworkId: string
  /** Setup data is not a replayed observation of the wallet's current network. */
  readonly kind: "unknown" | "event"
  readonly observedNetworkId: string | undefined
  readonly mismatch: boolean
  /** Even a matching event cannot prove freshness or authenticate the RPC chain. */
  readonly freshness: "no-event-generation-token"
}
interface Identity {
  readonly observerId: string
  readonly revision: number
  readonly sessionRevision: number
  readonly source: ReadSource
  readonly network: NetworkKnowledge
}
export type WalletSnapshot = Identity &
  (
    | { readonly status: "initializing" }
    | { readonly status: "disconnected" }
    | {
        readonly status: "observation-failed"
        readonly reason:
          | "setup"
          | "selection"
          | "registration"
          | "store-error"
          | "store-completed"
      }
    | {
        readonly status: "connected"
        readonly accountId: string
        readonly walletId: string
      }
  )

let observerSequence = 0
export function initialWalletSnapshot(
  source: ReadSource,
  failed = false,
): WalletSnapshot {
  return Object.freeze({
    observerId: "not-subscribed",
    revision: 0,
    sessionRevision: 0,
    source: Object.freeze({ ...source }),
    network: Object.freeze({
      configuredNetworkId: "unknown",
      kind: "unknown" as const,
      observedNetworkId: undefined,
      mismatch: false,
      freshness: "no-event-generation-token" as const,
    }),
    ...(failed
      ? { status: "observation-failed" as const, reason: "setup" as const }
      : { status: "initializing" as const }),
  })
}

export function observeWalletSelector({
  selector,
  source: suppliedSource,
  onChange,
}: {
  readonly selector: SelectorObservation
  readonly source: ReadSource
  readonly onChange: (snapshot: WalletSnapshot) => void
}): {
  readonly getSnapshot: () => WalletSnapshot
  readonly dispose: () => void
} {
  const source = Object.freeze({ ...suppliedSource })
  const observerId = `wallet-observer-${++observerSequence}`
  let revision = 0
  let sessionRevision = 0
  let stopped = false
  let walletId: string | null = null
  let accountId: string | undefined
  let observedNetworkId: string | undefined
  let configuredNetworkId = "unknown"
  let snapshot = initialWalletSnapshot(source)
  const cleanups: Array<() => void> = []
  const acquire = (cleanup: () => void) => {
    // An Observable may fail/complete synchronously inside subscribe().
    if (stopped) cleanup()
    else cleanups.push(cleanup)
  }
  const dispose = () => {
    if (stopped) return
    stopped = true // Ignore reentrant/delayed events before removing our listeners.
    for (const cleanup of cleanups.splice(0).reverse()) {
      try {
        cleanup()
      } catch {
        /* Still release the remaining owned subscriptions. */
      }
    }
  }
  const network = (): NetworkKnowledge =>
    Object.freeze({
      configuredNetworkId,
      kind: observedNetworkId === undefined ? "unknown" : "event",
      observedNetworkId,
      mismatch:
        observedNetworkId !== undefined &&
        observedNetworkId !== source.networkId,
      freshness: "no-event-generation-token",
    })
  const publish = (
    state:
      | { readonly status: "disconnected" }
      | {
          readonly status: "connected"
          readonly accountId: string
          readonly walletId: string
        }
      | {
          readonly status: "observation-failed"
          readonly reason: Extract<
            WalletSnapshot,
            { status: "observation-failed" }
          >["reason"]
        },
  ) => {
    if (stopped) return
    snapshot = Object.freeze({
      ...state,
      observerId,
      source,
      network: network(),
      revision: ++revision,
      sessionRevision,
    })
    try {
      onChange(snapshot)
    } catch (error) {
      dispose()
      throw error
    }
  }
  const fail = (
    reason: Extract<WalletSnapshot, { status: "observation-failed" }>["reason"],
  ) => {
    if (stopped) return
    try {
      publish({ status: "observation-failed", reason })
    } finally {
      dispose()
    }
  }
  const replaceSession = () => {
    sessionRevision += 1
    observedNetworkId = undefined
  }
  const acceptState = (state: WalletSelectorState) => {
    if (stopped) return
    const active = state.accounts.filter((account) => account.active)
    const nextAccount = active.length === 1 ? active[0]?.accountId : undefined
    if (walletId !== state.selectedWalletId || accountId !== nextAccount)
      replaceSession()
    walletId = state.selectedWalletId
    accountId = nextAccount
    if (state.accounts.length === 0) {
      publish({ status: "disconnected" })
    } else if (
      walletId === null ||
      accountId === undefined ||
      active.length !== 1
    ) {
      publish({ status: "observation-failed", reason: "selection" })
    } else {
      publish({ status: "connected", walletId, accountId })
    }
  }
  try {
    configuredNetworkId = selector.options.network.networkId
    // Events are acquired before the synchronous current-state bootstrap. The
    // public observable in 10.1.4 is backed by a real RxJS BehaviorSubject.
    const changed = selector.on("networkChanged", (event) => {
      if (
        stopped ||
        snapshot.status !== "connected" ||
        event.walletId !== walletId
      )
        return
      observedNetworkId = event.networkId
      publish({
        status: "connected",
        walletId: snapshot.walletId,
        accountId: snapshot.accountId,
      })
    })
    acquire(() => changed.remove())
    // A same-wallet sign-in may replace a session without changing its account.
    const signedIn = selector.on("signedIn", (event) => {
      if (
        stopped ||
        snapshot.status !== "connected" ||
        event.walletId !== walletId
      )
        return
      replaceSession()
      publish({
        status: "connected",
        walletId: snapshot.walletId,
        accountId: snapshot.accountId,
      })
    })
    acquire(() => signedIn.remove())
    const subscription = selector.store.observable.subscribe({
      next: (state) => {
        try {
          acceptState(state)
        } catch (error) {
          if (stopped) throw error
          fail("store-error")
        }
      },
      error: () => fail("store-error"),
      complete: () => fail("store-completed"),
    })
    acquire(() => subscription.unsubscribe())
    // The supported BehaviorSubject emits synchronously, so this is normally
    // unnecessary. Guard the public getState fallback against reentrant events.
    if (!stopped && revision === 0) {
      const ticket = revision
      try {
        const current = selector.store.getState()
        if (!stopped && revision === ticket) acceptState(current)
      } catch (error) {
        if (stopped) throw error
        if (revision === ticket) fail("store-error")
      }
    }
  } catch (error) {
    if (stopped) throw error
    fail("registration")
  }
  return { getSnapshot: () => snapshot, dispose }
}
