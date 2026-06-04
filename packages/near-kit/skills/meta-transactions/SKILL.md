---
name: meta-transactions
description: NEP-366 delegate actions for gasless transactions — user signs off-chain with .delegate(), relayer decodes with decodeSignedDelegateAction() and submits with .signedDelegateAction(). Covers relayer security checks, payload format, and the complete client-relayer flow.
type: core
library: near-kit
library_version: "0.14.0"
sources:
  - r-near/near-kit:docs/in-depth/meta-transactions.mdx
  - r-near/near-kit:packages/near-kit/src/core/transaction.ts
  - r-near/near-kit:packages/near-kit/src/core/schema.ts
requires: client-setup, transaction-builder
---

# Meta-Transactions (Gasless)

NEP-366 delegate actions let a user sign a transaction off-chain (free, instant) and a relayer submit it on-chain (pays gas). The user never needs NEAR tokens.

## Setup

### User side — .delegate()

```typescript
import { Near } from "near-kit"

const userNear = new Near({
  network: "testnet",
  privateKey: "ed25519:...",
})

const { signedDelegateAction, payload } = await userNear
  .transaction("user.near")
  .functionCall("game.near", "move", { x: 1, y: 2 })
  .delegate()

console.log("User signed for:", signedDelegateAction.delegateAction.receiverId)

await fetch("https://api.mygame.com/relay", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ payload }),
})
```

### Relayer side — decodeSignedDelegateAction

```typescript
import { Near, decodeSignedDelegateAction } from "near-kit"

const relayer = new Near({
  network: "testnet",
  privateKey: process.env.RELAYER_KEY,
})

const userAction = decodeSignedDelegateAction(payload)
const innerAction = userAction.delegateAction

if (innerAction.receiverId !== "game.near") {
  throw new Error("Invalid target contract")
}

const result = await relayer
  .transaction("relayer.near")
  .signedDelegateAction(userAction)
  .send()
```

## Core Patterns

### 1. Client-side delegate action creation

`.delegate()` builds and signs the action locally — no network activity, no gas cost. It returns:

- `signedDelegateAction` — typed JS object for inspection/debugging
- `payload` — base64-encoded string for transport to the relayer
- `format` — encoding format used (`"base64"` by default)

```typescript
const { signedDelegateAction, payload } = await near
  .transaction("user.near")
  .functionCall("contract.near", "method", { arg: "value" })
  .delegate()
```

Options for controlling expiration and nonce:

```typescript
const result = await near
  .transaction("user.near")
  .functionCall("contract.near", "method", {})
  .delegate({
    receiverId: "contract.near",
    maxBlockHeight: 200000000n,
    blockHeightOffset: 200,
    nonce: 42n,
  })
```

Use `"bytes"` format if you need the raw serialized payload instead of base64:

```typescript
const { payload } = await near
  .transaction("user.near")
  .functionCall("contract.near", "method", {})
  .delegate({ payloadFormat: "bytes" })

// payload is Uint8Array instead of string
```

### 2. Relayer decode + validate + submit

The relayer receives the base64 payload, decodes it, validates the inner action, then wraps it in its own transaction and submits.

```typescript
import { Near, decodeSignedDelegateAction } from "near-kit"

const relayer = new Near({
  network: "testnet",
  privateKey: process.env.RELAYER_KEY,
})

app.post("/relay", async (req, res) => {
  try {
    const { payload } = req.body

    const userAction = decodeSignedDelegateAction(payload)
    const inner = userAction.delegateAction

    const ALLOWED_RECEIVERS = ["game.near", "token.near"]
    if (!ALLOWED_RECEIVERS.includes(inner.receiverId)) {
      return res.status(400).send("Invalid target contract")
    }

    const ALLOWED_METHODS = ["move", "attack", "claim"]
    for (const action of inner.actions) {
      if ("functionCall" in action) {
        if (!ALLOWED_METHODS.includes(action.functionCall.methodName)) {
          return res.status(400).send(`Method not allowed: ${action.functionCall.methodName}`)
        }
      }
    }

    const result = await relayer
      .transaction("relayer.near")
      .signedDelegateAction(userAction)
      .send()

    res.json({ hash: result.transaction.hash })
  } catch (e) {
    console.error(e)
    res.status(500).send("Relay failed")
  }
})
```

### 3. Express.js relayer route

Complete production-ready relayer with method and receiver whitelisting:

```typescript
import express from "express"
import { Near, decodeSignedDelegateAction } from "near-kit"

const app = express()
app.use(express.json())

const relayer = new Near({
  network: "testnet",
  privateKey: process.env.RELAYER_KEY,
})

const WHITELIST: Record<string, string[]> = {
  "game.near": ["move", "attack", "claim"],
  "token.near": ["ft_transfer", "ft_transfer_call"],
}

app.post("/relay", async (req, res) => {
  try {
    const { payload } = req.body

    const userAction = decodeSignedDelegateAction(payload)
    const { receiverId, actions } = userAction.delegateAction

    const allowedMethods = WHITELIST[receiverId]
    if (!allowedMethods) {
      return res.status(400).send("Receiver not whitelisted")
    }

    for (const action of actions) {
      if ("functionCall" in action) {
        if (!allowedMethods.includes(action.functionCall.methodName)) {
          return res.status(400).send(`Method not allowed: ${action.functionCall.methodName}`)
        }
      }
    }

    const result = await relayer
      .transaction("relayer.testnet")
      .signedDelegateAction(userAction)
      .send()

    res.json({ hash: result.transaction.hash })
  } catch (e) {
    console.error(e)
    res.status(500).send("Relay failed")
  }
})

app.listen(3000)
```

## Common Mistakes

### CRITICAL: Relayer not whitelisting receiver contracts

A relayer without receiver validation pays for **any** contract call a user submits. An attacker can drain the relayer's funds by invoking expensive methods on arbitrary contracts.

Always check `userAction.delegateAction.receiverId` against a whitelist before submitting:

```typescript
const ALLOWED = ["game.near", "token.near"]
if (!ALLOWED.includes(userAction.delegateAction.receiverId)) {
  return res.status(400).send("Invalid target contract")
}
```

### HIGH: Not whitelisting method names on relayer

Even if you whitelist the receiver, unrestricted method access lets users call any method on that contract. A user could call `withdraw` or `admin_reset` if those methods exist on the whitelisted contract.

Always iterate `userAction.delegateAction.actions` and verify each `functionCall.methodName`:

```typescript
for (const action of userAction.delegateAction.actions) {
  if ("functionCall" in action) {
    if (!allowedMethods.includes(action.functionCall.methodName)) {
      return res.status(400).send("Method not allowed")
    }
  }
}
```

### HIGH: Confusing delegate() return value as transaction result

`.delegate()` is a **local signing operation** — it never touches the network. The returned `signedDelegateAction` and `payload` represent a signed intent, not an on-chain result. The transaction is only finalized when the relayer calls `.signedDelegateAction(...).send()`.

```typescript
const { signedDelegateAction, payload } = await near
  .transaction("user.near")
  .functionCall("game.near", "move", { x: 1 })
  .delegate()

// This is NOT a transaction result — no on-chain state change yet.
// Send `payload` to the relayer, which submits it with .send()
```

---

See also: [message-signing], [transaction-builder]
