# near-kit

[![codecov](https://codecov.io/gh/r-near/near-kit/graph/badge.svg?token=F52NQ1DYG1)](https://codecov.io/gh/r-near/near-kit)
[![npm version](https://img.shields.io/npm/v/near-kit.svg)](https://www.npmjs.com/package/near-kit)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)

A simple, intuitive TypeScript library for interacting with NEAR Protocol. Designed to feel like a modern fetch library - easy for beginners, powerful for advanced users.

**[📚 Full Documentation](https://kit.near.tools)**

## Features

- **Simple things should be simple** - One-line commands for common operations
- **Type safety everywhere** - Full TypeScript support with IDE autocomplete
- **Progressive complexity** - Basic API for simple needs, advanced features when required
- **Powerful transaction builder** - Fluent, human-readable API for transactions
- **Wallet-ready** - Full support for [HOT Connector](https://github.com/azbang/hot-connector) and [NEAR Wallet Selector](https://github.com/near/wallet-selector), drop-in integration

## Installation

```bash
npm install near-kit
# or
bun install near-kit
```

## Quick Start

```typescript
import { Near } from "near-kit"

// Initialize for backend/scripts
const near = new Near({
  network: "testnet",
  privateKey: "ed25519:...",
  defaultSignerId: "alice.testnet",
})

// View methods (read-only, no gas)
const balance = await near.view("example.testnet", "get_balance", {
  account_id: "alice.testnet",
})

// Call methods (requires signature, costs gas)
await near.call(
  "example.testnet",
  "increment",
  {},
  { attachedDeposit: "0.1 NEAR" }
)

// Send NEAR tokens
await near.send("bob.testnet", "5 NEAR")
```

## Getting Started

near-kit provides a unified API that works across different environments. Configuration varies by environment, but the API for calling contracts, sending transactions, and building transactions remains identical.

### Backend & Scripts

For local testing, use the sandbox (no network or key configuration needed):

```typescript
import { Sandbox } from "near-kit"

const sandbox = await Sandbox.start()
const near = new Near({ network: sandbox })

// Test with automatically provisioned accounts
await near.call("contract.test.near", "method", {})

await sandbox.stop()
```

For testnet/mainnet development, pass a private key directly:

```typescript
const near = new Near({
  network: "testnet",
  privateKey: "ed25519:...",
  defaultSignerId: "alice.testnet",
})
```

For production applications, use a keyStore:

```typescript
import { FileKeyStore } from "near-kit"

const near = new Near({
  network: "testnet",
  keyStore: new FileKeyStore("~/.near-credentials"),
})
```

### Frontend & Wallets

In the browser, connect to user wallets. The same `near.call()`, `near.send()`, and `near.transaction()` methods work seamlessly:

```typescript
import { fromWalletSelector } from "near-kit"

const near = new Near({
  network: "testnet",
  wallet: fromWalletSelector(walletInstance),
})

// Same API as backend
await near.call("contract.near", "method", { arg: "value" })
```

This works through a signer abstraction - whether you pass `privateKey`, `keyStore`, `wallet`, or `sandbox`, they all implement the same signing interface internally.

## Core API

### Initialization

```typescript
// Simple - defaults to mainnet
const near = new Near()

// With network selection
const near = new Near({ network: "testnet" })

// With custom configuration
const near = new Near({
  network: "testnet",
  privateKey: "ed25519:...",
})
```

### Basic Operations

```typescript
// View methods (free, no signature required)
const result = await near.view("contract.near", "get_data", { key: "value" })

// Check account balance
const balance = await near.getBalance("alice.near")

// Check if account exists
const exists = await near.accountExists("alice.near")

// Get network status
const status = await near.getStatus()
```

### Type-Safe Contracts

```typescript
import type { Contract } from "near-kit"

// Define contract interface using Contract<> helper
type MyContract = Contract<{
  view: {
    get_balance: (args: { account_id: string }) => Promise<string>
    get_info: () => Promise<{ name: string; version: string }>
  }
  call: {
    // Just define args - options parameter automatically added!
    transfer: (args: { to: string; amount: string }) => Promise<void>
  }
}>

// Create type-safe contract
const contract = near.contract<MyContract>("example.near")

// Fully typed method calls
const balance = await contract.view.get_balance({ account_id: "alice.near" })
const info = await contract.view.get_info()

// Call methods automatically get options parameter
await contract.call.transfer(
  { to: "bob.near", amount: "10" },
  { attachedDeposit: "1 NEAR" }
)
```

### Transaction Builder

```typescript
// Alice builds a transaction with multiple actions
// 'alice.near' is the signer - the account that signs and pays for this transaction
const receipt = await near
  .transaction("alice.near") // Alice signs
  .transfer("bob.near", "10 NEAR") // Alice sends Bob 10 NEAR
  .functionCall(
    "market.near",
    "buy",
    { id: "123" },
    { attachedDeposit: "5 NEAR" } // Alice attaches 5 NEAR to the call
  )
  .send()
```

### Batch Operations

```typescript
// Run multiple operations in parallel
const [balance, status, exists] = await near.batch(
  near.getBalance("alice.near"),
  near.getStatus(),
  near.accountExists("bob.near")
)
```

## Local Testing with Sandbox

```typescript
import { Sandbox } from "near-kit"

const sandbox = await Sandbox.start()
const near = new Near({ network: sandbox })
// ... run tests
await sandbox.stop()
```

**With test framework:**

```typescript
let sandbox: Sandbox
beforeAll(async () => {
  sandbox = await Sandbox.start()
})
afterAll(async () => {
  await sandbox.stop()
})
```

## Key Management

```typescript
import { InMemoryKeyStore, FileKeyStore, RotatingKeyStore } from "near-kit"

// In-memory (runtime only)
const near = new Near({
  keyStore: new InMemoryKeyStore({
    "alice.near": "ed25519:...",
  }),
})

// File-based (persistent)
const near = new Near({
  keyStore: new FileKeyStore("~/.near-credentials"),
})

// Rotating keys for high-throughput concurrent transactions
const near = new Near({
  keyStore: new RotatingKeyStore({
    "alice.near": ["ed25519:key1...", "ed25519:key2...", "ed25519:key3..."],
  }),
})
```

## Wallet Integration

near-kit integrates with Wallet Selector and HOT Connector through a signer abstraction. Wallet adapters are converted to signers via `fromWalletSelector()` and `fromHotConnect()` shims, allowing the same API to work across backend and frontend without separate client implementations.

### NEAR Wallet Selector

```typescript
import { Near, fromWalletSelector } from "near-kit"
import { setupWalletSelector } from "@near-wallet-selector/core"
import { setupMyNearWallet } from "@near-wallet-selector/my-near-wallet"
import { setupHereWallet } from "@near-wallet-selector/here-wallet"

// Setup wallet selector
const selector = await setupWalletSelector({
  network: "testnet",
  modules: [setupMyNearWallet(), setupHereWallet()],
})

// Get wallet instance (after user connects)
const wallet = await selector.wallet()

// Use with near-kit
const near = new Near({
  network: "testnet",
  wallet: fromWalletSelector(wallet),
})

// All operations now use the wallet for signing
await near.call("contract.near", "method", { arg: "value" })
await near.send("bob.near", "10 NEAR")
```

### HOT Connector

```typescript
import { Near, fromHotConnect } from "near-kit"
import { NearConnector } from "@hot-labs/near-connect"

// Create connector
const connector = new NearConnector({ network: "testnet" })

// Wait for user to connect
connector.on("wallet:signIn", async () => {
  const near = new Near({
    network: "testnet",
    wallet: fromHotConnect(connector),
  })

  // Use near-kit with the connected wallet
  await near.call("contract.near", "method", { arg: "value" })
})

// Trigger wallet connection
await connector.signIn()
```

## Error Handling

Errors are organized by category and include detailed context for debugging. Use `instanceof` checks to handle specific error types.

#### Network Errors

```typescript
import { NetworkError, TimeoutError } from "near-kit"

try {
  await near.call("contract.near", "method", {})
} catch (error) {
  if (error instanceof TimeoutError) {
    console.log("Request timed out - already retried automatically")
  } else if (error instanceof NetworkError) {
    // Handle other network issues
  }
}
```

#### Transaction Errors

```typescript
import { InsufficientBalanceError, InvalidNonceError } from "near-kit"

try {
  await near.send("bob.near", "1000000 NEAR")
} catch (error) {
  if (error instanceof InsufficientBalanceError) {
    console.log(`Need ${error.required}, have ${error.available}`)
  } else if (error instanceof InvalidNonceError) {
    // Already retried automatically - only thrown if retries exhausted
  }
}
```

#### Contract Errors

```typescript
import { FunctionCallError } from "near-kit"

try {
  await near.call("contract.near", "method", {})
} catch (error) {
  if (error instanceof FunctionCallError) {
    console.log(`Contract panicked: ${error.panic}`)
    console.log(`Logs:`, error.logs)
  }
}
```

## Advanced Features

### Batch Actions (Multi-Action Transactions)

Deploy and initialize a contract in a single transaction:

```typescript
const contractWasm = await fs.readFile("./contract.wasm")

await near
  .transaction("alice.near")
  .createAccount("contract.alice.near")
  .transfer("contract.alice.near", "10 NEAR")
  .deployContract("contract.alice.near", contractWasm)
  .functionCall("contract.alice.near", "init", { owner: "alice.near" })
  .send()
```

### NEP-413 Message Signing

Authenticate users without gas fees:

```typescript
const signedMessage = await near.signMessage({
  message: "Login to MyApp",
  recipient: "myapp.near",
  nonce: crypto.getRandomValues(new Uint8Array(32)),
})

// Send to backend for verification
await fetch("/api/auth", {
  method: "POST",
  body: JSON.stringify(signedMessage),
})
```

### Delegate Actions (NEP-366)

Enable meta-transactions and sponsored transactions where a relayer pays the gas:

```typescript
import { decodeSignedDelegateAction, Near } from "near-kit"

// User creates and signs a delegate action (no gas cost to user)
const userNear = new Near({
  network: "testnet",
  privateKey: "ed25519:...", // User's key
})

const { signedDelegateAction, payload } = await userNear
  .transaction("user.near")
  .transfer("recipient.near", "1 NEAR")
  .delegate({ blockHeightOffset: 100 })

// Relayer submits the transaction (pays the gas)
const relayerNear = new Near({
  network: "testnet",
  privateKey: "ed25519:...", // Relayer's key
})

await relayerNear
  .transaction("relayer.near")
  .signedDelegateAction(decodeSignedDelegateAction(payload))
  .send()
```

### Automatic Nonce Management

No more nonce conflicts - the library handles nonce tracking and retries automatically:

```typescript
// Safe to run multiple transactions concurrently
await Promise.all([
  near.send("bob.near", "1 NEAR"),
  near.send("charlie.near", "1 NEAR"),
  near.send("dave.near", "1 NEAR"),
])
// Nonces are automatically managed and conflicts are retried
```

### Smart Retry Logic

Automatic retries for network errors with exponential backoff:

```typescript
try {
  await near.call("contract.near", "method", {})
} catch (error) {
  if (error instanceof TimeoutError && error.retryable) {
    // Already retried automatically
  }
}
```

## Development

```bash
# Install dependencies
bun install

# Run tests
bun test

# Build
bun run build

# Run examples
bun run examples/quickstart.ts
```

## License

MIT
