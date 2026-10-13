---
"near-kit": minor
---

Add `TransferToUniversalAccountNotAllowedError`, thrown when nearcore rejects a transfer to a universal account (`0u...` id) with `TransferToUniversalAccountNotAllowed` while such transfers are banned (nearcore 2.14). It is recognized from `send_tx` validation errors, from failed contract-created receipts, and from transactions rejected when their chunk is applied, and exposes the target `accountId`.
