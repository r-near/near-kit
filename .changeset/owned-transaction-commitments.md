---
"near-kit": patch
---

Keep signed transaction hashes and wire bytes stable when transaction inputs change during signing. Isolate caller-owned action and serialized byte buffers, retain the selected key and signed commitment across safe retries, and expose Effect-native transaction plans and value operations.

Native unsigned builds return a version-tagged value honoring gas-key slots and strict nonces, while the Promise builder retains its existing unsigned result shape.

Retain submission history with each signed commitment and require proven rejection of every broadcast before automatically signing a fresh nonce. Ambiguous submissions reconcile their exact hash; unresolved status raises nonretryable `TRANSACTION_OUTCOME_UNKNOWN` with the original cause instead of risking a duplicate transfer.
