"use client"

/**
 * @near-kit/react - React bindings for near-kit
 *
 * A thin React layer on top of near-kit providing:
 * - NearProvider and useNear for context management
 * - Simple hooks for view calls and mutations
 * - Full TypeScript support
 *
 * For advanced features like caching, polling, or optimistic updates,
 * use React Query or SWR with the useNear() hook directly.
 */

// Account hook
export { type AccountState, useAccount } from "./account.js"
// Typed contract hook
export { useContract } from "./contract.js"
// View/query hooks
export {
  type UseAccountExistsParams,
  type UseBalanceParams,
  type UseViewParams,
  useAccountExists,
  useBalance,
  useView,
  type ViewResult,
} from "./hooks.js"
// Mutation hooks
export {
  type AmountInput,
  type UseCallParams,
  type UseCallResult,
  type UseSendResult,
  useCall,
  useSend,
} from "./mutations.js"
// Provider and context
export { NearProvider, type NearProviderProps, useNear } from "./provider.js"
