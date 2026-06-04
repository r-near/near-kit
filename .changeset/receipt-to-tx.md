---
"near-kit": minor
---

Add `receiptToTx()` to the RPC client for the new `EXPERIMENTAL_receipt_to_tx` endpoint (nearcore 2.12), accessible via `near.rpc.receiptToTx()`. The configured low-level RPC client is now exposed through the `near.rpc` getter for advanced calls not wrapped by `Near`.
