---
"near-kit": minor
---

Stop dropping receipt data from `getTransactionStatus` (`EXPERIMENTAL_tx_status`) at early wait levels. The `NONE`, `INCLUDED`, and `INCLUDED_FINAL` branches of the response schema now declare optional `status`, `transaction_outcome`, and `receipts_outcome`, so partial per-receipt data survives parsing. The RPC server returns these even at `wait_until=NONE` (wait_until only controls how long the node blocks, not what it returns); previously Zod stripped them. The `send_tx` path is unaffected — those fields remain optional, so its minimal early-level responses still validate.

`getTransactionStatus` now also gates its failure check on the presence of a `Failure` status rather than the wait-level label, so a terminal failure surfaced at an early level still throws `InvalidTransactionError` as documented.
