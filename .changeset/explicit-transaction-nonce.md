---
"near-kit": minor
---

Add `TransactionBuilder.nonce(n)` to sign a transaction at an explicit, caller-chosen nonce. The value is used as-is for ordinary keys and gas-key slots (`.useGasKey(i).nonce(n)`), bypasses the shared nonce cache, and `send()` surfaces `InvalidNonceError` instead of retrying a caller-owned nonce. This lets applications that coordinate nonces outside the process (shared allocators across servers, relayers recording the nonce before an asynchronous/MPC signature) sign without reaching into the builder's private nonce manager.
