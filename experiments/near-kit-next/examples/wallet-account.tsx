/** Plain React application recipe. The app owns selector creation and its UI. */
import * as Near from "@near-kit/next"
import * as Effect from "effect/Effect"
import { useEffect, useMemo, useState } from "react"
import {
  initialWalletSnapshot,
  observeWalletSelector,
  type ReadSource,
  type WalletSetup,
  type WalletSnapshot,
} from "./wallet-selector-observation.js"

export interface WalletAccountProps {
  readonly setup: WalletSetup
  readonly source: ReadSource
  readonly enabled?: boolean
  readonly at?: Near.At
}

export function useWalletObservation(
  setup: WalletSetup,
  source: ReadSource,
): WalletSnapshot {
  const selector = setup.status === "ready" ? setup.selector : undefined
  const { client, sourceKey, networkId, revision } = source
  const setupStatus = setup.status
  const owner = useMemo(() => {
    const snapshot = Object.freeze({ client, sourceKey, networkId, revision })
    return {
      selector,
      source: snapshot,
      initial: initialWalletSnapshot(snapshot, setupStatus === "failed"),
    }
  }, [selector, setupStatus, client, sourceKey, networkId, revision])
  const [current, setCurrent] = useState<{
    readonly owner: typeof owner
    readonly snapshot: WalletSnapshot
  }>()
  useEffect(() => {
    if (owner.selector === undefined) return
    let live = true
    const observation = observeWalletSelector({
      selector: owner.selector,
      source: owner.source,
      onChange: (snapshot) => {
        if (live) setCurrent({ owner, snapshot })
      },
    })
    return () => {
      live = false
      observation.dispose()
    }
  }, [owner])
  // Suppress old account/source data during render, before effect cleanup runs.
  // SSR has this same stable initializing snapshot and performs no subscription.
  return current?.owner === owner ? current.snapshot : owner.initial
}

/** Query keys must encode bigint heights as decimal strings, never JSON bigint. */
export function blockIdentity(at: Near.At = "final"): readonly string[] {
  return typeof at === "string"
    ? ["finality", at]
    : "hash" in at
      ? ["hash", at.hash]
      : ["height", at.height.toString()]
}
function copyAt(at: Near.At): Near.At {
  return typeof at === "string" ? at : Object.freeze({ ...at })
}
export async function readWalletAccount(
  client: Near.Client,
  accountId: string,
  at: Near.At,
  signal: AbortSignal,
) {
  // Effect's runtime signal option is not a substitute for this application guard.
  signal.throwIfAborted()
  return Effect.runPromise(
    Near.account(client, accountId, { at }).pipe(
      Effect.match({
        onSuccess: (account) => ({ status: "ready" as const, account }),
        onFailure: (error) => ({ status: "failed" as const, error }),
      }),
      Effect.provide(Near.fetchLayer),
    ),
    { signal },
  )
}

type AccountResult = Awaited<ReturnType<typeof readWalletAccount>>
export function WalletAccount({
  setup,
  source,
  enabled = true,
  at = "final",
}: WalletAccountProps) {
  const wallet = useWalletObservation(setup, source)
  const identity = useMemo(
    () =>
      enabled && wallet.status === "connected" && !wallet.network.mismatch
        ? { wallet, at: copyAt(at) }
        : undefined,
    [enabled, wallet, at],
  )
  const [state, setState] = useState<{
    readonly identity: typeof identity
    readonly result:
      | AccountResult
      | { readonly status: "defect"; readonly cause: unknown }
  }>()
  useEffect(() => {
    if (identity === undefined) return
    const controller = new AbortController()
    let live = true
    void readWalletAccount(
      identity.wallet.source.client,
      identity.wallet.accountId,
      identity.at,
      controller.signal,
    ).then(
      (result) => {
        if (live) setState({ identity, result })
      },
      (cause) => {
        if (live) setState({ identity, result: { status: "defect", cause } })
      },
    )
    return () => {
      live = false
      controller.abort()
    }
  }, [identity])
  const notice = walletNotice(wallet, enabled)
  if (notice !== undefined) return <p>{notice}</p>
  const result = state?.identity === identity ? state?.result : undefined
  if (result === undefined) return <p>Reading account…</p>
  if (result.status === "defect") throw result.cause
  if (result.status === "failed") return <p>Could not read this account.</p>
  return <p>{result.account.amount.toString()} yoctoNEAR</p>
}

export function walletNotice(
  wallet: WalletSnapshot,
  enabled: boolean,
): string | undefined {
  if (!enabled) return "Account reads are disabled"
  if (wallet.status === "initializing") return "Loading wallet selection…"
  if (wallet.status === "observation-failed") return "Wallet observation failed"
  if (wallet.status === "disconnected") return "Choose a wallet account"
  if (wallet.network.mismatch)
    return "Wallet network differs from the configured read source"
  return undefined
}

// SSR application boundaries serialize amounts explicitly, e.g.
// JSON.stringify({ amount: account.amount.toString() }); hydrate using
// BigInt(payload.amount) after validating a canonical bounded decimal string.
// Neither the wallet selector nor this example is initialized by server render.
