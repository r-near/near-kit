---
"near-kit": patch
---

Keep signed transaction hashes and wire bytes stable when transaction inputs change during signing. Isolate caller-owned action and serialized byte buffers, retain the selected key and signed commitment across safe retries, and expose Effect-native transaction plans and value operations.

Native unsigned builds return a version-tagged value honoring gas-key slots and strict nonces, while the Promise builder retains its existing unsigned result shape.

Remove automatic fresh-nonce recovery after submission. Even a matching nonce rejection can be a hidden transport replay of previously accepted bytes. Reconcile the exact signed hash; missing status or mismatched transaction metadata raises nonretryable `TRANSACTION_OUTCOME_UNKNOWN` rather than signing another economic operation. Same-byte RPC retries and cached public-builder replay remain supported. Native callers must retain a signed value for safe replay instead of retrying `send(plan)`.

Sequence automatically allocated local sends per account, key and nonce slot so slower signing or transport cannot let a later nonce overtake an earlier default/executed submission. Independent keys and slots remain parallel; explicit nonces, offline signatures and `NONE` acknowledgment retain their caller-managed ordering limits.

Coordinate strict and monotonic nonce reservations without collisions while preserving strict mode's fresh chain nonce lookup and recovery from signing failures before submission.
