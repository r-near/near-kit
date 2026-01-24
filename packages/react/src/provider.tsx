"use client"

import { Near, type NearConfig } from "near-kit"
import { createContext, type ReactNode, useContext, useMemo } from "react"

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

  // Create or use the provided Near instance
  const nearInstance = useMemo(() => {
    if ("near" in props && props.near) {
      return props.near
    }
    return new Near(props.config)
  }, [props])

  return (
    <NearProviderDetectionContext.Provider value={true}>
      <NearContext.Provider value={nearInstance}>
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
