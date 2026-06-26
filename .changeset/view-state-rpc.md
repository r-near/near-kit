---
"near-kit": minor
---

Add `view_state` with pagination and wrappers for RPC methods stabilized in nearcore 2.13

- `near.viewState(accountId, { prefix, afterKey, limit, includeProof, ... })` reads a page of contract state; `near.viewStateAll(accountId, { prefix, limit })` is an async iterator that follows the `last_key` cursor across pages. Both are also on the low-level `near.rpc` client.
- `near.rpc.blockEffects()`, `near.rpc.genesisConfig()`, and `near.rpc.maintenanceWindows(accountId)` wrap the stabilized methods, falling back to the `EXPERIMENTAL_*` aliases on pre-2.13 nodes.
