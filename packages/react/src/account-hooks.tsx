/**
 * Account and wallet-related hooks
 */

import { useCallback, useEffect, useState } from "react"
import { useNear } from "./provider.js"

/**
 * Result shape for the useAccount hook
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

  const [accountId, setAccountId] = useState<string | undefined>(undefined)
  const [isLoading, setIsLoading] = useState(true)

  const fetchAccount = useCallback(async () => {
    setIsLoading(true)
    try {
      // Access internal wallet through a type assertion
      // The Near class stores wallet but doesn't expose it publicly
      const nearInternal = near as unknown as {
        wallet?: {
          getAccounts: () => Promise<Array<{ accountId: string }>>
        }
        defaultSignerId?: string
      }

      // First, check if there's a wallet connection
      if (nearInternal.wallet) {
        const accounts = await nearInternal.wallet.getAccounts()
        const firstAccount = accounts[0]
        if (firstAccount) {
          setAccountId(firstAccount.accountId)
          return
        }
      }

      // Fall back to default signer ID if set
      if (nearInternal.defaultSignerId) {
        setAccountId(nearInternal.defaultSignerId)
        return
      }

      // No account found
      setAccountId(undefined)
    } catch {
      // If we can't get accounts, consider it not connected
      setAccountId(undefined)
    } finally {
      setIsLoading(false)
    }
  }, [near])

  useEffect(() => {
    void fetchAccount()
  }, [fetchAccount])

  return {
    accountId,
    isConnected: accountId !== undefined,
    isLoading,
    refetch: fetchAccount,
  }
}
