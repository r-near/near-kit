---
"near-kit": patch
---

Fix NEP-616 deterministic account IDs for state-init data with more than one entry. `deriveAccountId` and the `DeterministicStateInit` action now encode `data` in canonical borsh `BTreeMap` order (sorted bytewise by key), matching nearcore, so multi-entry maps produce the account ID the node expects regardless of insertion order. Two keys with identical bytes now throw instead of yielding an ID the node rejects. Requires `@zorsh/zorsh` 0.5.1, which fixes the underlying map ordering.
