---
"near-kit": minor
---

Add RotatingKeyStore for high-throughput concurrent transactions

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
