# near-kit

A simple, intuitive TypeScript library for interacting with NEAR Protocol. Designed to feel like a modern fetch library - easy for beginners, powerful for advanced users.

## Features

- **Simple things should be simple** - One-line commands for common operations
- **Type safety everywhere** - Full TypeScript support with IDE autocomplete
- **Progressive complexity** - Basic API for simple needs, advanced features when required
- **Powerful transaction builder** - Fluent, human-readable API for transactions
- **Built-in local testing** - Sandbox runs a real NEAR node locally, no mocks needed
- **Wallet-ready** - Full support for HOT Connector and NEAR Wallet Selector, drop-in integration

## Installation

```bash
npm install near-kit
# or
bun install near-kit
```

## Quick Start

```typescript
import { Near } from 'near-kit';

// Initialize with a private key for signing transactions
const near = new Near({
  network: 'testnet',
  privateKey: 'ed25519:...',  // Your account's private key
  defaultSignerId: 'alice.testnet'  // Default account for signing
});

// View a contract method (read-only, no gas)
const balance = await near.view('example.testnet', 'get_balance', {
  account_id: 'alice.testnet'
});

// Call a contract method (requires signature, costs gas)
await near.call('example.testnet', 'increment', {}, {
  attachedDeposit: '0.1'  // Attach 0.1 NEAR
});

// Send NEAR tokens
await near.send('bob.testnet', '5');  // Send 5 NEAR to Bob

// Check account balance
const accountBalance = await near.getBalance('alice.testnet');
console.log(accountBalance); // "100.00 NEAR"
```

## Core API

### Initialization

```typescript
// Simple - defaults to mainnet
const near = new Near();

// With network selection
const near = new Near({ network: 'testnet' });

// With custom configuration
const near = new Near({
  network: 'testnet',
  privateKey: 'ed25519:...',
});
```

### Basic Operations

```typescript
// View methods (free, no signature required)
const result = await near.view(
  'contract.near',
  'get_data',
  { key: 'value' }
);

// Check account balance
const balance = await near.getBalance('alice.near');

// Check if account exists
const exists = await near.accountExists('alice.near');

// Get network status
const status = await near.getStatus();
```

### Type-Safe Contracts

```typescript
import type { Contract } from 'near-kit';

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
const contract = near.contract<MyContract>('example.near');

// Fully typed method calls
const balance = await contract.view.get_balance({ account_id: 'alice.near' });
const info = await contract.view.get_info();

// Call methods automatically get options parameter
await contract.call.transfer(
  { to: 'bob.near', amount: '10' },
  { attachedDeposit: '1 NEAR' }
);
```

### Transaction Builder

```typescript
// Alice builds a transaction with multiple actions
// 'alice.near' is the signer - the account that signs and pays for this transaction
const receipt = await near.transaction('alice.near')  // Alice signs
  .transfer('bob.near', '10')                         // Alice sends Bob 10 NEAR
  .functionCall('market.near', 'buy', { id: '123' }, {
    attachedDeposit: '5'                              // Alice attaches 5 NEAR to the call
  })
  .send();
```

### Batch Operations

```typescript
// Run multiple operations in parallel
const [balance, status, exists] = await near.batch(
  near.getBalance('alice.near'),
  near.getStatus(),
  near.accountExists('bob.near')
);
```

## Local Testing with Sandbox

```typescript
import { Sandbox } from 'near-kit';

const sandbox = await Sandbox.start();
const near = new Near({ network: sandbox });
// ... run tests
await sandbox.stop();
```

**With test framework:**
```typescript
let sandbox: Sandbox;
beforeAll(async () => { sandbox = await Sandbox.start(); });
afterAll(async () => { await sandbox.stop(); });
```

## Key Management

```typescript
import { InMemoryKeyStore, FileKeyStore } from 'near-kit';

// In-memory (runtime only)
const near = new Near({
  keyStore: new InMemoryKeyStore({
    'alice.near': 'ed25519:...',
  })
});

// File-based (persistent)
const near = new Near({
  keyStore: new FileKeyStore('~/.near-credentials')
});
```

## Wallet Integration

near-kit works seamlessly with popular NEAR wallets - just pass the wallet adapter and all methods will use the wallet for signing.

### NEAR Wallet Selector

```typescript
import { Near, fromWalletSelector } from 'near-kit';
import { setupWalletSelector } from '@near-wallet-selector/core';
import { setupMyNearWallet } from '@near-wallet-selector/my-near-wallet';
import { setupHereWallet } from '@near-wallet-selector/here-wallet';

// Setup wallet selector
const selector = await setupWalletSelector({
  network: 'testnet',
  modules: [
    setupMyNearWallet(),
    setupHereWallet(),
  ],
});

// Get wallet instance (after user connects)
const wallet = await selector.wallet();

// Use with near-kit
const near = new Near({
  network: 'testnet',
  wallet: fromWalletSelector(wallet),
});

// All operations now use the wallet for signing
await near.call('contract.near', 'method', { arg: 'value' });
await near.send('bob.near', '10');
```

### HOT Connector

```typescript
import { Near, fromHotConnect } from 'near-kit';
import { NearConnector } from '@hot-labs/near-connect';

// Create connector
const connector = new NearConnector({ network: 'testnet' });

// Wait for user to connect
connector.on('wallet:signIn', async () => {
  const near = new Near({
    network: 'testnet',
    wallet: fromHotConnect(connector),
  });

  // Use near-kit with the connected wallet
  await near.call('contract.near', 'method', { arg: 'value' });
});

// Trigger wallet connection
await connector.signIn();
```

## Error Handling

```typescript
import {
  InsufficientBalanceError,
  FunctionCallError,
  NetworkError,
} from 'near-kit';

try {
  await near.call('contract.near', 'method', {});
} catch (error) {
  if (error instanceof InsufficientBalanceError) {
    console.log(`Need ${error.required}, have ${error.available}`);
  } else if (error instanceof FunctionCallError) {
    console.log(`Contract error: ${error.panic}`);
  } else if (error instanceof NetworkError) {
    // Retry logic
  }
}
```

## Advanced Features

### Batch Actions (Multi-Action Transactions)

Deploy and initialize a contract in a single transaction:

```typescript
const contractWasm = await fs.readFile('./contract.wasm');

await near.transaction('alice.near')
  .createAccount('contract.alice.near')
  .transfer('contract.alice.near', '10 NEAR')
  .deployContract('contract.alice.near', contractWasm)
  .functionCall('contract.alice.near', 'init', { owner: 'alice.near' })
  .send();
```

### NEP-413 Message Signing

Authenticate users without gas fees:

```typescript
const signedMessage = await near.signMessage({
  message: 'Login to MyApp',
  recipient: 'myapp.near',
  nonce: crypto.getRandomValues(new Uint8Array(32))
});

// Send to backend for verification
await fetch('/api/auth', {
  method: 'POST',
  body: JSON.stringify(signedMessage)
});
```

### Delegate Actions (NEP-366)

Enable meta-transactions and sponsored transactions where a relayer pays the gas:

```typescript
// User creates and signs a delegate action (no gas cost to user)
const userNear = new Near({
  network: 'testnet',
  privateKey: 'ed25519:...'  // User's key
});

const signedDelegateAction = await userNear
  .transaction('user.near')
  .transfer('recipient.near', '1 NEAR')
  .delegate({ blockHeightOffset: 100 });

// Relayer submits the transaction (pays the gas)
const relayerNear = new Near({
  network: 'testnet',
  privateKey: 'ed25519:...'  // Relayer's key
});

await relayerNear
  .transaction('relayer.near')
  .signedDelegateAction(signedDelegateAction)
  .send();
```

### Automatic Nonce Management

No more nonce conflicts - the library handles nonce tracking and retries automatically:

```typescript
// Safe to run multiple transactions concurrently
await Promise.all([
  near.send('bob.near', '1'),
  near.send('charlie.near', '1'),
  near.send('dave.near', '1')
]);
// Nonces are automatically managed and conflicts are retried
```

### Smart Retry Logic

Automatic retries for network errors with exponential backoff:

```typescript
try {
  await near.call('contract.near', 'method', {});
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
bun run examples/basic-usage.ts
```

## License

MIT
