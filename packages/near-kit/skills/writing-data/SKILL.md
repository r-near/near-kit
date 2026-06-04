---
name: writing-data
description: Send transactions using simple shortcuts — near.send(), near.call() — with CallOptions for gas, deposit, and finality. Covers Amount helper, result inspection, and waitUntil levels.
type: core
library: near-kit
library_version: "0.14.0"
sources:
  - r-near/near-kit:docs/essentials/writing-data.mdx
  - r-near/near-kit:packages/near-kit/src/core/near.ts
requires: client-setup
---

# Setup

## Client with privateKey and defaultSignerId

```typescript
import { Near } from "near-kit"

const near = new Near({
  network: "testnet",
  privateKey: "ed25519:5nzOS...VKsRf",
  defaultSignerId: "alice.testnet",
})
```

# Core Patterns

## 1. Send NEAR with near.send()

```typescript
import { Near, Amount } from "near-kit"

const near = new Near({ network: "testnet", privateKey: "ed25519:...", defaultSignerId: "alice.t" })

await near.send("bob.testnet", "10 NEAR")
await near.send("bob.testnet", Amount.NEAR(10))
await near.send("bob.testnet", "1 yocto")
await near.send("bob.testnet", Amount.yocto(1n))
```

## 2. Call contract with near.call() and options

```typescript
import { Near, Gas } from "near-kit"

const near = new Near({ network: "testnet", privateKey: "ed25519:...", defaultSignerId: "alice.t" })

await near.call("contract.testnet", "increment", { by: 1 })

await near.call("contract.testnet", "store_data", { key: "hello", value: "world" }, {
  attachedDeposit: "0.1 NEAR",
  gas: "100 Tgas",
})

await near.call("contract.testnet", "register", {}, {
  attachedDeposit: Amount.NEAR(0.1),
  gas: Gas.Tgas(100),
  signerId: "bob.testnet",
  waitUntil: "FINAL",
})
```

`CallOptions` fields: `gas`, `attachedDeposit`, `signerId`, `waitUntil`.

## 3. Dynamic amounts with Amount helper

```typescript
import { Amount } from "near-kit"

Amount.NEAR(10)
Amount.NEAR(10.5)
Amount.NEAR("10.5")
Amount.yocto(1000000n)
Amount.yocto("1000000")

Amount.ZERO
Amount.ONE_NEAR
Amount.ONE_YOCTO
```

Amount constants and constructors always produce unit-annotated strings (`"10 NEAR"`, `"1000 yocto"`). Raw numbers are rejected.

## 4. Inspecting transaction results

```typescript
import { Near } from "near-kit"

const near = new Near({ network: "testnet", privateKey: "ed25519:...", defaultSignerId: "alice.t" })

const result = await near.call<{ success: boolean }>("contract.testnet", "transfer", {
  receiver_id: "bob.testnet",
  amount: "1000",
}, {
  attachedDeposit: "1 yocto",
  waitUntil: "EXECUTED_OPTIMISTIC",
})

result.transaction.hash
result.transaction_outcome
result.receipts_outcome

const sendResult = await near.send("bob.testnet", "1 NEAR")
sendResult.transaction.hash
```

### waitUntil levels

| Level | Meaning | Return data |
|---|---|---|
| `NONE` | Don't wait | Transaction hash only |
| `INCLUDED` | Included in block | No execution data |
| `EXECUTED_OPTIMISTIC` | Execution complete (default) | Full result + return value |
| `INCLUDED_FINAL` | Block finalized | No execution data |
| `EXECUTED` | Finalized + executed | Full result |
| `FINAL` | Last receipt finalized | Full result with all receipts |

# Common Mistakes

## CRITICAL: Passing raw number instead of unit string

```typescript
import { Near } from "near-kit"

const near = new Near({ network: "testnet", privateKey: "ed25519:...", defaultSignerId: "a.t" })

await near.send("bob.near", 10)
```

This throws `Ambiguous amount: "10"`. Always include units:

```typescript
await near.send("bob.near", "10 NEAR")
await near.send("bob.near", Amount.NEAR(10))
```

This same error occurs on every `Amount` parameter: `.transfer()`, `attachedDeposit`, `stake()`, etc.

## HIGH: Forgetting attached deposit when contract requires storage payment

```typescript
import { Near } from "near-kit"

const near = new Near({ network: "testnet", privateKey: "ed25519:...", defaultSignerId: "alice.t" })

await near.call("nft.example.near", "nft_mint", { token_id: "42" })
```

Many NEAR contracts require a storage deposit for registering accounts or minting items. Without `attachedDeposit`, the contract panics with a storage deposit error:

```typescript
await near.call("nft.example.near", "nft_mint", { token_id: "42" }, {
  attachedDeposit: "0.1 NEAR",
})
```

## MEDIUM: Using INCLUDED waitUntil and then reading return value

```typescript
import { Near } from "near-kit"

const near = new Near({ network: "testnet", privateKey: "ed25519:...", defaultSignerId: "alice.t" })

const result = await near.call<{ value: string }>("contract.testnet", "get_result", {}, {
  waitUntil: "INCLUDED",
})
const value = result.status
```

`INCLUDED` only guarantees the transaction was included in a block — execution has not completed yet. No return value is available. Use `EXECUTED_OPTIMISTIC` (default) or `FINAL` to read contract return values:

```typescript
const result = await near.call<{ value: string }>("contract.testnet", "get_result", {}, {
  waitUntil: "EXECUTED_OPTIMISTIC",
})
```

## MEDIUM: Not specifying gas for complex function calls

```typescript
import { Near } from "near-kit"

const near = new Near({ network: "testnet", privateKey: "ed25519:...", defaultSignerId: "alice.t" })

await near.call("contract.testnet", "complex_computation", { iterations: 10000 })
```

Gas defaults to 30 Tgas. Complex contract calls may exceed this, causing `GasLimitExceededError`. Specify a higher gas:

```typescript
await near.call("contract.testnet", "complex_computation", { iterations: 10000 }, {
  gas: "300 Tgas",
})
```

See also: transaction-builder
