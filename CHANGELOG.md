# near-kit

## 0.6.3

### Patch Changes

- ed5f588: Fix HOT Connect adapter not parsing Uint8Array function call arguments.

## 0.6.2

### Patch Changes

- 7cec6d4: Fix NEP-413 signature encoding to use base64 per spec instead of base58 with prefix. Maintains backward compatibility with legacy base58 signatures.

## 0.6.1

### Patch Changes

- 16f28aa: Add default export condition for Jest compatibility

## 0.6.0

### Minor Changes

- 50ebc75: Add full access key validation to verifyNep413Signature and fullAccessKeyExists method to Near class

  The `verifyNep413Signature` function now supports an optional `near` parameter that enables verification that the public key in the signed message actually belongs to the claimed account ID on the NEAR blockchain AND is a full access key (not a function call key).

  **Breaking change**: `verifyNep413Signature` is now an async function that returns `Promise<boolean>` instead of `boolean`.

  **New method**: `Near.fullAccessKeyExists(accountId, publicKey)` - Check if a full access key exists for an account.

  Usage:

  ```typescript
  // Without blockchain validation (cryptographic verification only)
  const isValid = await verifyNep413Signature(signedMessage, params);

  // With blockchain validation (verifies key belongs to account AND is full access)
  const near = new Near({ network: "mainnet" });
  const isValid = await verifyNep413Signature(signedMessage, params, { near });

  // Check if full access key exists directly
  const hasFullAccessKey = await near.fullAccessKeyExists(
    "alice.near",
    "ed25519:..."
  );
  ```

## 0.5.5

### Patch Changes

- b04a9e6: Switch NEP-413 signatures to key-type-prefixed base58 encoding for both Ed25519 and Secp256k1, while retaining legacy verification support.

## 0.5.4

### Patch Changes

- 8cbd6cf: refactor(transaction): change deleteAccount to use object parameter with beneficiary field
- ce1c6e9: fix: update view() return type to Promise<T | undefined>

## 0.5.3

### Patch Changes

- 5935404: Remove FileKeyStore from keys barrel export to fix browser bundler compatibility

  FileKeyStore imports node:fs/promises which causes bundler failures in browser environments.
  Users can still import FileKeyStore via the dedicated subpath: `import { FileKeyStore } from "near-kit/keys/file"`

## 0.5.2

### Patch Changes

- 86e1157: Fix port collision when running sandboxes in parallel

  When multiple sandboxes start simultaneously, assigning network port as `rpcPort + 1` caused conflicts. Sandbox A's network port would collide with Sandbox B's RPC port, preventing the second sandbox from binding successfully on macOS.

## 0.5.1

### Patch Changes

- ee7d34d: Add betanet support to NetworkPresetSchema for type consistency with Network type from credential-schemas

## 0.5.0

### Minor Changes

- 47c581c: Add support for NEP-616 (Deterministic AccountIds)

  - Update Sandbox default version to 2.10-release
  - Add StateInit action for deploying contracts with deterministically derived account IDs
  - Add `stateInit()` method to TransactionBuilder
  - Add `deriveAccountId()` utility to compute deterministic account IDs from StateInit
  - Add `isDeterministicAccountId()` and `verifyDeterministicAccountId()` helper functions
  - Export new types: `StateInit`, `StateInitOptions`, `ContractCode`

### Patch Changes

- 47c581c: Fix NEP-616 deterministic account ID derivation to ensure cross-client consistency by sorting Map entries before serialization, matching NEP-616's BTreeMap specification

## 0.4.5

### Patch Changes

- b77f9c7: build(deps): bump the production-dependencies group with 2 updates

## 0.4.4

### Patch Changes

- 41a2204: Improve NEP-413 message signing with timestamp-based nonce generation and automatic expiration

  - Add `generateNonce()` helper that embeds timestamp in nonce (first 8 bytes)
  - Add `maxAge` parameter to `verifyNep413Signature()` for automatic expiration checking (default: 5 minutes)
  - Add `callbackUrl` and `state` fields to `SignMessageParams` and `SignedMessage` per NEP-413 spec
  - Add comprehensive TSDoc to NEP-413 functions explaining security considerations
  - Reduce nonce storage burden: only need to track nonces within the `maxAge` window instead of forever

## 0.4.3

### Patch Changes

- 247c8a4: Remove unused walletUrl, helperUrl, and nodeUrl fields from network configuration

## 0.4.2

### Patch Changes

- 8dddd16: Redesign `publishContract` API with clearer `identifiedBy` parameter

  The `publishContract` method now uses an options object with `identifiedBy: "hash" | "account"` instead of the misleading `accountId` parameter. The default mode is now `"account"` (updatable contracts).

  **Migration guide:**

  ```typescript
  // Before
  publishContract(wasm); // immutable (hash)
  publishContract(wasm, "factory.near"); // updatable (account)

  // After
  publishContract(wasm); // updatable (account) - DEFAULT CHANGED
  publishContract(wasm, { identifiedBy: "hash" }); // immutable (hash)
  ```

  This change makes it clear that:

  - `"account"` mode: Contract is updatable by the signer, identified by their account
  - `"hash"` mode: Contract is immutable, identified by its code hash

## 0.4.1

### Patch Changes

- b53c567: Fix privateKey not being added to keyStore when defaultSignerId is provided without a sandbox config. This resolves "No key found for account" errors when calling delegate() or other keyStore-dependent operations.

  Also fixes race condition with async keystores by properly tracking pendingKeyStoreInit promise to ensure key is written before use.

## 0.4.0

### Minor Changes

- bd82ee9: Simplify the meta-transaction delegate flow by returning `{ signedDelegateAction, payload, format }` from `.delegate()`, introducing first-class payload encode/decode helpers, and updating docs/examples to match the new transport pattern.

## 0.3.0

### Minor Changes

- 6bbf3d6: Add a `near-kit/keys` barrel export for Node-only keystore imports (`FileKeyStore`, `InMemoryKeyStore`, `RotatingKeyStore`), keeping the root `near-kit` entry browser-safe.

## 0.2.1

### Patch Changes

- 039cf73: Fix amount and gas schemas to use fully typesafe template literal types across `Near.call`, `CallOptions`, and helpers, ensuring `attachedDeposit` and gas options always use the `Amount` and `Gas` aliases.

## 0.2.0

### Minor Changes

- 41be5c4: Add RotatingKeyStore for high-throughput concurrent transactions

  Implement RotatingKeyStore that rotates through multiple access keys in round-robin fashion, eliminating nonce collisions for concurrent transactions from a single account.

  **Key Features:**

  - Round-robin key rotation for each transaction
  - Independent nonce tracking per key via NonceManager
  - 100% success rate for concurrent transactions
  - Drop-in replacement for any KeyStore implementation
  - Additional utility methods: `getAll()`, `getCurrentIndex()`, `resetCounter()`

  **Performance Improvements:**

  - 10 concurrent txs: 100% success (vs ~100% with retries for single key)
  - 20 concurrent txs: 100% success (vs ~50-75% for single key)
  - 100 concurrent txs: 100% success (vs ~20-30% for single key)

  **Bug Fix:**

  - Fixed TransactionBuilder.resolveKeyPair() to cache resolved key, preventing double rotation when build() and sign() both call resolveKeyPair()

## 0.1.0

### Minor Changes

- 05a819d: Initial public release of near-kit - a simple, intuitive TypeScript library for interacting with NEAR Protocol.

  Features:

  - Simple API for common NEAR operations (view, call, send)
  - Transaction builder with fluent API for complex multi-action transactions
  - Type-safe contract interfaces with full TypeScript inference
  - Multiple key management strategies (file-based, in-memory, encrypted, native keyring)
  - Human-readable amount formatting (e.g., "10 NEAR" instead of yoctoNEAR)
  - NEAR Sandbox support for local testing
  - Wallet integration support
