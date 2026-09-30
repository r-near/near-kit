"use client"

import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Ref from "effect/Ref"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import { ExternalError } from "near-kit/effect"
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"

export const errorValue = (failure: unknown): Error => {
  const value = failure instanceof ExternalError ? failure.cause : failure
  return value instanceof Error ? value : new Error(String(value))
}

/** Keep JSON-equivalent input data stable without reading/writing render refs. */
export const useStableInput = <A>(value: A): A => {
  const key = JSON.stringify(value)
  const [saved, setSaved] = useState({ key, value })
  if (saved.key !== key) {
    setSaved({ key, value })
    return value
  }
  return saved.value
}

const useSubscription = <A>(store: SubscriptionRef.SubscriptionRef<A>): A => {
  const subscribe = useCallback(
    (notify: () => void) => {
      const fiber = Effect.runFork(
        SubscriptionRef.changes(store).pipe(
          Stream.drop(1),
          Stream.runForEach(() => Effect.sync(notify)),
        ),
      )
      return () => fiber.interruptUnsafe()
    },
    [store],
  )
  const snapshot = useCallback(() => SubscriptionRef.getUnsafe(store), [store])
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

export interface QueryState<A> {
  readonly data: A | undefined
  readonly error: Error | undefined
  readonly isLoading: boolean
}

export const useQuery = <A, E>(
  program: Effect.Effect<A, E>,
  enabled: boolean,
) => {
  const [store] = useState(() =>
    Effect.runSync(
      SubscriptionRef.make<QueryState<A>>({
        data: undefined,
        error: undefined,
        isLoading: enabled,
      }),
    ),
  )
  const [generation] = useState(() => Ref.makeUnsafe(0))
  const active = useRef<Fiber.Fiber<void, never> | undefined>(undefined)
  const state = useSubscription(store)
  const execute = useMemo(
    () =>
      Effect.fn("React.query")(function* () {
        const id = yield* Ref.updateAndGet(generation, (value) => value + 1)
        if (!enabled) {
          yield* SubscriptionRef.update(store, (current) => ({
            ...current,
            isLoading: false,
          }))
          return
        }
        yield* SubscriptionRef.update(store, (current) => ({
          ...current,
          error: undefined,
          isLoading: true,
        }))
        const result = yield* Effect.exit(program)
        if (id !== (yield* Ref.get(generation))) return
        if (Exit.isSuccess(result)) {
          yield* SubscriptionRef.set(store, {
            data: result.value,
            error: undefined,
            isLoading: false,
          })
        } else if (!Cause.hasInterrupts(result.cause)) {
          yield* SubscriptionRef.update(store, (current) => ({
            ...current,
            error: errorValue(Cause.squash(result.cause)),
            isLoading: false,
          }))
        }
      }),
    [program, enabled, generation, store],
  )

  const refetch = useCallback((): Promise<void> => {
    active.current?.interruptUnsafe()
    const fiber = Effect.runFork(execute())
    active.current = fiber
    // Reads expose errors as state. A superseded read completes its refetch handle.
    return Effect.runPromise(Fiber.await(fiber)).then(() => undefined)
  }, [execute])

  useEffect(() => {
    const fiber = Effect.runFork(execute())
    active.current = fiber
    return () => {
      Effect.runSync(Ref.update(generation, (value) => value + 1))
      active.current?.interruptUnsafe()
    }
  }, [execute, generation])
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
  const [store] = useState(() =>
    Effect.runSync(SubscriptionRef.make(initialMutation<A>())),
  )
  const [generation] = useState(() => Ref.makeUnsafe(0))
  const mounted = useRef(false)
  const state = useSubscription(store)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      Effect.runSync(Ref.update(generation, (value) => value + 1))
    }
  }, [generation])
  const mutate = useCallback(
    (...args: Args): Promise<A> =>
      Effect.runPromise(
        Effect.gen(function* () {
          const id = yield* Ref.updateAndGet(generation, (value) => value + 1)
          yield* SubscriptionRef.update(store, (current) => ({
            ...current,
            error: undefined,
            isPending: true,
            isSuccess: false,
            isError: false,
          }))
          const result = yield* Effect.exit(
            Effect.suspend(() => operation(...args)),
          )
          const current = mounted.current && id === (yield* Ref.get(generation))
          if (Exit.isSuccess(result)) {
            if (current)
              yield* SubscriptionRef.set(store, {
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
            yield* SubscriptionRef.update(store, (previous) => ({
              ...previous,
              error,
              isPending: false,
              isSuccess: false,
              isError: true,
            }))
          return yield* Effect.fail(error)
        }).pipe(Effect.withSpan("React.mutate")),
      ),
    [operation, generation, store],
  )
  const reset = useCallback(() => {
    Effect.runSync(
      Effect.gen(function* () {
        yield* Ref.update(generation, (value) => value + 1)
        yield* SubscriptionRef.set(store, initialMutation<A>())
      }),
    )
  }, [generation, store])
  // A mutation's returned Promise owns its work. Unmount only disconnects UI;
  // it cannot roll back a wallet approval or an already-submitted transaction.
  return { ...state, mutate, reset }
}
