---
name: message-signing
description: NEP-413 off-chain message signing for gasless authentication — sign messages with near.signMessage(), verify with verifyNep413Signature(), generate nonces with generateNonce(), and prevent replay attacks with nonce storage. Covers client signing, server verification, and nonce expiration.
type: core
library: near-kit
library_version: "0.14.0"
sources:
  - r-near/near-kit:docs/in-depth/message-signing.mdx
  - r-near/near-kit:packages/near-kit/src/utils/nep413.ts
requires: client-setup
---

# Message Signing (NEP-413)

NEP-413 enables off-chain message signing for authentication ("Log in with NEAR") without gas fees or blockchain transactions. The flow: client signs, server verifies, nonce prevents replay.

## Setup

### Client-side signMessage with generateNonce

```typescript
import { Near, generateNonce } from "near-kit"
import { hex } from "@scure/base"

const near = new Near({ network: "testnet", privateKey: "ed25519:..." })

const nonce = generateNonce()

const signedMessage = await near.signMessage({
  message: "Log in to MyApp",
  recipient: "myapp.com",
  nonce,
})

await fetch("/api/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    signedMessage,
    message: "Log in to MyApp",
    recipient: "myapp.com",
    nonce: hex.encode(nonce),
  }),
})
```

## Core Patterns

### 1. Client-side message signing

`near.signMessage()` requests a cryptographic signature from the user's key. The `nonce` must be exactly 32 bytes — use `generateNonce()` which embeds a timestamp for automatic expiration.

```typescript
import { Near, generateNonce } from "near-kit"
import { hex } from "@scure/base"

const near = new Near({ network: "testnet", privateKey: "ed25519:..." })

const nonce = generateNonce()

const signedMessage = await near.signMessage({
  message: "Log in to MyApp",
  recipient: "myapp.com",
  nonce,
})
```

The `signedMessage` object has this shape:

```typescript
type SignedMessage = {
  accountId: string
  publicKey: string
  signature: string
  state?: string
}
```

Send all fields plus the original `message`, `recipient`, and hex-encoded `nonce` to your backend.

### 2. Server-side signature verification

`verifyNep413Signature()` checks the cryptographic signature, confirms the public key belongs to the claimed account (when `near` client is provided), and validates timestamp expiration (default 5 minutes).

```typescript
import { Near, verifyNep413Signature } from "near-kit"
import { hex } from "@scure/base"

const near = new Near({ network: "mainnet" })

app.post("/api/login", async (req, res) => {
  const { signedMessage, message, recipient, nonce } = req.body

  const isValid = await verifyNep413Signature(
    signedMessage,
    {
      message,
      recipient,
      nonce: hex.decode(nonce),
    },
    { near }
  )

  if (!isValid) {
    return res.status(401).send("Invalid or expired signature")
  }

  if (await db.seenNonces.has(nonce)) {
    return res.status(401).send("Replay detected")
  }

  await db.seenNonces.add(nonce, { expiresAt: Date.now() + 5 * 60 * 1000 })

  res.send({ accountId: signedMessage.accountId })
})
```

Custom expiration window:

```typescript
await verifyNep413Signature(signedMessage, params, {
  near,
  maxAge: 10 * 60 * 1000,
})
```

Skip blockchain verification (crypto-only check):

```typescript
await verifyNep413Signature(signedMessage, params)
```

You can also directly check if a key is a full access key on the account:

```typescript
const hasKey = await near.fullAccessKeyExists("alice.near", "ed25519:...")
```

### 3. Nonce generation and replay protection

`generateNonce()` produces a 32-byte nonce where the first 8 bytes are a big-endian millisecond timestamp and the remaining 24 bytes are random. This enables automatic expiration without a separate timestamp field.

**Replay attacks are the #1 security concern.** Cryptographic verification alone is insufficient — an attacker who captures a valid signed message can resubmit it to impersonate the user. You MUST store used nonces server-side and reject duplicates.

```typescript
const nonce = generateNonce()

// Store after successful verification
await db.query(
  "INSERT INTO used_nonces (nonce, account_id, expires_at) VALUES (?, ?, ?)",
  [nonce, signedMessage.accountId, Date.now() + 5 * 60 * 1000]
)

// Check before accepting
const seen = await db.query(
  "SELECT 1 FROM used_nonces WHERE nonce = ? AND expires_at > ?",
  [nonce, Date.now()]
)
if (seen) {
  return res.status(401).send("Replay detected")
}
```

Clean up expired nonces periodically:

```typescript
await db.query("DELETE FROM used_nonces WHERE expires_at < ?", [Date.now()])
```

## Common Mistakes

### CRITICAL: Not storing nonces for replay attack prevention

Crypto verification confirms the signature is mathematically valid. It does NOT prevent an attacker from capturing a valid signed message and resubmitting it. Without nonce storage, every captured signature is a valid login credential until it expires.

```typescript
// WRONG — only crypto check, vulnerable to replay
const isValid = await verifyNep413Signature(signedMessage, params, { near })
if (isValid) {
  res.send({ token: createToken(signedMessage.accountId) })
}

// CORRECT — crypto check + nonce deduplication
const isValid = await verifyNep413Signature(signedMessage, params, { near })
if (!isValid) return res.status(401).send("Invalid signature")

if (await db.seenNonces.has(nonce)) {
  return res.status(401).send("Replay detected")
}
await db.seenNonces.add(nonce)
res.send({ token: createToken(signedMessage.accountId) })
```

### MEDIUM: Not hex-encoding nonce for JSON transport

`generateNonce()` returns a `Uint8Array`. JSON.stringify on a Uint8Array produces `{"0": 104, "1": 116, ...}` — not the original bytes. You must encode it as hex (or base64) for transport, then decode it back on the server.

```typescript
import { hex } from "@scure/base"

// Client — encode before sending
body: JSON.stringify({ nonce: hex.encode(nonce) })

// Server — decode before verifying
nonce: hex.decode(req.body.nonce)
```

`@scure/base` is a dependency of near-kit and is always available.

---

See also: [meta-transactions]
