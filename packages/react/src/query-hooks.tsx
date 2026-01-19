/**
 * Data-fetching hooks for read operations
 */

import {
  type DependencyList,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react"
import { useNear } from "./provider.js"

/**
 * Result shape for data-fetching hooks
 */
export interface QueryResult<T> {
  /** The data returned from the query */
  data: T | undefined
  /** Any error that occurred during the query */
  error: unknown
  /** Whether the query is currently loading */
  isLoading: boolean
  /** Function to manually refetch the data */
  refetch: () => Promise<void>
}

/**
 * Parameters for the useView hook
 */
export interface UseViewParams<TArgs extends object = object> {
  /** Contract account ID to call */
  contractId: string
  /** View method name to call */
  method: string
  /** Arguments to pass to the method */
  args?: TArgs
  /** Whether the query is enabled (default: true) */
  enabled?: boolean
  /** Dependencies that trigger a refetch when changed */
  watch?: DependencyList
}

/**
 * Hook for calling view functions on contracts.
 *
 * @example
 * ```tsx
 * function Balance({ accountId }: { accountId: string }) {
 *   const { data: balance, isLoading } = useView<{ account_id: string }, string>({
 *     contractId: "token.testnet",
 *     method: "ft_balance_of",
 *     args: { account_id: accountId },
 *     enabled: !!accountId,
 *     watch: [accountId],
 *   })
 *
 *   if (isLoading) return <>Loading...</>
 *   return <>Balance: {balance}</>
 * }
 * ```
 */
export function useView<TArgs extends object = object, TResult = unknown>(
  params: UseViewParams<TArgs>,
): QueryResult<TResult> {
  const near = useNear()
  const { contractId, method, args, enabled = true, watch = [] } = params

  const [data, setData] = useState<TResult | undefined>(undefined)
  const [error, setError] = useState<unknown>(undefined)
  const [isLoading, setIsLoading] = useState(false)

  // Use a ref to store args to avoid infinite loops when args is an object literal
  const argsRef = useRef<TArgs | undefined>(args)
  const argsJson = JSON.stringify(args)

  // biome-ignore lint/correctness/useExhaustiveDependencies: argsJson triggers update, args is the actual value
  useEffect(() => {
    argsRef.current = args
  }, [argsJson, args])

  // biome-ignore lint/correctness/useExhaustiveDependencies: argsJson is used to trigger refetch when args change
  const fetchData = useCallback(async () => {
    if (!enabled) {
      return
    }

    setIsLoading(true)
    setError(undefined)

    try {
      const result = await near.view<TResult>(
        contractId,
        method,
        argsRef.current ?? {},
      )
      setData(result)
    } catch (err) {
      setError(err)
    } finally {
      setIsLoading(false)
    }
  }, [near, contractId, method, argsJson, enabled])

  useEffect(() => {
    void fetchData()
  }, [fetchData, ...watch])

  return {
    data,
    error,
    isLoading,
    refetch: fetchData,
  }
}

/**
 * Parameters for the useAccountExists hook
 */
export interface UseAccountExistsParams {
  /** Account ID to check */
  accountId: string | undefined
  /** Whether the query is enabled (default: true when accountId is defined) */
  enabled?: boolean
}

/**
 * Hook to check if an account exists.
 *
 * @example
 * ```tsx
 * function AccountChecker({ accountId }: { accountId: string }) {
 *   const { data: exists, isLoading } = useAccountExists({ accountId })
 *
 *   if (isLoading) return <>Checking...</>
 *   return <>{exists ? "Account exists" : "Account not found"}</>
 * }
 * ```
 */
export function useAccountExists(
  params: UseAccountExistsParams,
): QueryResult<boolean> {
  const near = useNear()
  const { accountId, enabled = accountId !== undefined } = params

  const [data, setData] = useState<boolean | undefined>(undefined)
  const [error, setError] = useState<unknown>(undefined)
  const [isLoading, setIsLoading] = useState(false)

  const fetchData = useCallback(async () => {
    if (!enabled || !accountId) {
      return
    }

    setIsLoading(true)
    setError(undefined)

    try {
      const exists = await near.accountExists(accountId)
      setData(exists)
    } catch (err) {
      setError(err)
    } finally {
      setIsLoading(false)
    }
  }, [near, accountId, enabled])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  return {
    data,
    error,
    isLoading,
    refetch: fetchData,
  }
}

/**
 * Parameters for the useBalance hook
 */
export interface UseBalanceParams {
  /** Account ID to get balance for */
  accountId: string | undefined
  /** Whether the query is enabled (default: true when accountId is defined) */
  enabled?: boolean
}

/**
 * Hook to get an account's balance.
 *
 * @example
 * ```tsx
 * function Balance() {
 *   const { accountId } = useAccount()
 *   const { data: balance, isLoading, refetch } = useBalance({ accountId })
 *
 *   if (isLoading) return <>Loading...</>
 *   return (
 *     <div>
 *       <span>Balance: {balance} NEAR</span>
 *       <button onClick={refetch}>Refresh</button>
 *     </div>
 *   )
 * }
 * ```
 */
export function useBalance(params: UseBalanceParams): QueryResult<string> {
  const near = useNear()
  const { accountId, enabled = accountId !== undefined } = params

  const [data, setData] = useState<string | undefined>(undefined)
  const [error, setError] = useState<unknown>(undefined)
  const [isLoading, setIsLoading] = useState(false)

  const fetchData = useCallback(async () => {
    if (!enabled || !accountId) {
      return
    }

    setIsLoading(true)
    setError(undefined)

    try {
      const balance = await near.getBalance(accountId)
      setData(balance)
    } catch (err) {
      setError(err)
    } finally {
      setIsLoading(false)
    }
  }, [near, accountId, enabled])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  return {
    data,
    error,
    isLoading,
    refetch: fetchData,
  }
}
