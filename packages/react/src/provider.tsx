"use client"

import { Near, type NearConfig } from "near-kit"
import { prepareClient, publicConfiguration } from "near-kit/effect"
import * as Cause from "effect/Cause"
import * as ConfigProvider from "effect/ConfigProvider"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

/**
 * Context for the Near client instance
 */
const NearContext = createContext<Near | null>(null)

/**
 * Internal context to detect nested providers
 */
const NearProviderDetectionContext = createContext<boolean>(false)

/**
 * Props for NearProvider - either pass config or an existing Near instance
 */
export type NearProviderProps =
  | { config: NearConfig; near?: never; children: ReactNode }
  | { near: Near; config?: never; children: ReactNode }

/**
 * Provider that creates or wraps a Near client instance and makes it
 * available to all child components via React context.
 *
 * @example
 * ```tsx
 * // Using configuration (creates Near instance internally)
 * <NearProvider config={{ network: "testnet" }}>
 *   <App />
 * </NearProvider>
 *
 * // Using an existing Near instance
 * const near = new Near({ network: "testnet" })
 * <NearProvider near={near}>
 *   <App />
 * </NearProvider>
 * ```
 */
export function NearProvider(props: NearProviderProps): ReactNode {
  const { children } = props

  // Detect nested providers
  const isNested = useContext(NearProviderDetectionContext)
  if (isNested) {
    throw new Error(
      "Nested <NearProvider> detected. Only one NearProvider is allowed per React tree. " +
        "If you need multiple networks, create separate Near instances and pass them explicitly.",
    )
  }

  const nearProp = "near" in props ? props.near : undefined
  const hasConfig = "config" in props && props.config !== undefined
  const {
    network,
    rpcUrl,
    headers,
    keyStore,
    signer,
    privateKey,
    wallet,
    defaultSignerId,
    defaultWaitUntil,
    retryConfig,
  } = ("config" in props ? props.config : undefined) ?? {}
  const maxRetries = retryConfig?.maxRetries
  const initialDelayMs = retryConfig?.initialDelayMs
  // Capabilities carry authority and must be compared by identity, not JSON.
  const projection = useMemo(() => {
    if (nearProp) return { near: nearProp, prepared: undefined }
    if (!hasConfig)
      throw new Error("NearProvider requires either 'near' or 'config' prop")
    const prepared = Effect.runSync(
      prepareClient({
        network,
        rpcUrl,
        headers,
        keyStore,
        signer,
        wallet,
        defaultSignerId,
        defaultWaitUntil,
        ...(privateKey !== undefined ? { privateKey } : {}),
        retryConfig: { maxRetries, initialDelayMs },
      }).pipe(
        Effect.provideService(
          ConfigProvider.ConfigProvider,
          publicConfiguration(),
        ),
      ),
    )
    return { near: Near.fromClient(prepared.client), prepared }
  }, [
    nearProp,
    hasConfig,
    network,
    rpcUrl,
    headers,
    keyStore,
    signer,
    privateKey,
    wallet,
    defaultSignerId,
    defaultWaitUntil,
    maxRetries,
    initialDelayMs,
  ])

  const owner = useRef<Fiber.Fiber<void> | undefined>(undefined)
  const activeOwner = useRef<symbol | undefined>(undefined)
  const [failure, setFailure] = useState<{ near: Near; cause: unknown }>()
  useEffect(() => {
    if (!projection.prepared) return
    const previous = owner.current
    const id = Symbol()
    activeOwner.current = id
    const { activate } = projection.prepared
    const fiber = Effect.runFork(
      Effect.gen(function* () {
        if (previous) yield* Fiber.await(previous)
        return yield* Effect.scoped(activate.pipe(Effect.andThen(Effect.never)))
      }).pipe(
        Effect.onError((cause) => {
          if (Cause.hasInterruptsOnly(cause)) return Effect.void
          if (activeOwner.current !== id)
            return Effect.logError(
              "NearProvider observation cleanup failed",
              cause,
            )
          return Effect.sync(() =>
            setFailure({
              near: projection.near,
              cause: Cause.squash(cause),
            }),
          )
        }),
      ),
    )
    owner.current = fiber
    return () => {
      activeOwner.current = undefined
      fiber.interruptUnsafe()
    }
  }, [projection])

  if (failure?.near === projection.near) throw failure.cause

  return (
    <NearProviderDetectionContext.Provider value={true}>
      <NearContext.Provider value={projection.near}>
        {children}
      </NearContext.Provider>
    </NearProviderDetectionContext.Provider>
  )
}

/**
 * Hook to access the Near client instance from context.
 *
 * @throws Error if called outside of a NearProvider
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const near = useNear()
 *   // Use near.view(), near.call(), near.transaction(), etc.
 * }
 * ```
 */
export function useNear(): Near {
  const near = useContext(NearContext)
  if (!near) {
    throw new Error(
      "useNear must be used within a <NearProvider>. " +
        "Wrap your component tree with <NearProvider config={{ network: 'testnet' }}>.",
    )
  }
  return near
}
