"use client"

import * as Effect from "effect/Effect"
import { useMutation } from "./effect-state.js"

import type { CallOptions, NearError } from "near-kit"
import { useCallback } from "react"
import { useNear } from "./provider.js"

/**
 * Amount input for NEAR transfers.
 * Accepts "10 NEAR", "1000 yocto", or raw bigint.
 */
export type AmountInput = `${number} NEAR` | `${bigint} yocto` | bigint

/**
 * Parameters for useCall hook
 */
export interface UseCallParams {
  /** Contract account ID */
  contractId: string
  /** Change method name */
  method: string
  /** Default options (gas, attachedDeposit, etc.) */
  options?: CallOptions
}

/**
 * Result type for useCall hook
 */
export interface UseCallResult<TArgs extends object, TResult> {
  /** Execute the contract call */
  mutate: (args: TArgs, options?: CallOptions) => Promise<TResult>
  /** The result data from the last successful call */
  data: TResult | undefined
  /** Any error from the last call */
  error: NearError | Error | undefined
  /** Whether a call is currently in progress */
  isPending: boolean
  /** Whether the last call was successful */
  isSuccess: boolean
  /** Whether the last call failed */
  isError: boolean
  /** Reset the mutation state */
  reset: () => void
}

/**
 * Hook for calling change methods on NEAR contracts.
 *
 * This is a thin wrapper around `near.call()` that provides React state management.
 * For advanced features like optimistic updates or mutation queuing, use React Query
 * or SWR with the `useNear()` hook directly.
 *
 * @example
 * ```tsx
 * function IncrementButton() {
 *   const { mutate, isPending, isError, error } = useCall<{}, void>({
 *     contractId: "counter.testnet",
 *     method: "increment",
 *   })
 *
 *   return (
 *     <button onClick={() => mutate({})} disabled={isPending}>
 *       {isPending ? "Sending..." : "Increment"}
 *     </button>
 *   )
 * }
 * ```
 */
export function useCall<TArgs extends object = object, TResult = unknown>(
  params: UseCallParams,
): UseCallResult<TArgs, TResult> {
  const { contractId, method, options: defaultOptions } = params
  const near = useNear()
  const operation = useCallback(
    (args: TArgs, options?: CallOptions) => {
      const merged = { ...defaultOptions, ...options }
      return near.effects.call<TResult>(contractId, method, args, merged)
    },
    [near, contractId, method, defaultOptions],
  )
  return useMutation(operation)
}

/**
 * Result type for useSend hook
 */
export interface UseSendResult {
  /** Execute the NEAR transfer */
  mutate: (to: string, amount: AmountInput) => Promise<void>
  /** Any error from the last transfer */
  error: NearError | Error | undefined
  /** Whether a transfer is currently in progress */
  isPending: boolean
  /** Whether the last transfer was successful */
  isSuccess: boolean
  /** Whether the last transfer failed */
  isError: boolean
  /** Reset the mutation state */
  reset: () => void
}

/**
 * Hook for sending NEAR tokens.
 *
 * @example
 * ```tsx
 * function SendButton() {
 *   const { mutate: send, isPending } = useSend()
 *
 *   const handleSend = () => {
 *     send("bob.testnet", "1 NEAR")
 *   }
 *
 *   return (
 *     <button onClick={handleSend} disabled={isPending}>
 *       {isPending ? "Sending..." : "Send 1 NEAR"}
 *     </button>
 *   )
 * }
 * ```
 */
export function useSend(): UseSendResult {
  const near = useNear()
  const operation = useCallback(
    (to: string, amount: AmountInput) =>
      near.effects.send(to, amount).pipe(Effect.asVoid),
    [near],
  )
  const { data: _data, ...state } = useMutation(operation)
  return state
}
