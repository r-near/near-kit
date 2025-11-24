---
"near-kit": patch
---

Add BigInt serialization support across all JSON.stringify operations. Enables passing BigInt values in function call arguments without manual conversion. Affects TransactionBuilder, Near.call(), RPC view calls, and wallet adapters.
