/**
 * Example: Using bigint for NEAR amounts
 *
 * This demonstrates the new feature where bigint values are
 * automatically treated as yoctoNEAR amounts.
 */

import { Near } from "../src/index.js"

const near = new Near({ network: "mainnet" })

// All of these are equivalent ways to specify 1 NEAR (10^24 yoctoNEAR):

// 1. Using Amount.NEAR()
await near.view({
  account: "wrap.near",
  method: "ft_balance_of",
  args: { account_id: "alice.near" },
  deposit: "1 NEAR",
})

// 2. Using Amount.yocto()
await near.view({
  account: "wrap.near",
  method: "ft_balance_of",
  args: { account_id: "alice.near" },
  deposit: "1000000000000000000000000 yocto",
})

// 3. NEW: Using raw bigint (automatically treated as yoctoNEAR)
await near.view({
  account: "wrap.near",
  method: "ft_balance_of",
  args: { account_id: "alice.near" },
  deposit: 1000000000000000000000000n,
})

// Benefits of using bigint:
// - Type safety: bigint is distinct from number, avoiding confusion
// - Convenience: No need to wrap in Amount.yocto()
// - Precision: Perfect for exact yoctoNEAR calculations

// Example: Calculating amounts with bigint
const baseAmount = 10000000000000000000000000n // 10 NEAR
const commission = baseAmount / 100n // 1% commission = 0.1 NEAR
const finalAmount = baseAmount - commission // 9.9 NEAR

await near.transaction({
  account: "sender.near",
})
  .transfer({ to: "alice.near", amount: finalAmount })
  .send()

console.log("BigInt amounts work seamlessly!")
