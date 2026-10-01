import { deterministicAccountId } from "@near-kit/next/address"

// NEP-616 V1 uses exact initial storage bytes, not JSON method arguments.
// These offline public vectors are also checked with Rust Borsh/Keccak in CI.
const vectors = [
  {
    code: { accountId: "publisher.near" },
    expected: "0s2293da2d32cd0a067950616036ff973884abab0a",
  },
  {
    code: { hash: "11111111111111111111111111111111" },
    expected: "0s2da1ff2f6fd6170ac3094be0405cdcc5552e1a78",
  },
] as const
for (const { code, expected } of vectors) {
  const address = deterministicAccountId({ code, data: [] })
  if (address !== expected) throw new Error("Public address vector mismatch")
  console.log(address)
}
try {
  deterministicAccountId({ code: { accountId: "invalid..account" } })
} catch (error) {
  if (!(error instanceof RangeError)) throw error
  console.log("The public code reference is invalid")
}
// Equality proves a calculation, not account existence, ownership or current code.
// No network is selected: identical input bytes give the same ID on every chain.
