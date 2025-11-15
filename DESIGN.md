A few more things to consider:

## Error handling
```typescript
// Typed errors
try {
  await near.call('contract.near', 'method', {});
} catch (error) {
  if (error instanceof InsufficientBalanceError) {
    console.log(`Need ${error.required}, have ${error.available}`);
  } else if (error instanceof FunctionCallError) {
    console.log(`Contract error: ${error.panic}`);
  } else if (error instanceof NetworkError) {
    // retry logic
  }
}
```

## RPC configuration
```typescript
const near = new Near({
  rpcUrl: 'https://my-custom-rpc.com',
  archivalRpcUrl: 'https://archival.com',  // for historical queries
  headers: { 'X-API-Key': 'key' }  // custom headers
});
```

## Testing utilities
```typescript
// Mock for testing
const near = Near.mock({
  accounts: {
    'alice.near': { balance: '100' }
  },
  contracts: {
    'market.near': mockMarketContract
  }
});
```

Ready for the design doc? Let me create a comprehensive one you can hand off:

---

# NEAR TypeScript Client Library Design Document

## Overview

A simple, intuitive TypeScript library for interacting with NEAR Protocol. Designed to feel like a modern fetch library - easy for beginners, powerful for advanced users.

### Core Principles
- **Simple things should be simple** - One-line commands for common operations
- **Type safety everywhere** - Full TypeScript support with IDE autocomplete
- **Human-readable** - No yoctoNEAR confusion, use "10 NEAR" not "10000000000000000000000000"
- **Progressive complexity** - Basic API for simple needs, advanced features when required
- **Fetch-like** - Familiar patterns for JavaScript developers

## Core API Design

### 1. Initialization

```typescript
// Simple - defaults to mainnet, reads from env vars
const near = new Near();

// With options
const near = new Near({
  network: 'testnet' | 'mainnet' | 'localnet' | { rpcUrl: string },
  privateKey?: string | KeyConfig,
  keyStore?: KeyStore | string | Record<string, string>,
  signer?: (message: Uint8Array) => Promise<Signature>,
  wallet?: boolean | 'near-wallet' | 'sender' | 'meteor',
  rpcUrl?: string,
  archivalRpcUrl?: string,
  headers?: Record<string, string>,
  readOnly?: boolean
});
```

### 2. Basic Operations

```typescript
// View methods (free, no signature required)
const result = await near.view<ReturnType>(
  contractId: string,
  methodName: string,
  args?: object
);

// Change methods (requires gas and signature)
const result = await near.call<ReturnType>(
  contractId: string,
  methodName: string,
  args?: object,
  options?: {
    gas?: string | number,  // '30 Tgas' or 30000000000000
    attachedDeposit?: string | number,  // '10' = 10 NEAR
    signerId?: string
  }
);

// Simple token transfer
await near.send(
  receiverId: string,
  amount: string | number  // in NEAR, not yocto
);

// Account queries
const balance = await near.getBalance(accountId: string): Promise<string>;
const exists = await near.accountExists(accountId: string): Promise<boolean>;
```

### 3. Transaction Builder

```typescript
class TransactionBuilder {
  // Actions
  transfer(receiverId: string, amount: string): this;
  
  createAccount(accountId: string): this;
  
  deleteAccount(beneficiaryId: string): this;
  
  deployContract(accountId: string, code: Uint8Array): this;
  
  functionCall(
    contractId: string,
    methodName: string,
    args: object,
    options?: { gas?: string, attachedDeposit?: string }
  ): this;
  
  addKey(
    accountId: string,
    publicKey: string,
    permission: FullAccessPermission | FunctionCallPermission
  ): this;
  
  deleteKey(accountId: string, publicKey: string): this;
  
  stake(publicKey: string, amount: string): this;
  
  // Execution
  build(): Promise<UnsignedTransaction>;  // Returns unsigned
  send(): Promise<FinalExecutionOutcome>;  // Signs and sends
  signWith(key: string | Signer): this;  // Override signer
}

// Usage
const receipt = await near.transaction('alice.near')
  .transfer('bob.near', '10')
  .functionCall('market.near', 'buy', { id: '123' }, { attachedDeposit: '5' })
  .send();
```

### 4. Contract Type Safety

```typescript
// Define contract interface
interface MyContract {
  view: {
    get_balance(args: { account_id: string }): Promise<string>;
    get_info(): Promise<ContractInfo>;
  };
  call: {
    transfer(args: { to: string, amount: string }): Promise<void>;
    set_data(args: { key: string, value: any }): Promise<boolean>;
  };
}

// Type-safe usage
const contract = near.contract<MyContract>('contract.near');
const balance = await contract.view.get_balance({ account_id: 'alice.near' });
await contract.call.transfer(
  { to: 'bob.near', amount: '100' },
  { attachedDeposit: '0.01' }
);

// Auto-generate from ABI
const contract = await near.contractWithAbi('contract.near');
```

### 5. Key Management

```typescript
interface KeyStore {
  add(accountId: string, key: KeyPair): Promise<void>;
  get(accountId: string): Promise<KeyPair | null>;
  remove(accountId: string): Promise<void>;
  list(): Promise<string[]>;
}

// File-based keystore (Node.js)
const near = new Near({
  keyStore: new FileKeyStore('~/.near-credentials')
});

// In-memory keystore
const near = new Near({
  keyStore: new InMemoryKeyStore({
    'alice.near': 'ed25519:...',
    'bob.near': 'ed25519:...'
  })
});

// Encrypted keystore
const near = new Near({
  keyStore: new EncryptedKeyStore({
    password: 'secret',
    storage: localStorage  // or file system
  })
});
```

### 6. Wallet Integration (Browser)

```typescript
// Initialize with wallet
const near = new Near({ wallet: true });

// Sign in flow
if (!near.isSignedIn()) {
  await near.signIn({
    contractId?: string,  // Optional: request access to specific contract
    methodNames?: string[],  // Optional: limit to specific methods
    successUrl?: string,
    failureUrl?: string
  });
}

// Get current user
const accountId = near.getAccountId();

// Sign out
await near.signOut();
```

### 7. Batch Operations

```typescript
// Type-safe batch with proper return types
const [balance, nfts, status] = await near.batch(
  near.view('token.near', 'ft_balance_of', { account_id: 'alice.near' }),
  near.view('nft.near', 'nft_tokens', {}),
  near.getStatus()
);
```

### 8. Error Types

```typescript
class NearError extends Error {
  code: string;
  data?: any;
}

class InsufficientBalanceError extends NearError {
  required: string;
  available: string;
}

class FunctionCallError extends NearError {
  panic?: string;
  methodName: string;
  contractId: string;
}

class NetworkError extends NearError {
  statusCode?: number;
  retryable: boolean;
}

class InvalidKeyError extends NearError {}
class AccountDoesNotExistError extends NearError {}
class AccessKeyDoesNotExistError extends NearError {}
```

### 9. Utilities

```typescript
near.utils = {
  // Unit conversion
  parse(amount: string): string;  // '10 NEAR' -> '10000000000000000000000000'
  format(yocto: string): string;  // '10000000000000000000000000' -> '10 NEAR'
  
  // Key generation
  generateKey(): KeyPair;
  generateSeedPhrase(): string;
  parseSeedPhrase(phrase: string, path?: string): KeyPair;
  
  // Validation
  isValidAccountId(id: string): boolean;
  isValidPublicKey(key: string): boolean;
  
  // Gas utilities
  toGas(tgas: number): string;
  toTGas(gas: string): number;
};
```

## Type Definitions

```typescript
type NetworkConfig = 'mainnet' | 'testnet' | 'localnet' | {
  rpcUrl: string;
  networkId: string;
  nodeUrl?: string;
  walletUrl?: string;
  helperUrl?: string;
};

type KeyConfig = 
  | string  // 'ed25519:...' or seed phrase
  | { type: 'ed25519', key: string }
  | { type: 'secp256k1', key: string }
  | { type: 'seed', phrase: string, path?: string }
  | { type: 'ledger', path?: string }
  | { type: 'private-key', key: Uint8Array };

type FullAccessPermission = {
  permission: 'FullAccess';
};

type FunctionCallPermission = {
  permission: 'FunctionCall';
  receiverId: string;
  methodNames?: string[];
  allowance?: string;
};

interface FinalExecutionOutcome {
  status: ExecutionStatus;
  transaction: Transaction;
  transaction_outcome: ExecutionOutcomeWithId;
  receipts_outcome: ExecutionOutcomeWithId[];
}
```

## Implementation Notes

### Unit Handling
- All amount inputs accept NEAR as strings or numbers (e.g., "10", 10, "10 NEAR")
- Internally convert to yoctoNEAR for RPC calls
- Return values in human-readable format by default

### Gas Handling
- Accept human-readable gas ("30 Tgas") or raw numbers
- Default to 30 TGas for function calls
- Allow manual override

### Network Defaults
- Default to mainnet if not specified
- Read from `NEAR_NETWORK` env var
- Support custom RPC endpoints

### Type Generation
- Support manual interface definitions
- Optional ABI-based type generation
- Runtime validation for development mode

### Browser vs Node.js
- Detect environment automatically
- Use appropriate key storage (localStorage vs file system)
- Handle wallet integration in browser only

## Usage Examples

### Simple Transfer
```typescript
const near = new Near();
await near.send('alice.near', '10');
```

### Contract Interaction
```typescript
const near = new Near({ network: 'testnet' });

// Read
const balance = await near.view('token.near', 'ft_balance_of', {
  account_id: 'user.near'
});

// Write
await near.call('market.near', 'buy_nft', 
  { nft_id: '123' },
  { attachedDeposit: '5' }
);
```

### Complex Transaction
```typescript
const near = new Near({ privateKey: process.env.PRIVATE_KEY });

const outcome = await near.transaction('alice.near')
  .createAccount('app.alice.near')
  .transfer('app.alice.near', '10')
  .deployContract('app.alice.near', contractWasm)
  .functionCall('app.alice.near', 'init', { owner: 'alice.near' })
  .send();
```

### Type-Safe Contract
```typescript
interface DeFiContract {
  view: {
    get_pool_info(args: { pool_id: number }): Promise<PoolInfo>;
    get_user_shares(args: { account_id: string }): Promise<string>;
  };
  call: {
    swap(args: { 
      token_in: string; 
      token_out: string; 
      amount: string 
    }): Promise<SwapReceipt>;
  };
}

const defi = near.contract<DeFiContract>('defi.near');
const pool = await defi.view.get_pool_info({ pool_id: 1 });
```

## Testing

Provide mock implementations for testing:

```typescript
import { Near } from 'near';

const near = Near.mock({
  accounts: {
    'alice.near': { balance: '100' },
    'bob.near': { balance: '50' }
  },
  contracts: {
    'token.near': {
      ft_balance_of: ({ account_id }) => '1000',
      ft_transfer: () => Promise.resolve()
    }
  }
});

// Tests run without network calls
const balance = await near.view('token.near', 'ft_balance_of', {
  account_id: 'alice.near'
});
assert(balance === '1000');
```

## Package Structure

```
near-kit
├── core/           # Core client implementation
├── contracts/      # Contract interface helpers
├── wallets/        # Wallet integrations
├── keys/           # Key management
├── utils/          # Utility functions
├── errors/         # Error types
└── testing/        # Mock implementations
```

---

This design focuses on developer experience while maintaining full NEAR Protocol capabilities. The implementation should prioritize the simple use cases while ensuring advanced features are available when needed.
