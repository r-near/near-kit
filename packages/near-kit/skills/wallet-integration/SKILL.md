---
name: wallet-integration
description: Connect browser wallets to near-kit using adapter functions — fromNearConnect (aliased as fromHotConnect) for @hot-labs/near-connect, fromWalletSelector for legacy @near-wallet-selector/core. Covers wallet lifecycle, signer abstraction, and the universal code pattern.
type: core
library: near-kit
library_version: "0.14.0"
sources:
  - r-near/near-kit:docs/dapp-workflow/frontend-integration.mdx
  - r-near/near-kit:packages/near-kit/src/wallets/adapters.ts
requires: client-setup
---

# Wallet Integration

near-kit abstracts the signer so that the same transaction code works whether signing happens via a private key on a server or a wallet popup in a browser. Wallet adapters convert a wallet library instance into the `WalletConnection` interface that near-kit uses.

## Setup

### Near with fromNearConnect adapter

```typescript
import { NearConnector } from "@hot-labs/near-connect"
import { Near, fromNearConnect } from "near-kit"

const connector = new NearConnector({ network: "testnet" })

connector.on("wallet:signIn", async () => {
  const near = new Near({
    network: "testnet",
    wallet: fromNearConnect(connector),
  })

  const accounts = await connector.wallet().then((w) => w.getAccounts())
  console.log("Connected:", accounts[0].accountId)
})

connector.connect()
```

`fromHotConnect` is a deprecated alias for `fromNearConnect`:

```typescript
import { fromHotConnect } from "near-kit"

const near = new Near({
  network: "testnet",
  wallet: fromHotConnect(connector),
})
```

## Core Patterns

### 1. NEAR Connect setup with event listeners

NEAR Connect emits events for wallet lifecycle. Listen for `wallet:signIn` before creating the `Near` instance.

```typescript
import { NearConnector } from "@hot-labs/near-connect"
import { Near, fromNearConnect } from "near-kit"

const connector = new NearConnector({ network: "testnet" })

connector.on("wallet:signIn", async (data) => {
  const near = new Near({
    network: "testnet",
    wallet: fromNearConnect(connector),
  })
})

connector.on("wallet:signOut", () => {
  console.log("User disconnected")
})

connector.connect()
```

### 2. Universal code pattern (same API for server and browser)

Write business logic once — it works identically regardless of how the `Near` instance is configured.

```typescript
import { Near } from "near-kit"

export async function buyItem(near: Near, signerId: string, itemId: string) {
  return near
    .transaction(signerId)
    .functionCall("market.near", "buy", { item_id: itemId }, {
      attachedDeposit: "1 NEAR",
      gas: "50 Tgas",
    })
    .send()
}
```

Inject the `Near` instance per environment:

```typescript
// Server — private key
const near = new Near({ network: "testnet", privateKey: process.env.KEY })

// Server — key store
import { FileKeyStore } from "near-kit/keys/file"
const keyStore = new FileKeyStore("~/.near-credentials", "testnet")
const near = new Near({ network: "testnet", keyStore })

// Browser — wallet adapter
import { fromNearConnect } from "near-kit"
const near = new Near({ network: "testnet", wallet: fromNearConnect(connector) })

// Test — sandbox
import { Sandbox } from "near-kit/sandbox"
const sandbox = await Sandbox.start()
const near = new Near({ network: sandbox })

// All four call the same function:
await buyItem(near, signerId, "sword-1")
```

### 3. Wallet sign-in/sign-out lifecycle

In a React app, store the `Near` instance in context after wallet sign-in and clear it on sign-out.

```jsx
import { createContext, useContext, useEffect, useState } from "react"
import { Near, fromNearConnect } from "near-kit"
import { NearConnector } from "@hot-labs/near-connect"

const WalletContext = createContext<{ near: Near | null }>(null)

export function WalletProvider({ children }) {
  const [near, setNear] = useState<Near | null>(null)

  useEffect(() => {
    const connector = new NearConnector({ network: "testnet" })

    connector.on("wallet:signIn", async () => {
      setNear(new Near({
        network: "testnet",
        wallet: fromNearConnect(connector),
      }))
    })

    connector.on("wallet:signOut", () => {
      setNear(null)
    })

    connector.connect()
  }, [])

  return (
    <WalletContext.Provider value={{ near }}>{children}</WalletContext.Provider>
  )
}

export const useWallet = () => useContext(WalletContext)
```

## Common Mistakes

### MEDIUM: Using fromWalletSelector instead of fromNearConnect for new projects

`fromWalletSelector` wraps the legacy `@near-wallet-selector/core` library, which is deprecated. `fromNearConnect` (aliased as `fromHotConnect`) is the recommended adapter for all new projects. It supports delegate action signing (`signDelegateActions`) for meta-transactions, which `fromWalletSelector` does not.

```typescript
// AVOID for new projects — legacy adapter
import { fromWalletSelector } from "near-kit"

// PREFERRED — modern adapter with full feature support
import { fromNearConnect } from "near-kit"
```

Only use `fromWalletSelector` if you have an existing integration with `@near-wallet-selector/core` that you cannot migrate yet.

---

See also: [client-setup], [react-provider]
