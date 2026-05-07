# Transaction Builder Reference

Fluent API for constructing multi-action NEAR transactions.

## Table of Contents

- [Basic Usage](#basic-usage)
- [Available Actions](#available-actions)
- [Multi-Action Transactions](#multi-action-transactions)
- [Meta-Transactions (NEP-366)](#meta-transactions-nep-366)
- [Manual Sign Flow](#manual-sign-flow)

---

## Basic Usage

```typescript
const receipt = await near
  .transaction("alice.near")  // Signer account
  .transfer("bob.near", "1 NEAR")
  .send()

console.log("Transaction hash:", receipt.transaction.hash)
```

---

## Available Actions

### Transfer

Send NEAR tokens. Amount accepts human-readable strings or `Amount` helper.

```typescript
await near
  .transaction("alice.near")
  .transfer("bob.near", "10 NEAR")
  .send()

// With Amount helper
import { Amount } from "near-kit"

await near
  .transaction("alice.near")
  .transfer("bob.near", Amount.NEAR(10.5))
  .send()

// Raw yoctoNEAR
await near
  .transaction("alice.near")
  .transfer("charlie.near", Amount.yocto(1000000n))
  .send()
```

### Function Call

Call a smart contract method. The 4th argument is optional.

```typescript
await near
  .transaction("alice.near")
  .functionCall("contract.near", "store_data", { key: "value" })
  .send()

await near
  .transaction("alice.near")
  .functionCall("contract.near", "store_data", { key: "value" }, {
    gas: "50 Tgas",
    attachedDeposit: "0.1 NEAR",
  })
  .send()
```

Options: `gas` (default 30 Tgas), `attachedDeposit` (default 0), `signerId`, `waitUntil`.

### Create Account

```typescript
await near
  .transaction("alice.near")
  .createAccount("sub.alice.near")
  .transfer("sub.alice.near", "1 NEAR")
  .send()
```

The new account ID must end with the signer's account ID (e.g., `bob.alice.near`).

### Delete Account

```typescript
await near
  .transaction("account-to-delete.near")
  .deleteAccount({ beneficiary: "alice.near" })
  .send()
```

`deleteAccount` requires an options object with a `beneficiary` key, not a bare string.

### Deploy Contract

```typescript
const wasm = await fs.readFile("./contract.wasm")
await near
  .transaction("alice.near")
  .deployContract("contract.alice.near", wasm)
  .send()
```

### Publish Contract (Global Contracts)

Publish Wasm to the global contract registry:

```typescript
await near
  .transaction("alice.near")
  .publishContract(wasmBuffer)
  .send()

// Immutable (hash-identified) — cannot be updated
await near
  .transaction("alice.near")
  .publishContract(wasmBuffer, { identifiedBy: "hash" })
  .send()
```

Options: `identifiedBy` — `"account"` (updatable, default) or `"hash"` (immutable).

### Deploy From Published

Deploy a contract from the global registry by referencing its code:

```typescript
// Reference by publisher account
await near
  .transaction("alice.near")
  .deployFromPublished({ accountId: "factory.near" })
  .send()

// Reference by code hash
await near
  .transaction("alice.near")
  .deployFromPublished({ codeHash: "5FzD8..." })
  .send()
```

### State Init (NEP-616)

Deterministic account deployment. Creates account at a predictable address derived from initialization state.

```typescript
import { createStateInit, deriveAccountId } from "near-kit"

const stateInit = createStateInit({
  code: { accountId: "publisher.near" },
  data: new Map([[encoder.encode("owner"), encoder.encode("alice.near")]]),
  deposit: "1 NEAR",
})

await near
  .transaction("alice.near")
  .stateInit(stateInit)
  .send()
```

### Add Key

```typescript
// Full access key
await near
  .transaction("alice.near")
  .addKey("ed25519:...", { type: "fullAccess" })
  .send()

// Function call access key (restricted)
await near
  .transaction("alice.near")
  .addKey("ed25519:...", {
    type: "functionCall",
    receiverId: "game.near",
    methodNames: ["move", "attack"],
    allowance: "0.25 NEAR",
  })
  .send()
```

`methodNames`: empty array `[]` allows any method. `allowance`: max gas fees this key can spend.

### Delete Key

```typescript
await near
  .transaction("alice.near")
  .deleteKey("alice.near", "ed25519:...")
  .send()
```

### Stake

```typescript
await near
  .transaction("alice.near")
  .stake("ed25519:VALIDATOR_KEY...", "100 NEAR")
  .send()
```

To unstake, call the staking pool contract's `unstake` method via `.functionCall()`.

### Signed Delegate Action

Used by relayers to submit meta-transactions:

```typescript
await near
  .transaction("relayer.near")
  .signedDelegateAction(signedDelegate)
  .send()
```

---

## Multi-Action Transactions

Chain multiple actions in a single atomic transaction — either all succeed or all fail.

```typescript
// Batch function call + transfer
const result = await near.transaction(accountId)
  .functionCall("counter.near-examples.testnet", "increment", {}, { gas: "30 Tgas" })
  .transfer("counter.near-examples.testnet", "0.001 NEAR")
  .send()

// Create + fund + deploy + initialize (factory pattern)
await near
  .transaction("alice.near")
  .createAccount("app.alice.near")
  .transfer("app.alice.near", "5 NEAR")
  .addKey(publicKey, { type: "fullAccess" })
  .deployContract("app.alice.near", contractWasm)
  .functionCall("app.alice.near", "init", { owner: "alice.near" })
  .send()
```

**Security note:** Always deploy and initialize in the same transaction. Anyone can call `init` on an uninitialized contract and take ownership.

---

## Meta-Transactions (NEP-366)

Gasless transactions where a relayer pays for gas.

### User Side (Signs Off-Chain)

```typescript
import { Near } from "near-kit"

const userNear = new Near({
  network: "testnet",
  privateKey: "ed25519:...",
  defaultSignerId: "user.testnet",
})

// Build and sign delegate action (no gas cost, no network activity)
const { signedDelegateAction, payload } = await userNear
  .transaction("user.testnet")
  .functionCall(
    "contract.near",
    "do_something",
    { arg: "value" },
    { gas: "30 Tgas" }
  )
  .delegate({
    blockHeightOffset: 100, // Valid for ~100 blocks (~100 seconds)
  })

// Send payload to relayer via API
await fetch("/api/relay", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ payload }),
})
```

`delegate()` options:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `receiverId` | `string` | From actions | Override receiver |
| `maxBlockHeight` | `bigint` | Computed | Explicit block height for expiration |
| `blockHeightOffset` | `number` | `200` | Expiration window in blocks |
| `nonce` | `bigint` | Fetched from RPC | Override delegate nonce |
| `publicKey` | `string \| PublicKey` | Resolved key | Override signing key |
| `payloadFormat` | `"base64" \| "bytes"` | `"base64"` | Encoding for the payload |

Returns `{ signedDelegateAction, payload, format }`. The `payload` is a base64 string (or `Uint8Array` if `payloadFormat: "bytes"`).

### Relayer Side (Pays Gas)

```typescript
import { decodeSignedDelegateAction, Near } from "near-kit"

const relayerNear = new Near({
  network: "testnet",
  privateKey: "ed25519:...",
  defaultSignerId: "relayer.testnet",
})

// Decode the payload from user
const signedDelegate = decodeSignedDelegateAction(payload)

// Validate the inner action before submitting
const innerAction = signedDelegate.delegateAction
const ALLOWED_RECEIVERS = ["game.near", "token.near"]
if (!ALLOWED_RECEIVERS.includes(innerAction.receiverId)) {
  throw new Error("Invalid target contract")
}

const ALLOWED_METHODS = ["move", "attack", "claim"]
for (const action of innerAction.actions) {
  if ("functionCall" in action) {
    if (!ALLOWED_METHODS.includes(action.functionCall.methodName)) {
      throw new Error(`Method not allowed: ${action.functionCall.methodName}`)
    }
  }
}

// Submit to blockchain (relayer pays gas)
const result = await relayerNear
  .transaction("relayer.testnet")
  .signedDelegateAction(signedDelegate)
  .send()

// Contract sees user as the signer, relayer paid the gas
```

**Security:** Always whitelist `receiverId` AND `methodName` on the relayer. Without validation, an attacker can drain the relayer's gas by invoking arbitrary contracts/methods.

---

## Manual Sign Flow

Build, sign, inspect, and send transactions separately.

```typescript
import { Near } from "near-kit"

const near = new Near({ network: "testnet" })

// Build a transaction and attach a signer key
const tx = near
  .transaction(accountId)
  .transfer("receiver-account.testnet", "0.001 NEAR")
  .signWith(privateKey) // specify which key signs

// Sign the transaction (but don't send yet)
await tx.sign()

// Get the transaction hash before sending
const hash = tx.getHash()

// Serialize the signed transaction (for offline use or external sending)
const serialized = tx.serialize()

// Now send the signed transaction
const result = await tx.send()
```

### signWith()

Override the signer for a specific transaction. Accepts a private key string or a custom `Signer` function.

```typescript
// Private key string
.signWith("ed25519:OTHER_KEY...")

// Custom signer function (e.g., hardware wallet, KMS)
import type { Signer, Signature } from "near-kit"

const ledgerSigner: Signer = async (message: Uint8Array): Promise<Signature> => {
  const sig = await ledgerDevice.sign(message)
  return { keyType: 0, data: sig }
}

.signWith(ledgerSigner)
```

`signWith` overrides **how** the transaction is signed, not **who** signs it. The `signerId` set via `.transaction()` remains the same.

### Wait Until Options

```typescript
await near
  .transaction("alice.near")
  .transfer("bob.near", "1 NEAR")
  .send({ waitUntil: "FINAL" })
```

Options:
- `"INCLUDED"` — Transaction in a block, no return data yet
- `"EXECUTED_OPTIMISTIC"` (default) — Execution complete, return data available
- `"FINAL"` — BFT finality, 100% irreversible
