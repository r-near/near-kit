"use client"

import type { CallOptions, NearError } from "near-kit"
import { useCallback, useRef, useState } from "react"
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

  const [data, setData] = useState<TResult | undefined>(undefined)
  const [error, setError] = useState<NearError | Error | undefined>(undefined)
  const [isPending, setIsPending] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)
  const [isError, setIsError] = useState(false)

  // Track the latest mutation to handle parallel calls (last write wins)
  const mutationIdRef = useRef(0)

  const mutate = useCallback(
    async (args: TArgs, options?: CallOptions): Promise<TResult> => {
      const currentMutationId = ++mutationIdRef.current
      setIsPending(true)
      setIsSuccess(false)
      setIsError(false)
      setError(undefined)

      try {
        const mergedOptions: CallOptions = {
          ...defaultOptions,
          ...options,
        }

        const result = await near.call<TResult>(
          contractId,
          method,
          args,
          mergedOptions,
        )

        // Only update state if this is still the latest mutation
        if (currentMutationId === mutationIdRef.current) {
          setData(result)
          setIsSuccess(true)
          setIsPending(false)
        }

        return result
      } catch (err) {
        const normalizedError =
          err instanceof Error ? err : new Error(String(err))

        // Only update state if this is still the latest mutation
        if (currentMutationId === mutationIdRef.current) {
          setError(normalizedError)
          setIsError(true)
          setIsPending(false)
        }

        throw normalizedError
      }
    },
    [near, contractId, method, defaultOptions],
  )

  const reset = useCallback(() => {
    setData(undefined)
    setError(undefined)
    setIsPending(false)
    setIsSuccess(false)
    setIsError(false)
    mutationIdRef.current++
  }, [])

  return { mutate, data, error, isPending, isSuccess, isError, reset }
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

  const [error, setError] = useState<NearError | Error | undefined>(undefined)
  const [isPending, setIsPending] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)
  const [isError, setIsError] = useState(false)

  const mutationIdRef = useRef(0)

  const mutate = useCallback(
    async (to: string, amount: AmountInput): Promise<void> => {
      const currentMutationId = ++mutationIdRef.current
      setIsPending(true)
      setIsSuccess(false)
      setIsError(false)
      setError(undefined)

      try {
        await near.send(to, amount)

        if (currentMutationId === mutationIdRef.current) {
          setIsSuccess(true)
          setIsPending(false)
        }
      } catch (err) {
        const normalizedError =
          err instanceof Error ? err : new Error(String(err))

        if (currentMutationId === mutationIdRef.current) {
          setError(normalizedError)
          setIsError(true)
          setIsPending(false)
        }

        throw normalizedError
      }
    },
    [near],
  )

  const reset = useCallback(() => {
    setError(undefined)
    setIsPending(false)
    setIsSuccess(false)
    setIsError(false)
    mutationIdRef.current++
  }, [])

  return { mutate, error, isPending, isSuccess, isError, reset }
}
