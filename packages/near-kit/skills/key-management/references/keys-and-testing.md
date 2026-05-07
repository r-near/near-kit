# Key Stores and Testing

Key management options and local testing with Sandbox.

## Table of Contents

- [Key Stores](#key-stores)
- [Key Utilities](#key-utilities)
- [Sandbox Testing](#sandbox-testing)
- [NEP-413 Message Signing](#nep-413-message-signing)

---

## Key Stores

### InMemoryKeyStore

Ephemeral storage for runtime use. Accepts an optional `Record<string, string>` of account IDs to private key strings.

```typescript
import { Near, InMemoryKeyStore } from "near-kit";

const keyStore = new InMemoryKeyStore({
  "alice.testnet": "ed25519:...",
  "bob.testnet": "ed25519:...",
});

const near = new Near({
  network: "testnet",
  keyStore,
});
```

Add keys later with `parseKey()` — `add()` requires a `KeyPair` object, not a string:

```typescript
import { InMemoryKeyStore, Near, parseKey } from "near-kit";

const keyStore = new InMemoryKeyStore();
await keyStore.add("alice.testnet", parseKey("ed25519:3D4c2v8K5x..."));

const near = new Near({
  network: "testnet",
  keyStore,
});
```

### FileKeyStore

Persistent file-based storage (NEAR CLI compatible). Node.js only — requires subpath import.

```typescript
import { Near } from "near-kit";
import { FileKeyStore } from "near-kit/keys/file";

const keyStore = new FileKeyStore("~/.near-credentials", "testnet");

const near = new Near({
  network: "testnet",
  keyStore,
});
```

FileKeyStore also reads multi-key directories (`account.testnet/ed25519_*.json`) but writes in simple format (`account.testnet.json`).

### NativeKeyStore

OS keyring integration (macOS Keychain, Windows Credential Manager, Linux keyutils). Node.js only — requires subpath import.

```typescript
import { Near } from "near-kit";
import { NativeKeyStore } from "near-kit/keys/native";

const keyStore = new NativeKeyStore(); // optional: custom service name

const near = new Near({
  network: "mainnet",
  keyStore,
});

await keyStore.add("admin.near", keyPair);
```

`NativeKeyStore.list()` always returns `[]` — OS keyrings do not support enumeration for security reasons. Use `get(accountId)` to retrieve specific keys.

### RotatingKeyStore

High-throughput concurrent transactions with multiple keys. Accepts `Record<string, string[]>` mapping account IDs to arrays of private key strings.

```typescript
import { Near, RotatingKeyStore } from "near-kit";

const keyStore = new RotatingKeyStore({
  "bot.near": [
    "ed25519:key1...",
    "ed25519:key2...",
    "ed25519:key3...",
  ],
});

const near = new Near({ network: "testnet", keyStore });

await Promise.all([
  near.send("bot.near", "a.near", "1 NEAR"),
  near.send("bot.near", "b.near", "1 NEAR"),
  near.send("bot.near", "c.near", "1 NEAR"),
]);
```

Inspection helpers:

```typescript
const keys = await keyStore.getAll("bot.near");
const index = keyStore.getCurrentIndex("bot.near");
keyStore.resetCounter("bot.near");
keyStore.clear();
```

### Direct Private Key

Simplest option for scripts.

```typescript
const near = new Near({
  network: "testnet",
  privateKey: "ed25519:...",
  defaultSignerId: "alice.testnet",
});
```

---

## Key Utilities

```typescript
import {
  generateKey,
  generateSeedPhrase,
  parseSeedPhrase,
  parseKey,
  isValidAccountId,
  isPrivateKey,
  isValidPublicKey,
  validatePrivateKey,
} from "near-kit";
```

### generateKey()

```typescript
const key = generateKey();
// key.publicKey  — PublicKey-like object, use .toString() for "ed25519:..."
// key.secretKey  — string "ed25519:..."
```

### generateSeedPhrase()

```typescript
const seedPhrase = generateSeedPhrase();
// "word1 word2 word3 ... word12"
// Optional: generateSeedPhrase(24) for 24-word phrase
```

### parseSeedPhrase()

```typescript
const keyPair = parseSeedPhrase(seedPhrase);
const publicKey = keyPair.publicKey.toString(); // "ed25519:..."

await near.call("testnet", "create_account", {
  new_account_id: "new-account.testnet",
  new_public_key: publicKey,
});
```

### Full Seed Phrase Flow

```typescript
import { Near, generateSeedPhrase, parseSeedPhrase } from "near-kit";

const near = new Near({
  network: "testnet",
  privateKey: "ed25519:...",
  defaultSignerId: accountId,
});

const seedPhrase = generateSeedPhrase();
const keyPair = parseSeedPhrase(seedPhrase);
const publicKey = keyPair.publicKey.toString();

const newAccountId = `acc-${Date.now()}.testnet`;
await near.call("testnet", "create_account", {
  new_account_id: newAccountId,
  new_public_key: publicKey,
});
```

### Validation

```typescript
isValidAccountId("alice.near"); // true
isValidAccountId("INVALID"); // false
isPrivateKey("ed25519:..."); // true
isValidPublicKey("ed25519:..."); // true
validatePrivateKey("ed25519:..."); // throws if invalid, returns key string if valid
```

### parseKey() for KeyStore.add()

`KeyStore.add()` requires a `KeyPair` object, not a string. Use `parseKey()` to convert:

```typescript
import { InMemoryKeyStore, parseKey } from "near-kit";

const keyStore = new InMemoryKeyStore();
await keyStore.add("alice.testnet", parseKey("ed25519:3D4c2v8K5x..."));
```

---

## Sandbox Testing

Local NEAR node for integration testing.

### Basic Usage

```typescript
import { Near } from "near-kit";
import { Sandbox } from "near-kit/sandbox";

const sandbox = await Sandbox.start();
const near = new Near({ network: sandbox });

// Root account available for setup
console.log("Root account:", sandbox.rootAccount.id);
// e.g., "test.near"

// Create test account
const testAccount = `test-${Date.now()}.${sandbox.rootAccount.id}`;
await near
  .transaction(sandbox.rootAccount.id)
  .createAccount(testAccount)
  .transfer(testAccount, "10 NEAR")
  .send();

// Run tests...

await sandbox.stop();
```

When `network: sandbox` is passed to `Near`, the constructor auto-detects the sandbox root account key and adds it to the internal keystore. You do not need to pass `privateKey` or `defaultSignerId` separately.

### Vitest Integration

```typescript
import { describe, test, beforeAll, afterAll, expect } from "vitest";
import { Near } from "near-kit";
import { Sandbox } from "near-kit/sandbox";

describe("My Contract Tests", () => {
  let sandbox: Sandbox;
  let near: Near;

  beforeAll(async () => {
    sandbox = await Sandbox.start();
    near = new Near({ network: sandbox });
  }, 60000); // Sandbox startup timeout

  afterAll(async () => {
    if (sandbox) await sandbox.stop();
  });

  test("should create account", async () => {
    const account = `test-${Date.now()}.${sandbox.rootAccount.id}`;

    await near
      .transaction(sandbox.rootAccount.id)
      .createAccount(account)
      .transfer(account, "5 NEAR")
      .send();

    const exists = await near.accountExists(account);
    expect(exists).toBe(true);

    const balance = await near.getBalance(account);
    expect(parseFloat(balance)).toBeGreaterThan(0);
  });

  test("should deploy and call contract", async () => {
    const contractWasm = await fs.readFile("./contract.wasm");
    const contract = `contract-${Date.now()}.${sandbox.rootAccount.id}`;

    await near
      .transaction(sandbox.rootAccount.id)
      .createAccount(contract)
      .transfer(contract, "10 NEAR")
      .deployContract(contract, contractWasm)
      .functionCall(contract, "init", { owner: sandbox.rootAccount.id })
      .send();

    const result = await near.view(contract, "get_owner", {});
    expect(result).toBe(sandbox.rootAccount.id);
  });
});
```

### Unique Account Names

Always use unique names to avoid conflicts across tests within the same Sandbox instance:

```typescript
const uniqueAccount = `test-${Date.now()}.${sandbox.rootAccount.id}`;
// e.g., "test-1706012345678.test.near"
```

Alternatively, use `restoreState()` or `restart()` between tests to reset to a known clean state.

### Patching State

Use `patchState()` to directly modify blockchain state without sending transactions:

```typescript
import { EMPTY_CODE_HASH } from "near-kit/sandbox";
import type { StateRecord } from "near-kit/sandbox";

const records: StateRecord[] = [
  {
    Account: {
      account_id: accountId,
      account: {
        amount: "5000000000000000000000000",
        locked: "0",
        code_hash: EMPTY_CODE_HASH,
        storage_usage: 100,
      },
    },
  },
  {
    AccessKey: {
      account_id: accountId,
      public_key: "ed25519:...",
      access_key: { nonce: 0, permission: "FullAccess" },
    },
  },
];

await sandbox.patchState(records);
```

### Fast-Forwarding Blocks

```typescript
await sandbox.fastForward(100);
```

### Snapshots and Restart

```typescript
const snapshot = await sandbox.dumpState();
await sandbox.restoreState(snapshot);

const snapshotPath = await sandbox.saveSnapshot();
const loaded = await sandbox.loadSnapshot(snapshotPath);

await sandbox.restart();
await sandbox.restart(snapshot); // merge records into genesis
```

---

## NEP-413 Message Signing

Gasless authentication using cryptographic signatures.

### Client Side (Sign Message)

`near.signMessage()` auto-generates a nonce if not provided. The returned `SignedMessage` contains `{ accountId, publicKey, signature, state? }` — the `message`, `recipient`, and `nonce` are NOT included and must be tracked separately.

```typescript
import { Near, generateNonce } from "near-kit";
import { hex } from "@scure/base";

const near = new Near({
  network: "mainnet",
  privateKey: "ed25519:...",
  defaultSignerId: "user.near",
});

// Generate nonce for replay protection
const nonce = generateNonce(); // 32-byte Uint8Array

// Sign message (no gas cost)
const signedMessage = await near.signMessage({
  message: "Sign in to My App",
  recipient: "myapp.com",
  nonce,
});

// Send to server for verification — hex-encode nonce for JSON transport
await fetch("/api/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    signedMessage,
    message: "Sign in to My App",
    recipient: "myapp.com",
    nonce: hex.encode(nonce),
  }),
});
```

### Server Side (Verify Signature)

`verifyNep413Signature()` checks the cryptographic signature, confirms the public key belongs to the claimed account (when `near` client is provided), and validates timestamp expiration (default 5 minutes).

```typescript
import { Near, verifyNep413Signature } from "near-kit";
import { hex } from "@scure/base";

const near = new Near({ network: "mainnet" });

app.post("/api/login", async (req, res) => {
  const { signedMessage, message, recipient, nonce } = req.body;

  const isValid = await verifyNep413Signature(
    signedMessage,
    {
      message,
      recipient,
      nonce: hex.decode(nonce), // decode hex back to Uint8Array
    },
    { near }, // maxAge defaults to 5 minutes (300000ms)
  );

  if (!isValid) {
    return res.status(401).send("Invalid or expired signature");
  }

  if (await db.seenNonces.has(nonce)) {
    return res.status(401).send("Replay detected");
  }

  await db.seenNonces.add(nonce, { expiresAt: Date.now() + 5 * 60 * 1000 });
  res.send({ accountId: signedMessage.accountId });
});
```

Custom expiration window:

```typescript
await verifyNep413Signature(signedMessage, params, {
  near,
  maxAge: 10 * 60 * 1000, // 10 minutes
});
```

Skip blockchain verification (crypto-only check):

```typescript
await verifyNep413Signature(signedMessage, params);
// No near client — only checks signature math, not key ownership
```

### SignedMessage Structure

```typescript
interface SignedMessage {
  accountId: string;
  publicKey: string;
  signature: string;
  state?: string;
}
```

The `message`, `recipient`, and `nonce` are NOT part of `SignedMessage`. They must be sent alongside it and passed separately to `verifyNep413Signature()`.
