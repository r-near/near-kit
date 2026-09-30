"use client"

import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import { ExternalError } from "near-kit/effect"
import { useCallback, useEffect, useRef, useState } from "react"

export const errorValue = (failure: unknown): Error => {
  const value = failure instanceof ExternalError ? failure.cause : failure
  return value instanceof Error ? value : new Error(String(value))
}

/** Keep JSON-equivalent query input stable; authority-bearing config uses identity. */
export const useStableInput = <A>(value: A): A => {
  const key = JSON.stringify(value)
  const [saved, setSaved] = useState({ key, value })
  if (saved.key !== key) {
    setSaved({ key, value })
    return value
  }
  return saved.value
}

export interface QueryState<A> {
  readonly data: A | undefined
  readonly error: Error | undefined
  readonly isLoading: boolean
}

/** React owns visible state; one Effect fiber owns each read and its finalizers. */
export const useQuery = <A, E>(
  program: Effect.Effect<A, E>,
  enabled: boolean,
) => {
  const [state, setState] = useState<QueryState<A>>({
    data: undefined,
    error: undefined,
    isLoading: enabled,
  })
  const latest = useRef<symbol | undefined>(undefined)
  const active = useRef<Fiber.Fiber<void, never> | undefined>(undefined)
  const start = useCallback(() => {
    const id = Symbol()
    latest.current = id
    active.current?.interruptUnsafe()
    const fiber = Effect.runFork(
      Effect.gen(function* () {
        yield* Effect.sync(() =>
          setState((current) => ({
            ...current,
            ...(enabled ? { error: undefined } : {}),
            isLoading: enabled,
          })),
        )
        if (!enabled) return
        const result = yield* Effect.exit(program)
        yield* Effect.sync(() => {
          if (id !== latest.current) return
          if (Exit.isSuccess(result)) {
            setState({ data: result.value, error: undefined, isLoading: false })
          } else if (!Cause.hasInterrupts(result.cause)) {
            setState((current) => ({
              ...current,
              error: errorValue(Cause.squash(result.cause)),
              isLoading: false,
            }))
          }
        })
      }).pipe(Effect.withSpan("React.query")),
    )
    active.current = fiber
    return fiber
  }, [program, enabled])
  const refetch = useCallback(
    () => Effect.runPromise(Fiber.await(start())).then(() => undefined),
    [start],
  )
  useEffect(() => {
    start()
    return () => {
      latest.current = undefined
      active.current?.interruptUnsafe()
    }
  }, [start])
  return { ...state, refetch }
}

export interface MutationState<A> {
  readonly data: A | undefined
  readonly error: Error | undefined
  readonly isPending: boolean
  readonly isSuccess: boolean
  readonly isError: boolean
}
const initialMutation = <A>(): MutationState<A> => ({
  data: undefined,
  error: undefined,
  isPending: false,
  isSuccess: false,
  isError: false,
})

export const useMutation = <Args extends unknown[], A, E>(
  operation: (...args: Args) => Effect.Effect<A, E>,
) => {
  const [state, setState] = useState(initialMutation<A>)
  const latest = useRef<symbol | undefined>(undefined)
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      latest.current = undefined
    }
  }, [])
  const mutate = useCallback(
    (...args: Args): Promise<A> => {
      const id = Symbol()
      latest.current = id
      setState((current) => ({
        ...current,
        error: undefined,
        isPending: true,
        isSuccess: false,
        isError: false,
      }))
      return Effect.runPromiseExit(
        Effect.suspend(() => operation(...args)).pipe(
          Effect.withSpan("React.mutate"),
        ),
      ).then((result) => {
        const current = mounted.current && id === latest.current
        if (Exit.isSuccess(result)) {
          if (current)
            setState({
              data: result.value,
              error: undefined,
              isPending: false,
              isSuccess: true,
              isError: false,
            })
          return result.value
        }
        const error = errorValue(Cause.squash(result.cause))
        if (current)
          setState((previous) => ({
            ...previous,
            error,
            isPending: false,
            isSuccess: false,
            isError: true,
          }))
        throw error
      })
    },
    [operation],
  )
  const reset = useCallback(() => {
    latest.current = undefined
    setState(initialMutation<A>())
  }, [])
  // A mutation's Promise owns its work; unmount/reset only disconnect UI state.
  return { ...state, mutate, reset }
}
