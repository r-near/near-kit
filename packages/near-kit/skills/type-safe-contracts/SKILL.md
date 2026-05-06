---
name: type-safe-contracts
description: Define TypeScript interfaces for smart contracts using Contract<T> and get full autocomplete, type checking, and inline documentation. Covers view/call namespace separation, CallOptions auto-injection on call methods, and typed contract proxies.
type: core
library: near-kit
library_version: "0.14.0"
sources:
  - r-near/near-kit:docs/essentials/type-safe-contracts.mdx
  - r-near/near-kit:packages/near-kit/src/contracts/contract.ts
requires:
  - client-setup
  - reading-data
  - writing-data
---

# Setup

## Define Contract<T> type and create proxy with near.contract<T>()

```typescript
import { Near, type Contract } from "near-kit"

type Counter = Contract<{
  view: {
    get_count: () => Promise<number>
    get_owner: () => Promise<string>
  }
  call: {
    increment: (args: { by: number }) => Promise<void>
    decrement: (args: { by: number }) => Promise<void>
    reset: () => Promise<void>
  }
}>

const near = new Near({ network: "testnet", privateKey: "ed25519:...", defaultSignerId: "alice.t" })

const counter = near.contract<Counter>("counter.testnet")
```

# Core Patterns

## 1. Define contract interface with view and call

```typescript
import type { Contract } from "near-kit"

type FungibleToken = Contract<{
  view: {
    ft_balance_of: (args: { account_id: string }) => Promise<string>
    ft_total_supply: () => Promise<string>
    ft_metadata: () => Promise<{ name: string; symbol: string; decimals: number }>
  }
  call: {
    ft_transfer: (args: { receiver_id: string; amount: string; memo?: string }) => Promise<void>
    ft_transfer_call: (args: { receiver_id: string; amount: string; msg: string }) => Promise<string>
    storage_deposit: (args: { account_id: string }) => Promise<void>
  }
}>
```

`view` methods are read-only (free, no gas, no signer). `call` methods mutate state (cost gas, require signer).

## 2. Use typed proxy

```typescript
import { Near, type Contract } from "near-kit"

type Counter = Contract<{
  view: {
    get_count: () => Promise<number>
  }
  call: {
    increment: (args: { by: number }) => Promise<void>
    reset: () => Promise<void>
  }
}>

const near = new Near({ network: "testnet", privateKey: "ed25519:...", defaultSignerId: "alice.t" })
const counter = near.contract<Counter>("counter.testnet")

const count = await counter.view.get_count()

await counter.call.increment({ by: 5 })
await counter.call.reset()
```

All methods return typed Promises with full IDE autocomplete.

## 3. Call methods with options

```typescript
import { Near, type Contract, Gas } from "near-kit"

type Market = Contract<{
  view: {
    get_price: (args: { item_id: string }) => Promise<string>
  }
  call: {
    buy: (args: { item_id: string }) => Promise<{ success: boolean }>
    list: (args: { item_id: string; price: string }) => Promise<void>
  }
}>

const near = new Near({ network: "testnet", privateKey: "ed25519:...", defaultSignerId: "alice.t" })
const market = near.contract<Market>("market.testnet")

await market.call.buy({ item_id: "42" }, {
  attachedDeposit: "1 NEAR",
  gas: Gas.Tgas(100),
})

await market.call.list({ item_id: "99", price: "5000000" }, {
  waitUntil: "FINAL",
})

await market.view.get_price({}, { finality: "optimistic" })
```

`CallOptions` (`gas`, `attachedDeposit`, `signerId`, `waitUntil`) is auto-injected as an optional second parameter on every `call` method. `BlockReference` (`finality`, `blockId`) is auto-injected on every `view` method.

# Common Mistakes

## HIGH: Putting change methods in view namespace or vice versa

```typescript
import type { Contract } from "near-kit"

type BadContract = Contract<{
  view: {
    get_count: () => Promise<number>
    increment: (args: { by: number }) => Promise<void>
  }
  call: {}
}>
```

`increment` mutates state but is in the `view` namespace, so it will be called via `near.view()` — a read-only RPC query that cannot mutate state. The call will fail or return stale data. View methods are free queries; call methods are signed transactions. Place each method in the correct namespace:

```typescript
import type { Contract } from "near-kit"

type Counter = Contract<{
  view: {
    get_count: () => Promise<number>
  }
  call: {
    increment: (args: { by: number }) => Promise<void>
  }
}>
```

## MEDIUM: Adding CallOptions parameter to call method type definition

```typescript
import type { Contract, CallOptions } from "near-kit"

type BadContract = Contract<{
  view: {}
  call: {
    increment: (args: { by: number }, options?: CallOptions) => Promise<void>
  }
}>
```

`Contract<T>` automatically appends `options?: CallOptions` as the last parameter on every `call` method. Adding it yourself results in a double-injection — the runtime proxy will receive `CallOptions` as the **third** argument instead of the second, and TypeScript may not catch the mismatch:

```typescript
import type { Contract } from "near-kit"

type Counter = Contract<{
  view: {}
  call: {
    increment: (args: { by: number }) => Promise<void>
  }
}>

const counter = near.contract<Counter>("counter.testnet")
await counter.call.increment({ by: 1 }, { gas: "100 Tgas" })
```
