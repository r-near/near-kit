/**
 * Mutation hooks for write operations
 */

import type { CallOptions, FinalExecutionOutcome } from "near-kit"
import { useCallback, useState } from "react"
import { useNear } from "./provider.js"

/**
 * Amount type for NEAR transfers.
 * Accepts:
 * - String with unit: "10 NEAR", "1000 yocto"
 * - Raw bigint: 1000000n (treated as yoctoNEAR)
 */
export type AmountInput = `${number} NEAR` | `${bigint} yocto` | bigint

/**
 * Result shape for mutation hooks
 */
export interface MutationResult<TResult> {
  /** Whether the mutation is currently in progress */
  isPending: boolean
  /** Whether the mutation completed successfully */
  isSuccess: boolean
  /** Whether the mutation failed */
  isError: boolean
  /** Any error that occurred during the mutation */
  error: unknown
  /** The result data from a successful mutation */
  data: TResult | undefined
  /** Reset the mutation state */
  reset: () => void
}

/**
 * Parameters for the useCall hook
 */
export interface UseCallParams {
  /** Contract account ID to call */
  contractId: string
  /** Change method name to call */
  method: string
}

/**
 * Result type for useCall including the mutate function
 */
export interface UseCallResult<
  TArgs extends object = object,
  TResult = FinalExecutionOutcome,
> extends MutationResult<TResult> {
  /** Execute the contract call */
  mutate: (args: TArgs, options?: CallOptions) => Promise<TResult>
}

/**
 * Hook for calling change methods on contracts.
 *
 * @example
 * ```tsx
 * function IncrementButton() {
 *   const { mutate, isPending } = useCall<{}, void>({
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
export function useCall<
  TArgs extends object = object,
  TResult = FinalExecutionOutcome,
>(params: UseCallParams): UseCallResult<TArgs, TResult> {
  const near = useNear()
  const { contractId, method } = params

  const [isPending, setIsPending] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)
  const [isError, setIsError] = useState(false)
  const [error, setError] = useState<unknown>(undefined)
  const [data, setData] = useState<TResult | undefined>(undefined)

  const reset = useCallback(() => {
    setIsPending(false)
    setIsSuccess(false)
    setIsError(false)
    setError(undefined)
    setData(undefined)
  }, [])

  const mutate = useCallback(
    async (args: TArgs, options?: CallOptions): Promise<TResult> => {
      setIsPending(true)
      setIsSuccess(false)
      setIsError(false)
      setError(undefined)

      try {
        const result = await near.call<TResult>(
          contractId,
          method,
          args,
          options,
        )
        setData(result)
        setIsSuccess(true)
        return result
      } catch (err) {
        setError(err)
        setIsError(true)
        throw err
      } finally {
        setIsPending(false)
      }
    },
    [near, contractId, method],
  )

  return {
    mutate,
    isPending,
    isSuccess,
    isError,
    error,
    data,
    reset,
  }
}

/**
 * Result type for useSend including the mutate function
 */
export interface UseSendResult extends MutationResult<FinalExecutionOutcome> {
  /** Execute the NEAR transfer */
  mutate: (to: string, amount: AmountInput) => Promise<FinalExecutionOutcome>
}

/**
 * Hook for sending NEAR tokens.
 *
 * @example
 * ```tsx
 * function SendButton() {
 *   const { mutate, isPending } = useSend()
 *
 *   const handleSend = () => {
 *     mutate("bob.testnet", "1 NEAR")
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

  const [isPending, setIsPending] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)
  const [isError, setIsError] = useState(false)
  const [error, setError] = useState<unknown>(undefined)
  const [data, setData] = useState<FinalExecutionOutcome | undefined>(undefined)

  const reset = useCallback(() => {
    setIsPending(false)
    setIsSuccess(false)
    setIsError(false)
    setError(undefined)
    setData(undefined)
  }, [])

  const mutate = useCallback(
    async (to: string, amount: AmountInput): Promise<FinalExecutionOutcome> => {
      setIsPending(true)
      setIsSuccess(false)
      setIsError(false)
      setError(undefined)

      try {
        const result = await near.send(to, amount)
        setData(result)
        setIsSuccess(true)
        return result
      } catch (err) {
        setError(err)
        setIsError(true)
        throw err
      } finally {
        setIsPending(false)
      }
    },
    [near],
  )

  return {
    mutate,
    isPending,
    isSuccess,
    isError,
    error,
    data,
    reset,
  }
}
