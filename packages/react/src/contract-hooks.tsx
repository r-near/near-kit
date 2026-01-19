/**
 * Typed contract hooks for strongly-typed contract interactions
 */

import type { ContractMethods } from "near-kit"
import {
  type DependencyList,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react"
import { useNear } from "./provider.js"
import type { QueryResult } from "./query-hooks.js"

/**
 * Hook to get a typed contract instance.
 *
 * @example
 * ```tsx
 * import type { Contract } from "near-kit"
 *
 * type MyContract = Contract<{
 *   view: {
 *     get_balance: (args: { account_id: string }) => Promise<string>
 *   }
 *   call: {
 *     transfer: (args: { to: string; amount: string }) => Promise<void>
 *   }
 * }>
 *
 * function WalletBalance() {
 *   const contract = useContract<MyContract>("token.testnet")
 *
 *   // contract.view.get_balance({ account_id: "..." })
 *   // contract.call.transfer({ to: "...", amount: "..." })
 * }
 * ```
 */
export function useContract<T extends ContractMethods>(contractId: string): T {
  const near = useNear()
  return near.contract<T>(contractId)
}

/**
 * Parameters for useContractView hook
 */
export interface UseContractViewParams<TArgs> {
  /** Arguments to pass to the view method */
  args: TArgs
  /** Whether the query is enabled (default: true) */
  enabled?: boolean
  /** Dependencies that trigger a refetch when changed */
  watch?: DependencyList
}

/**
 * Hook for calling typed view methods on contracts.
 *
 * @example
 * ```tsx
 * import type { Contract } from "near-kit"
 *
 * type MyContract = Contract<{
 *   view: {
 *     get_balance: (args: { account_id: string }) => Promise<string>
 *   }
 *   call: {}
 * }>
 *
 * function WalletBalance() {
 *   const { accountId } = useAccount()
 *   const contract = useContract<MyContract>("token.testnet")
 *
 *   const { data: balance, isLoading } = useContractView(
 *     contract.view.get_balance,
 *     {
 *       args: { account_id: accountId! },
 *       enabled: !!accountId,
 *       watch: [accountId],
 *     }
 *   )
 *
 *   if (isLoading) return <>Loading...</>
 *   return <>Balance: {balance}</>
 * }
 * ```
 */
export function useContractView<TArgs, TResult>(
  viewFn: (args: TArgs) => Promise<TResult>,
  params: UseContractViewParams<TArgs>,
): QueryResult<TResult> {
  const { args, enabled = true, watch = [] } = params

  const [data, setData] = useState<TResult | undefined>(undefined)
  const [error, setError] = useState<unknown>(undefined)
  const [isLoading, setIsLoading] = useState(false)

  // Use a ref to store args to avoid infinite loops when args is an object literal
  const argsRef = useRef<TArgs>(args)
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
      const result = await viewFn(argsRef.current)
      setData(result)
    } catch (err) {
      setError(err)
    } finally {
      setIsLoading(false)
    }
  }, [viewFn, enabled, argsJson])

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
