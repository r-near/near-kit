---
name: migration
description: Migrate from near-api-js to near-kit — no Account class (use Near directly), string units instead of BigInt/parseNearAmount, fluent builder instead of config objects, typed error subclasses instead of TypedError string matching, flat config instead of assembled components.
type: lifecycle
library: near-kit
library_version: "0.14.0"
sources:
  - r-near/near-kit:docs/start-here/migration.mdx
requires:
  - client-setup
see_also:
  - client-setup
---

# Setup

Side-by-side connection setup.

**near-api-js** — manually assemble provider, signer, and account objects:

```typescript
import { Account } from "@near-js/accounts"
import { JsonRpcProvider } from "@near-js/providers"
import { KeyPairSigner } from "@near-js/signers"

const provider = new JsonRpcProvider({
  url: "https://test.rpc.fastnear.com",
})
const signer = KeyPairSigner.fromSecretKey("ed25519:...")
const account = new Account("alice.testnet", provider, signer)
```

**near-kit** — flat config, single Near instance:

```typescript
import { Near } from "near-kit"

const near = new Near({
  network: "testnet",
  privateKey: "ed25519:...",
  defaultSignerId: "alice.testnet",
})
```

# Core Patterns

## 1) Connecting & keys

near-api-js requires assembling separate components (provider, signer, account). near-kit flattens everything into a single config object.

**near-api-js:**

```typescript
import { Account } from "@near-js/accounts"
import { JsonRpcProvider } from "@near-js/providers"
import { KeyPairSigner } from "@near-js/signers"

const provider = new JsonRpcProvider({ url: "https://test.rpc.fastnear.com" })
const signer = KeyPairSigner.fromSecretKey("ed25519:...")
const account = new Account("alice.testnet", provider, signer)
```

**near-kit:**

```typescript
import { Near } from "near-kit"

const near = new Near({
  network: "testnet",
  privateKey: "ed25519:...",
  defaultSignerId: "alice.testnet",
})
```

Key differences:
- `privateKey` automatically sets up an `InMemoryKeyStore` — no manual key pair construction
- `network` resolves RPC URL and chain ID from a name (`"mainnet"`, `"testnet"`, `"sandbox"`)
- No separate `Account` object — all operations go through the `Near` instance directly

## 2) Unit handling

near-api-js requires manual conversion with `parseNearAmount`/`formatNearAmount` and BigInt arithmetic. near-kit parses human-readable strings automatically.

**near-api-js:**

```typescript
import { parseNearAmount } from "@near-js/utils"

const amount = parseNearAmount("10.5")
const gas = "30000000000000"
```

**near-kit:**

```typescript
const amount = "10.5 NEAR"
const gas = "30 Tgas"
```

near-kit accepts these string formats everywhere amounts are expected:
- `"10"` or `10` — interpreted as NEAR
- `"10.5 NEAR"` — explicit NEAR unit
- `"1000 yocto"` — explicit yoctoNEAR unit
- Gas: `"30 Tgas"`, `"100 Tgas"`, or raw numbers

## 3) Calling contracts

near-api-js passes arguments inside a configuration object. near-kit uses a fluent builder chain.

**near-api-js:**

```typescript
const account = new Account("alice.testnet", provider, signer)

await account.callFunction({
  contractId: "market.near",
  methodName: "buy",
  args: { id: "1" },
  gas: "50000000000000",
  deposit: parseNearAmount("1")!,
})
```

**near-kit:**

```typescript
await near
  .transaction("alice.testnet")
  .functionCall(
    "market.near",
    "buy",
    { id: "1" },
    { gas: "50 Tgas", attachedDeposit: "1 NEAR" }
  )
  .send()
```

For single-action calls, near-kit also provides a shorthand:

```typescript
await near.call("market.near", "buy", { id: "1" }, {
  gas: "50 Tgas",
  attachedDeposit: "1 NEAR",
})
```

## 4) Error handling

near-api-js throws generic `TypedError` objects requiring string matching on `e.type`. near-kit throws distinct `Error` subclasses with `instanceof` support.

**near-api-js:**

```typescript
try {
  // ...
} catch (e) {
  if (e.type === "FunctionCallError") {
    // ...
  }
}
```

**near-kit:**

```typescript
import { FunctionCallError } from "near-kit"

try {
  // ...
} catch (e) {
  if (e instanceof FunctionCallError) {
    console.log(e.panic)
    console.log(e.contractId)
    console.log(e.methodName)
    console.log(e.logs)
  }
}
```

Available error subclasses (all extend `NearError` with `code` and optional `data`):
- `FunctionCallError` — contract execution panic
- `AccountDoesNotExistError` — account not found
- `InsufficientBalanceError` — not enough balance (`required`, `available`)
- `NetworkError` — RPC failure (`retryable` flag)
- `InvalidTransactionError` — bad transaction (`retryable`, `shardCongested`)
- `InvalidNonceError` — stale nonce (`retryable` flag)
- `GasLimitExceededError` — out of gas
- `TransactionTimeoutError` — tx took too long
- `WalletError` — wallet operation failed

Many errors expose a `retryable` boolean indicating the operation is safe to retry.

# Common Mistakes

## CRITICAL: Trying to use Account class from near-api-js

near-kit has no `Account` class. All operations go through the `Near` instance directly. The signer identity is determined by `defaultSignerId`, `privateKey`, or the wallet connection — not by constructing an Account object.

```typescript
// WRONG — Account class does not exist in near-kit
import { Account } from "near-kit"
const account = new Account("alice.testnet")

// CORRECT — use Near directly
import { Near } from "near-kit"
const near = new Near({ network: "testnet", privateKey: "ed25519:..." })
await near.call("contract.near", "method", {})
await near.send("bob.testnet", "1 NEAR")
```

## CRITICAL: Using parseNearAmount or formatNearAmount from near-api-js

near-kit does not export or use `parseNearAmount`/`formatNearAmount`. Pass human-readable strings directly.

```typescript
// WRONG — these functions do not exist in near-kit
import { parseNearAmount, formatNearAmount } from "near-kit"
const yocto = parseNearAmount("10.5")

// CORRECT — pass string amounts directly
await near.send("bob.testnet", "10.5 NEAR")
await near.call("contract.near", "method", {}, { attachedDeposit: "1 NEAR" })
```

## CRITICAL: Constructing Near with near-api-js component pattern

Do not try to pass a `JsonRpcProvider`, `KeyPairSigner`, or `Account`-like object to the Near constructor. near-kit uses a flat config schema.

```typescript
// WRONG — near-api-js component assembly pattern
const near = new Near({
  provider: new JsonRpcProvider({ url: "..." }),
  signer: KeyPairSigner.fromSecretKey("ed25519:..."),
})

// CORRECT — flat config
const near = new Near({
  network: "testnet",
  rpcUrl: "https://test.rpc.fastnear.com",
  privateKey: "ed25519:...",
  defaultSignerId: "alice.testnet",
})
```
