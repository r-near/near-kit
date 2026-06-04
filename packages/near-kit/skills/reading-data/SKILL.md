---
name: reading-data
description: Query contract view methods, account balances, access keys, and run parallel reads. Covers near.view<T>, getBalance, getAccount, accountExists, batch, and block references for historical data.
type: core
library: near-kit
library_version: "0.14.0"
sources:
  - r-near/near-kit:docs/essentials/reading-data.mdx
  - r-near/near-kit:packages/near-kit/src/core/near.ts
requires: client-setup
---

# Setup

## Read-only client (no credentials needed)

```typescript
import { Near } from "near-kit"

const near = new Near({ network: "mainnet" })
```

No `privateKey`, `signer`, `keyStore`, or `wallet` required for view operations.

# Core Patterns

## 1. Typed view calls

```typescript
import { Near } from "near-kit"

const near = new Near({ network: "mainnet" })

const count = await near.view<number>("counter.near", "get_count")
const owner = await near.view<string>("nft.example.near", "nft_owner", { token_id: "1" })
const metadata = await near.view<{ name: string; symbol: string }>("token.example.near", "ft_metadata")
```

The generic type `T` is a compile-time assertion — no runtime validation is performed.

## 2. Historical data with block references

```typescript
import { Near } from "near-kit"

const near = new Near({ network: "mainnet" })

const optimisticCount = await near.view<number>("counter.near", "get_count", {}, {
  finality: "optimistic",
})

const finalizedCount = await near.view<number>("counter.near", "get_count", {}, {
  finality: "final",
})

const historicalCount = await near.view<number>("counter.near", "get_count", {}, {
  blockId: 27912554,
})

const byHash = await near.view<number>("counter.near", "get_count", {}, {
  blockId: "3Xz2wM9rigMXzA2c5vgCP8wTgFBaePucgUmVYPkMqhRL",
})
```

Block reference options: `finality` (`"optimistic"` | `"near-final"` | `"final"`) or `blockId` (number or hash string). If both are provided, `blockId` takes precedence.

## 3. Parallel reads with batch()

```typescript
import { Near } from "near-kit"

const near = new Near({ network: "mainnet" })

const [balance, count, metadata] = await near.batch(
  near.getBalance("alice.near"),
  near.view<number>("counter.near", "get_count"),
  near.view<{ name: string }>("token.near", "ft_metadata"),
)
```

`batch()` is a tuple-preserving wrapper over `Promise.all`. It does not perform RPC-level batching.

## 4. Account state with getAccount()

```typescript
import { Near } from "near-kit"

const near = new Near({ network: "mainnet" })

const available = await near.getBalance("alice.near")

const account = await near.getAccount("alice.near")
account.balance
account.available
account.staked
account.storageUsage
account.storageBytes
account.hasContract
account.codeHash

const exists = await near.accountExists("alice.near")

const accessKey = await near.getAccessKey("alice.near", "ed25519:...")
const allKeys = await near.getAccessKeys("alice.near")
```

`getBalance` returns the spendable balance as a formatted string (e.g. `"98.50"`). `getAccount` returns the full `AccountState` object with all computed fields.

# Common Mistakes

## HIGH: Confusing available balance with total balance

```typescript
import { Near } from "near-kit"

const near = new Near({ network: "mainnet" })

const balance = await near.getBalance("alice.near")
```

`getBalance` returns the **available** (spendable) balance, not the total. Some liquid balance may be reserved for storage. Use `getAccount()` to see all fields:

```typescript
const account = await near.getAccount("alice.near")
account.balance
account.available
account.staked
account.storageUsage
```

## MEDIUM: Calling near.view without generic type

```typescript
import { Near } from "near-kit"

const near = new Near({ network: "mainnet" })

const result = await near.view("counter.near", "get_count")
```

Without a generic, `result` is typed as `unknown`. Always specify the expected return type:

```typescript
const count = await near.view<number>("counter.near", "get_count")
```

## MEDIUM: Not passing args object for no-arg methods

```typescript
import { Near } from "near-kit"

const near = new Near({ network: "mainnet" })

const count = await near.view<number>("counter.near", "get_count", undefined, { finality: "optimistic" })
```

The `args` parameter defaults to `{}` but if you want to pass `options`, you must provide `args` explicitly:

```typescript
const count = await near.view<number>("counter.near", "get_count", {}, { finality: "optimistic" })
```
