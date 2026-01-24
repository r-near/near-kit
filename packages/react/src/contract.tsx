"use client"

import type { ContractMethods } from "near-kit"
import { useNear } from "./provider.js"

/**
 * Hook to get a typed contract instance.
 *
 * This provides full TypeScript inference for contract methods.
 *
 * @example
 * ```tsx
 * import type { Contract } from "near-kit"
 *
 * type MyContract = Contract<{
 *   view: {
 *     get_balance: (args: { account_id: string }) => Promise<string>
 *   }
 *   call: {
 *     transfer: (args: { to: string; amount: string }) => Promise<void>
 *   }
 * }>
 *
 * function WalletBalance() {
 *   const contract = useContract<MyContract>("token.testnet")
 *
 *   // Fully typed!
 *   const balance = await contract.view.get_balance({ account_id: "..." })
 * }
 * ```
 */
export function useContract<T extends ContractMethods>(contractId: string): T {
  const near = useNear()
  return near.contract<T>(contractId)
}
