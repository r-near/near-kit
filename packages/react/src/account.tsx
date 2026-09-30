"use client"

import { Effect } from "effect"
import { useMemo } from "react"
import { external, useQuery } from "./effect-state.js"

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
 * Note: This hook accesses internal Near client state which may change between versions.
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
  const program = useMemo(
    () =>
      near.effects?.getConnectedAccountId
        ? near.effects.getConnectedAccountId()
        : external(async () => {
            // Application-provided legacy clients can expose their account source.
            const legacy = near as unknown as {
              wallet?: { getAccounts(): Promise<Array<{ accountId: string }>> }
              defaultSignerId?: string
            }
            const accounts = await legacy.wallet?.getAccounts()
            return accounts?.[0]?.accountId ?? legacy.defaultSignerId
          }).pipe(Effect.orElseSucceed(() => undefined)),
    [near],
  )
  const { data: accountId, isLoading, refetch } = useQuery(program, true)
  return { accountId, isConnected: accountId !== undefined, isLoading, refetch }
}
