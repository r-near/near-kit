---
"near-kit": patch
---

Export `InvalidNonceError`, `InvalidTransactionError`, and `TimeoutError` from the package entry point. The README and docs already import them from `near-kit`, but they weren't exported, so `instanceof` checks against them couldn't be written.
