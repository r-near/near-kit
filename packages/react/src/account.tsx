"use client"

import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import type { WalletAccountObservation } from "near-kit/effect"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useQuery } from "./effect-state.js"

import { useNear } from "./provider.js"

/**
 * Account state returned by useAccount
 */
export interface AccountState {
  /** The connected account ID, if any */
  accountId: string | undefined
  /** Whether any account is connected */
  isConnected: boolean
  /** Whether the account state is still being fetched */
  isLoading: boolean
  /** Function to refresh the account state */
  refetch: () => Promise<void>
}

/**
 * Hook to get the current account state.
 *
 * Derives state from whichever signer/wallet was passed to the Near client
 * (via wallet, privateKey, keyStore, etc.).
 *
 * Uses the native account-reader capability; it does not inspect private client state.
 *
 * @example
 * ```tsx
 * function Header() {
 *   const { accountId, isConnected, isLoading } = useAccount()
 *
 *   if (isLoading) return <>Loading...</>
 *   if (!isConnected) return <>Not connected</>
 *   return <>Connected as {accountId}</>
 * }
 * ```
 */
export function useAccount(): AccountState {
  const near = useNear()
  const observation = near.walletAccounts
  const program = useMemo(() => near.effects.getConnectedAccountId(), [near])
  const query = useQuery(program, !observation)
  const queryRefetch = query.refetch
  const latest = useRef<{ source: WalletAccountObservation } | undefined>(
    undefined,
  )
  const [observed, setObserved] = useState<{
    source: WalletAccountObservation | undefined
    accountId: string | undefined
    isLoading: boolean
  }>({ source: undefined, accountId: undefined, isLoading: true })
  useEffect(() => {
    if (!observation) return
    const owner = { source: observation }
    latest.current = owner
    const fiber = Effect.runFork(
      observation.changes.pipe(
        Stream.mapEffect((state) =>
          state._tag === "Loading"
            ? Effect.succeed({ accountId: undefined, isLoading: true })
            : program.pipe(
                Effect.map((accountId) => ({ accountId, isLoading: false })),
              ),
        ),
        Stream.runForEach((value) =>
          Effect.sync(() => {
            if (latest.current === owner)
              setObserved({ source: observation, ...value })
          }),
        ),
      ),
    )
    return () => {
      latest.current = undefined
      fiber.interruptUnsafe()
    }
  }, [observation, program])
  const refetch = useCallback(() => {
    if (!observation) return queryRefetch()
    const owner = latest.current
    return Effect.runPromise(
      program.pipe(
        Effect.tap((accountId) =>
          Effect.sync(() => {
            if (owner?.source === observation && latest.current === owner)
              setObserved({ source: observation, accountId, isLoading: false })
          }),
        ),
        Effect.asVoid,
      ),
    )
  }, [observation, program, queryRefetch])
  const { accountId, isLoading } = observation
    ? observed.source === observation
      ? observed
      : { accountId: undefined, isLoading: true }
    : { accountId: query.data, isLoading: query.isLoading }
  return { accountId, isConnected: accountId !== undefined, isLoading, refetch }
}
