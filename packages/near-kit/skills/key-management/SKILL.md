---
name: key-management
description: Choose and configure KeyStore implementations for different environments — InMemoryKeyStore for testing, FileKeyStore for dev/servers (subpath import near-kit/keys/file), NativeKeyStore for production OS keyring (subpath import near-kit/keys/native), RotatingKeyStore for high-throughput concurrency.
type: core
library: near-kit
library_version: "0.14.0"
sources:
  - r-near/near-kit:docs/in-depth/key-management.mdx
  - r-near/near-kit:packages/near-kit/src/keys/
requires: client-setup
---

# Key Management

near-kit provides four KeyStore implementations. All implement the same `KeyStore` interface (`add`, `get`, `remove`, `list`), so you swap them by changing a single line.

**Cross-skill tension:** Getting-started guides use `privateKey` in code for simplicity. Production code MUST use a KeyStore or NativeKeyStore — never hard-code keys. See `client-setup` skill.

## Setup

### InMemoryKeyStore with initial keys

```typescript
import { InMemoryKeyStore, Near } from "near-kit"

const keyStore = new InMemoryKeyStore({
  "alice.testnet": "ed25519:3D4c2v8K5x...",
  "bob.testnet": "ed25519:7Fg1h9jK2m...",
})

const near = new Near({
  network: "testnet",
  keyStore,
})
```

You can also start empty and add keys later:

```typescript
import { InMemoryKeyStore, Near, parseKey } from "near-kit"

const keyStore = new InMemoryKeyStore()
await keyStore.add("alice.testnet", parseKey("ed25519:3D4c2v8K5x..."))

const near = new Near({
  network: "testnet",
  keyStore,
})
```

## Core Patterns

### 1. FileKeyStore for NEAR-CLI compatible credentials

FileKeyStore reads/writes the same `~/.near-credentials/` directory that `near-cli` uses. Node.js/Bun only — requires subpath import.

```typescript
import { FileKeyStore } from "near-kit/keys/file"
import { Near } from "near-kit"

const keyStore = new FileKeyStore("~/.near-credentials", "testnet")

const near = new Near({
  network: "testnet",
  keyStore,
})

await near.transaction("alice.testnet").transfer("bob.testnet", "1 NEAR").send()
```

FileKeyStore also reads multi-key directories (`account.testnet/ed25519_*.json`) but writes in simple format (`account.testnet.json`).

### 2. NativeKeyStore for OS keyring

Uses macOS Keychain, Windows Credential Manager, or Linux keyutils. Requires `@napi-rs/keyring` (installed automatically as a dependency). Node.js/Bun only — requires subpath import.

```typescript
import { NativeKeyStore } from "near-kit/keys/native"
import { Near } from "near-kit"

const keyStore = new NativeKeyStore()

const near = new Near({
  network: "mainnet",
  keyStore,
})

await keyStore.add("admin.near", keyPair)
```

Custom service name (appears in Keychain Access / Credential Manager):

```typescript
const keyStore = new NativeKeyStore("MyApp NEAR Keys")
```

### 3. RotatingKeyStore for concurrent transactions

NEAR processes transactions per-access-key sequentially. Sending 50 concurrent transactions with one key causes nonce collisions. RotatingKeyStore cycles through multiple keys round-robin.

```typescript
import { RotatingKeyStore, Near } from "near-kit"

const keyStore = new RotatingKeyStore({
  "bot.near": [
    "ed25519:key1...",
    "ed25519:key2...",
    "ed25519:key3...",
  ],
})

const near = new Near({ network: "testnet", keyStore })

await Promise.all([
  near.send("bot.near", "a.near", "1 NEAR"),
  near.send("bot.near", "b.near", "1 NEAR"),
  near.send("bot.near", "c.near", "1 NEAR"),
])
```

Inspection helpers:

```typescript
const keys = await keyStore.getAll("bot.near")
const index = keyStore.getCurrentIndex("bot.near")
keyStore.resetCounter("bot.near")
keyStore.clear()
```

### 4. Access key permission types (fullAccess vs functionCall)

When adding a key with `.addKey()`, define what the key can do:

**Full access key** — can do anything (transfer, delete account, deploy code, add keys):

```typescript
import { Near, generateKey } from "near-kit"

const near = new Near({ network: "testnet", privateKey: "ed25519:..." })
const newKey = generateKey()

await near
  .transaction("alice.testnet")
  .addKey(newKey.publicKey, { type: "fullAccess" })
  .send()
```

**Function-call access key** — can only call specific methods on a specific contract:

```typescript
await near
  .transaction("alice.testnet")
  .addKey(newKey.publicKey, {
    type: "functionCall",
    receiverId: "game.near",
    methodNames: ["move", "attack"],
    allowance: "0.25 NEAR",
  })
  .send()
```

## Common Mistakes

### CRITICAL: Importing FileKeyStore or NativeKeyStore from main entry

`FileKeyStore` and `NativeKeyStore` depend on Node.js APIs (`node:fs/promises`, `@napi-rs/keyring`) and are **not** exported from the main `"near-kit"` entry. Importing from the wrong path causes build failures in browser environments.

```typescript
// WRONG — will fail at runtime or during bundling
import { FileKeyStore } from "near-kit"

// CORRECT — subpath import
import { FileKeyStore } from "near-kit/keys/file"
import { NativeKeyStore } from "near-kit/keys/native"
```

`InMemoryKeyStore` and `RotatingKeyStore` ARE available from the main entry:

```typescript
import { InMemoryKeyStore, RotatingKeyStore } from "near-kit"
```

### MEDIUM: Trying to list keys with NativeKeyStore

`NativeKeyStore.list()` always returns `[]`. OS keyrings do not support credential enumeration for security reasons. Track account IDs separately (e.g., in a config file or database) and use `get(accountId)` to retrieve specific keys.

```typescript
const accounts = await nativeKeyStore.list()
// Always [] — not a bug, by design

const key = await nativeKeyStore.get("admin.near")
// Use this instead — returns the key or null
```

---

See also: [client-setup], [transaction-builder]
