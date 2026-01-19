/**
 * @near-kit/react - React bindings for near-kit
 *
 * A thin React layer on top of near-kit providing:
 * - NearProvider and useNear for context management
 * - Data-fetching hooks with loading/error states
 * - Mutation hooks for transactions
 * - Typed contract hooks for full TypeScript support
 */

// Account hooks
export { type AccountState, useAccount } from "./account-hooks.js"
// Typed contract hooks
export {
  type UseContractViewParams,
  useContract,
  useContractView,
} from "./contract-hooks.js"
// Mutation hooks for write operations
export {
  type AmountInput,
  type MutationResult,
  type UseCallParams,
  type UseCallResult,
  type UseSendResult,
  useCall,
  useSend,
} from "./mutation-hooks.js"
// Provider and context
export { NearProvider, type NearProviderProps, useNear } from "./provider.js"
// Query hooks for read operations
export {
  type QueryResult,
  type UseAccountExistsParams,
  type UseBalanceParams,
  type UseViewParams,
  useAccountExists,
  useBalance,
  useView,
} from "./query-hooks.js"
