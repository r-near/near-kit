---
name: client-setup
description: Initialize the Near client with network presets, private keys, keystores, wallets, custom signers, or sandbox instances. Covers NearConfig, credential resolution order (wallet > signer > privateKey > keyStore), defaultSignerId, and environment-specific patterns.
type: core
library: near-kit
library_version: "0.14.0"
sources:
  - r-near/near-kit:docs/start-here/quickstart.mdx
  - r-near/near-kit:docs/reference/configuration.mdx
  - r-near/near-kit:packages/near-kit/src/core/near.ts
---

# Setup

## 4 Environment Configs

### Script / CLI with privateKey

```typescript
import { Near } from "near-kit"

const near = new Near({
  network: "testnet",
  privateKey: "ed25519:5nzOS...VKsRf",
  defaultSignerId: "alice.testnet",
})
```

### Server with FileKeyStore

```typescript
import { Near } from "near-kit"
import { FileKeyStore } from "near-kit/keys/file"

const keyStore = new FileKeyStore()

const near = new Near({
  network: "mainnet",
  keyStore,
  defaultSignerId: "bot.near",
})
```

### Browser with wallet

```typescript
import { Near } from "near-kit"
import { fromWalletSelector } from "near-kit"

const selector = await setupWalletSelector({ network: "testnet", modules: [/* ... */] })

const near = new Near({
  network: "testnet",
  wallet: fromWalletSelector(selector),
})
```

### Sandbox for testing

```typescript
import { Near } from "near-kit"
import { Sandbox } from "near-kit/sandbox"

const sandbox = await Sandbox.start()
const near = new Near({ network: sandbox })

await near.transaction(sandbox.rootAccount.id)
  .createAccount("app.test.near")
  .transfer("app.test.near", "5 NEAR")
  .send()

await sandbox.stop()
```

# Core Patterns

## 1. Network Presets and Custom RPC

```typescript
import { Near } from "near-kit"

const mainnet = new Near({ network: "mainnet" })
const testnet = new Near({ network: "testnet" })
const localnet = new Near({ network: "localnet" })

const custom = new Near({
  network: { rpcUrl: "https://rpc.my-node.com", networkId: "custom-chain" },
})

const customWithHeaders = new Near({
  network: "testnet",
  rpcUrl: "https://rpc.proxy.com",
  headers: { "X-API-Key": "secret" },
})
```

## 2. Credential Resolution Order

The `Near` constructor resolves signing credentials in this priority:

1. **wallet** — Browser wallet adapter handles signing internally
2. **signer** — Custom async signing function (hardware wallets, KMS)
3. **privateKey** — Stored into the keyStore automatically; requires `defaultSignerId`
4. **keyStore** — Pluggable storage: `InMemoryKeyStore`, `FileKeyStore`, `RotatingKeyStore`

Only one credential source is needed. Higher-priority sources override lower ones.

```typescript
import { Near } from "near-kit"
import type { Signer, Signature } from "near-kit"

const kmsSigner: Signer = async (message: Uint8Array): Promise<Signature> => {
  const sig = await kmsClient.sign(message)
  return { keyType: 0, data: sig }
}

const near = new Near({
  network: "mainnet",
  signer: kmsSigner,
  defaultSignerId: "treasury.near",
})
```

## 3. defaultSignerId and Per-Transaction signerId

```typescript
import { Near } from "near-kit"

const near = new Near({
  network: "testnet",
  privateKey: "ed25519:5nzOS...VKsRf",
  defaultSignerId: "alice.testnet",
})

await near.send("bob.testnet", "1 NEAR")

await near.call("contract.testnet", "increment", { by: 1 }, {
  signerId: "alice.testnet",
})

await near.transaction("alice.testnet")
  .transfer("bob.testnet", "0.5 NEAR")
  .send()
```

## 4. retryConfig

```typescript
import { Near } from "near-kit"

const near = new Near({
  network: "mainnet",
  retryConfig: {
    maxRetries: 6,
    initialDelayMs: 500,
  },
})
```

# Common Mistakes

## CRITICAL: Passing raw number instead of unit string

```typescript
import { Near } from "near-kit"

const near = new Near({ network: "testnet", privateKey: "ed25519:...", defaultSignerId: "a.t" })

await near.send("bob.near", 10)
```

This throws `Ambiguous amount: "10"`. Amounts must include units:

```typescript
await near.send("bob.near", "10 NEAR")
await near.send("bob.near", Amount.NEAR(10))
```

This same mistake applies to `.transfer()`, `attachedDeposit`, and every `Amount` parameter across all skills.

## CRITICAL: Using near-api-js API patterns

near-kit is a separate library from near-api-js. Do not mix patterns:

```typescript
import { Account } from "@near-js/accounts"
import { parseNearAmount } from "@near-js/utils"

const account = await new Near(config).account("alice.near")
const yocto = parseNearAmount("10")
```

near-kit equivalent:

```typescript
import { Near } from "near-kit"

const near = new Near({ network: "testnet", privateKey: "ed25519:...", defaultSignerId: "alice.near" })
await near.send("bob.near", "10 NEAR")
```

Key differences: `Near` class (not `Account`), unit strings (not `parseNearAmount`), no `.account()` method.

## HIGH: Not providing credentials for write operations

```typescript
import { Near } from "near-kit"

const near = new Near({ network: "testnet" })

await near.send("bob.testnet", "1 NEAR")
```

This throws `No signer ID provided`. Read-only clients work without credentials, but every write operation (`send`, `call`, `transaction`) requires one of: `wallet`, `signer`, `privateKey`, or a populated `keyStore`.

## HIGH: Creating multiple Near instances in React dev mode

```typescript
import { Near } from "near-kit"

function useNear() {
  return new Near({ network: "testnet", privateKey: "ed25519:..." })
}
```

React StrictMode renders twice, creating two `Near` instances with separate nonce caches, causing `InvalidNonceError`. Hoist the instance outside the component or use `useMemo`/`useRef`:

```typescript
import { Near } from "near-kit"
import { useMemo } from "react"

function useNear() {
  return useMemo(() => new Near({ network: "testnet", privateKey: "ed25519:...", defaultSignerId: "a.t" }), [])
}
```

> **Cross-skill tension:** Getting-started simplicity vs production safety — agents default to simplest config (privateKey in code) even for production. See key-management skill.

See also: key-management, wallet-integration
