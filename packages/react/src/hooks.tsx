"use client"

import { useMemo } from "react"
import { useQuery, useStableInput } from "./effect-state.js"

import type { NearError } from "near-kit"

import { useNear } from "./provider.js"

/**
 * Result shape for view hooks
 */
export interface ViewResult<T> {
  /** The data returned from the view call */
  data: T | undefined
  /** Any error that occurred */
  error: NearError | Error | undefined
  /** Whether the view call is in progress */
  isLoading: boolean
  /** Manually trigger a refetch */
  refetch: () => Promise<void>
}

/**
 * Parameters for useView hook
 */
export interface UseViewParams<TArgs extends object = object> {
  /** Contract account ID */
  contractId: string
  /** View method name */
  method: string
  /** Arguments to pass to the method */
  args?: TArgs
  /** Whether the query is enabled (default: true) */
  enabled?: boolean
}

/**
 * Hook for calling view functions on NEAR contracts.
 *
 * This is a thin wrapper around `near.view()` that provides React state management.
 * For advanced features like caching, polling, or deduplication, use React Query or SWR
 * with the `useNear()` hook directly.
 *
 * @example
 * ```tsx
 * function Counter() {
 *   const { data: count, isLoading, error, refetch } = useView<{}, number>({
 *     contractId: "counter.testnet",
 *     method: "get_count",
 *   })
 *
 *   if (isLoading) return <div>Loading...</div>
 *   if (error) return <div>Error: {error.message}</div>
 *   return <div>Count: {count}</div>
 * }
 * ```
 */
export function useView<TArgs extends object = object, TResult = unknown>(
  params: UseViewParams<TArgs>,
): ViewResult<TResult> {
  const { contractId, method, enabled = true } = params
  const near = useNear()
  const args = useStableInput(params.args ?? {})
  const program = useMemo(
    () => near.effects.view<TResult>(contractId, method, args),
    [near, contractId, method, args],
  )
  return useQuery(program, enabled)
}

/**
 * Parameters for useBalance hook
 */
export interface UseBalanceParams {
  /** Account ID to check balance for */
  accountId: string
  /** Whether the query is enabled (default: true) */
  enabled?: boolean
}

/**
 * Hook for fetching an account's NEAR balance.
 *
 * @example
 * ```tsx
 * function Balance({ accountId }: { accountId: string }) {
 *   const { data: balance, isLoading } = useBalance({ accountId })
 *
 *   if (isLoading) return <div>Loading...</div>
 *   return <div>Balance: {balance}</div>
 * }
 * ```
 */
export function useBalance(params: UseBalanceParams): ViewResult<string> {
  const { accountId, enabled = true } = params
  const near = useNear()
  const program = useMemo(
    () => near.effects.getBalance(accountId),
    [near, accountId],
  )
  return useQuery(program, enabled && Boolean(accountId))
}

/**
 * Parameters for useAccountExists hook
 */
export interface UseAccountExistsParams {
  /** Account ID to check */
  accountId: string
  /** Whether the query is enabled (default: true) */
  enabled?: boolean
}

/**
 * Hook for checking if a NEAR account exists.
 *
 * @example
 * ```tsx
 * function AccountCheck({ accountId }: { accountId: string }) {
 *   const { data: exists, isLoading } = useAccountExists({ accountId })
 *
 *   if (isLoading) return <div>Checking...</div>
 *   return <div>{exists ? "Account exists" : "Account not found"}</div>
 * }
 * ```
 */
export function useAccountExists(
  params: UseAccountExistsParams,
): ViewResult<boolean> {
  const { accountId, enabled = true } = params
  const near = useNear()
  const program = useMemo(
    () => near.effects.accountExists(accountId),
    [near, accountId],
  )
  return useQuery(program, enabled && Boolean(accountId))
}
