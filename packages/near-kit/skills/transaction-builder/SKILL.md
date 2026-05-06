---
name: transaction-builder
description: Build complex multi-action atomic transactions using the fluent TransactionBuilder. Covers factory pattern, access key management, global contracts, NEP-616 state init, nonce management, and signWith override.
type: core
library: near-kit
library_version: "0.14.0"
sources:
  - r-near/near-kit:docs/in-depth/advanced-transactions.mdx
  - r-near/near-kit:docs/reference/actions.mdx
  - r-near/near-kit:packages/near-kit/src/core/transaction.ts
requires:
  - client-setup
  - writing-data
references: references/actions.md
---

# Setup

## Client with privateKey, basic transaction chain

```typescript
import { Near } from "near-kit"

const near = new Near({
  network: "testnet",
  privateKey: "ed25519:5nzOS...VKsRf",
  defaultSignerId: "alice.testnet",
})

const result = await near.transaction("alice.testnet")
  .transfer("bob.testnet", "10 NEAR")
  .send()
```

# Core Patterns

## 1. Factory pattern (create + fund + deploy + init)

```typescript
import { Near } from "near-kit"
import { readFileSync } from "node:fs"

const near = new Near({ network: "testnet", privateKey: "ed25519:...", defaultSignerId: "alice.t" })

const wasm = readFileSync("./contract.wasm")

await near.transaction("alice.testnet")
  .createAccount("app.alice.testnet")
  .transfer("app.alice.testnet", "5 NEAR")
  .deployContract("app.alice.testnet", wasm)
  .functionCall("app.alice.testnet", "new", { owner_id: "alice.testnet" })
  .send()
```

All actions execute atomically — either all succeed or all fail.

## 2. Access key management (addKey with functionCall permission)

```typescript
import { Near } from "near-kit"

const near = new Near({ network: "testnet", privateKey: "ed25519:...", defaultSignerId: "alice.t" })

await near.transaction("alice.testnet")
  .addKey("ed25519:BJCfx...hNqi", {
    type: "functionCall",
    receiverId: "contract.testnet",
    methodNames: ["increment", "decrement"],
    allowance: "50 NEAR",
  })
  .send()

await near.transaction("alice.testnet")
  .addKey("ed25519:newFullKey...", {
    type: "fullAccess",
  })
  .send()
```

## 3. Key rotation (add new + delete old)

```typescript
import { Near } from "near-kit"

const near = new Near({ network: "testnet", privateKey: "ed25519:...", defaultSignerId: "alice.t" })

await near.transaction("alice.testnet")
  .addKey("ed25519:NEW_PUBLIC_KEY...", {
    type: "fullAccess",
  })
  .deleteKey("alice.testnet", "ed25519:OLD_PUBLIC_KEY...")
  .send()
```

## 4. .signWith() for per-transaction signer override

```typescript
import { Near, type Signer, type Signature } from "near-kit"

const near = new Near({ network: "testnet", privateKey: "ed25519:...", defaultSignerId: "alice.t" })

await near.transaction("alice.testnet")
  .signWith("ed25519:ANOTHER_KEY_FOR_ALICE...")
  .transfer("bob.testnet", "5 NEAR")
  .send()

const ledgerSigner: Signer = async (message: Uint8Array): Promise<Signature> => {
  const sig = await ledgerDevice.sign(message)
  return { keyType: 0, data: sig }
}

await near.transaction("alice.testnet")
  .signWith(ledgerSigner)
  .transfer("bob.testnet", "1 NEAR")
  .send()
```

`signWith` overrides **how** the transaction is signed, not **who** signs it. The `signerId` set via `.transaction()` remains the same.

## 5. Additional actions

```typescript
import { Near } from "near-kit"

const near = new Near({ network: "testnet", privateKey: "ed25519:...", defaultSignerId: "alice.t" })

await near.transaction("alice.testnet")
  .stake("ed25519:VALIDATOR_KEY...", "1000 NEAR")
  .send()

await near.transaction("old.alice.testnet")
  .deleteAccount({ beneficiary: "alice.testnet" })
  .send()

const wasm = new Uint8Array([])
await near.transaction("alice.testnet")
  .publishContract(wasm)
  .send()

await near.transaction("alice.testnet")
  .publishContract(wasm, { identifiedBy: "hash" })
  .send()

await near.transaction("alice.testnet")
  .deployFromPublished({ accountId: "publisher.testnet" })
  .send()

await near.transaction("alice.testnet")
  .stateInit({
    code: { accountId: "publisher.testnet" },
    deposit: "1 NEAR",
  })
  .send()
```

## 6. Sign, serialize, send pipeline

```typescript
import { Near } from "near-kit"

const near = new Near({ network: "testnet", privateKey: "ed25519:...", defaultSignerId: "alice.t" })

const tx = await near.transaction("alice.testnet")
  .transfer("bob.testnet", "1 NEAR")
  .sign()

tx.getHash()

const bytes = tx.serialize()

const result = await tx.send({ waitUntil: "FINAL" })
```

# Common Mistakes

## CRITICAL: Deploying contract without initializing

```typescript
import { Near } from "near-kit"

const near = new Near({ network: "testnet", privateKey: "ed25519:...", defaultSignerId: "alice.t" })

await near.transaction("alice.testnet")
  .createAccount("app.alice.testnet")
  .transfer("app.alice.testnet", "5 NEAR")
  .deployContract("app.alice.testnet", wasm)
  .send()
```

Anyone can call `new`/`init` on an uninitialized contract and take ownership. Always chain `functionCall` with the init method in the same transaction:

```typescript
await near.transaction("alice.testnet")
  .createAccount("app.alice.testnet")
  .transfer("app.alice.testnet", "5 NEAR")
  .deployContract("app.alice.testnet", wasm)
  .functionCall("app.alice.testnet", "new", { owner_id: "alice.testnet" })
  .send()
```

## CRITICAL: Passing raw number instead of unit string

```typescript
await near.transaction("alice.testnet")
  .transfer("bob.testnet", 10)
  .send()
```

Throws `Ambiguous amount: "10"`. Always include units:

```typescript
await near.transaction("alice.testnet")
  .transfer("bob.testnet", "10 NEAR")
  .send()
```

## HIGH: Concurrent transactions without RotatingKeyStore (InvalidNonceError)

```typescript
import { Near } from "near-kit"

const near = new Near({ network: "testnet", privateKey: "ed25519:...", defaultSignerId: "alice.t" })

await Promise.all([
  near.transaction("alice.testnet").transfer("bob.testnet", "1 NEAR").send(),
  near.transaction("alice.testnet").transfer("carol.testnet", "1 NEAR").send(),
])
```

Single key + concurrent transactions = nonce collision. Use `RotatingKeyStore` with multiple keys:

```typescript
import { Near, RotatingKeyStore } from "near-kit"

const keyStore = new RotatingKeyStore({
  "alice.testnet": ["ed25519:key1...", "ed25519:key2...", "ed25519:key3..."],
})

const near = new Near({ network: "testnet", keyStore, defaultSignerId: "alice.testnet" })

await Promise.all([
  near.transaction("alice.testnet").transfer("bob.testnet", "1 NEAR").send(),
  near.transaction("alice.testnet").transfer("carol.testnet", "1 NEAR").send(),
  near.transaction("alice.testnet").transfer("dave.testnet", "1 NEAR").send(),
])
```

The builder retries `InvalidNonceError` up to 3 times automatically, but with high concurrency this is insufficient without key rotation.

## HIGH: Assuming cross-contract calls are rolled back (atomicity stops at tx boundary)

```typescript
await near.transaction("alice.testnet")
  .functionCall("token.near", "transfer", { receiver_id: "bob.t", amount: "100" })
  .functionCall("nft.near", "nft_transfer", { receiver_id: "bob.t", token_id: "1" })
  .send()
```

These two `functionCall` actions are atomic within **this** transaction. But if `token.near.transfer` internally makes a cross-contract call (async call to another contract), that async call runs in a separate receipt and is **not** rolled back if a later action fails. Atomicity guarantees stop at the transaction boundary.

## HIGH: Forgetting attached deposit on function calls

```typescript
await near.transaction("alice.testnet")
  .functionCall("nft.example.near", "nft_mint", { token_id: "42" })
  .send()
```

Contracts that require storage payment will panic. Attach deposit:

```typescript
await near.transaction("alice.testnet")
  .functionCall("nft.example.near", "nft_mint", { token_id: "42" }, {
    attachedDeposit: "0.1 NEAR",
  })
  .send()
```

## MEDIUM: Wrong deleteAccount argument shape

```typescript
await near.transaction("old.alice.testnet")
  .deleteAccount("alice.testnet")
  .send()
```

`deleteAccount` requires an options object with a `beneficiary` key, not a bare string:

```typescript
await near.transaction("old.alice.testnet")
  .deleteAccount({ beneficiary: "alice.testnet" })
  .send()
```

> **Cross-skill tension:** Concurrent throughput vs single-key simplicity — See key-management skill for RotatingKeyStore.

See also: meta-transactions, key-management
