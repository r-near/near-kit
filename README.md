# near-kit

A simple, intuitive TypeScript library for interacting with NEAR Protocol. Designed to feel like a modern fetch library - easy for beginners, powerful for advanced users.

## Features

- **Simple things should be simple** - One-line commands for common operations
- **Type safety everywhere** - Full TypeScript support with IDE autocomplete
- **Built-in local testing** - Sandbox runs a real NEAR node locally, no mocks needed
- **Powerful transaction builder** - Fluent API for complex multi-action transactions
- **Human-readable** - Intuitive API design, use "10 NEAR" not "10000000000000000000000000"
- **Progressive complexity** - Basic API for simple needs, advanced features when required
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
  privateKey: 'ed25519:...'  // Your account's private key
});

// View a contract method (read-only, no gas)
const balance = await near.view('example.testnet', 'get_balance', {
  account_id: 'alice.testnet'
});

// Call a contract method (requires signature, costs gas)
await near.call('example.testnet', 'increment', {}, {
  signerId: 'alice.testnet',
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

## Utilities

```typescript
import { generateKey, parseAmount, formatAmount } from 'near-kit';

// Generate a new key pair
const keyPair = generateKey();
console.log(keyPair.publicKey.toString());  // "ed25519:..."
console.log(keyPair.secretKey);  // "ed25519:..."

// Unit conversion (usually automatic in the API)
const yocto = parseAmount('10 NEAR');  // "10000000000000000000000000"
const near = formatAmount(yocto);  // "10.00 NEAR"
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

- **Multi-action transactions** - Deploy a contract and initialize it in a single transaction
- **NEP-413 message signing** - Authenticate users without gas fees using `near.signMessage()`
- **Delegate actions (NEP-366)** - Enable meta-transactions and sponsored transactions
- **Automatic nonce management** - No more nonce conflicts or manual tracking
- **Smart retry logic** - Automatic retries for network errors and timeout handling

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
