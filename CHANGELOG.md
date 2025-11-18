# near-kit

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
