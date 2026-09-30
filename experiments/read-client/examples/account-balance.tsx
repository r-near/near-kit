// The application owns wallet selection and increments revision on every
// accepted session/account/network change, including batched A → B → A.
type Selection =
  | { readonly _tag: "Loading" }
  | { readonly _tag: "Disconnected" }
  | { readonly _tag: "Failed"; readonly message: string }
  | {
      readonly _tag: "Connected"
      readonly accountId: string
      readonly rpcUrl: string
      readonly revision: number
    }

import { Effect } from "effect"
import { Near } from "@near-kit/read-experiment"
import { useEffect, useMemo, useState } from "react"

async function readAccount(
  client: ReturnType<typeof Near.make>,
  accountId: string,
  signal: AbortSignal,
) {
  signal.throwIfAborted()
  return Effect.runPromise(
    client.account(accountId).pipe(
      Effect.match({
        onSuccess: (account) => ({ _tag: "Ready" as const, account }),
        onFailure: (error) => ({ _tag: "Failed" as const, error }),
      }),
      Effect.provide(Near.fetchLayer),
    ),
    { signal },
  )
}

type ReadIdentity = {
  readonly client: ReturnType<typeof Near.make>
  readonly accountId: string
  readonly revision: number
}

type ReadState = { readonly identity: ReadIdentity } & (
  | Awaited<ReturnType<typeof readAccount>>
  | { readonly _tag: "Defect"; readonly cause: unknown }
)

export function AccountBalance({ selection }: { selection: Selection }) {
  const rpcUrl = selection._tag === "Connected" ? selection.rpcUrl : undefined
  const accountId = selection._tag === "Connected" ? selection.accountId : undefined
  const revision = selection._tag === "Connected" ? selection.revision : undefined
  const client = useMemo(
    () => rpcUrl === undefined ? undefined : Near.make({ url: rpcUrl }),
    [rpcUrl],
  )
  const identity = useMemo(
    () => client === undefined || accountId === undefined || revision === undefined
      ? undefined
      : { client, accountId, revision },
    [client, accountId, revision],
  )
  const [state, setState] = useState<ReadState>()

  useEffect(() => {
    if (identity === undefined) return
    const { client, accountId } = identity
    const controller = new AbortController()
    let current = true

    void readAccount(client, accountId, controller.signal).then(
      (result) => {
        if (current) setState({ ...result, identity })
      },
      (cause) => {
        if (current) setState({ _tag: "Defect", identity, cause })
      },
    )

    return () => {
      current = false
      controller.abort()
    }
  }, [identity])

  if (selection._tag === "Loading") return <p>Loading wallet selection…</p>
  if (selection._tag === "Disconnected") return <p>Choose a wallet account</p>
  if (selection._tag === "Failed") return <p>{selection.message}</p>

  // Compare identity during render, not only after an effect has committed.
  // This prevents showing old data for one frame under new account/network props.
  const current = state !== undefined && state.identity === identity
    ? state
    : undefined
  if (current === undefined) return <p>Reading account…</p>
  if (current._tag === "Defect") throw current.cause
  if (current._tag === "Failed") return <p>Could not read this account.</p>
  return <p>{current.account.amount.toString()} yoctoNEAR</p>
}
