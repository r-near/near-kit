/**
 * NearProvider and useNear hook for React context
 */

import { Near, type NearConfig } from "near-kit"
import { createContext, type ReactNode, useContext, useMemo } from "react"

/**
 * Props for NearProvider when providing an existing Near instance
 */
interface NearProviderPropsWithInstance {
  near: Near
  config?: never
  children: ReactNode
}

/**
 * Props for NearProvider when providing configuration to create a Near instance
 */
interface NearProviderPropsWithConfig {
  near?: never
  config: NearConfig
  children: ReactNode
}

export type NearProviderProps =
  | NearProviderPropsWithInstance
  | NearProviderPropsWithConfig

const NearContext = createContext<Near | null>(null)

/**
 * Provider component that creates and shares a Near client instance.
 *
 * @example Using an existing Near instance:
 * ```tsx
 * const near = new Near({ network: "testnet" })
 *
 * <NearProvider near={near}>
 *   <App />
 * </NearProvider>
 * ```
 *
 * @example Using configuration to create a Near instance:
 * ```tsx
 * <NearProvider config={{ network: "testnet" }}>
 *   <App />
 * </NearProvider>
 * ```
 */
export function NearProvider(props: NearProviderProps): ReactNode {
  const { near: providedNear, config, children } = props

  const near = useMemo(() => {
    if (providedNear) {
      return providedNear
    }
    return new Near(config)
  }, [providedNear, config])

  return <NearContext.Provider value={near}>{children}</NearContext.Provider>
}

/**
 * Hook to access the Near client from context.
 *
 * @throws Error if used outside of NearProvider
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const near = useNear()
 *   // Use near.view, near.call, near.transaction, etc.
 * }
 * ```
 */
export function useNear(): Near {
  const near = useContext(NearContext)
  if (!near) {
    throw new Error("useNear must be used within a NearProvider")
  }
  return near
}
