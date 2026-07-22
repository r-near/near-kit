---
"near-kit": minor
---

Add global contract code queries: `near.getGlobalContract()` and `near.globalContractExists()` accept the same `{ codeHash } | { accountId }` reference as `deployFromPublished` and return the published WASM with its current SHA-256 hash. Also adds `near.getContractCode()` (the previously missing `view_code` wrapper for regular accounts), low-level `rpc.viewCode()` / `rpc.viewGlobalContractCode()`, and a typed `GlobalContractNotFoundError` (with compatibility for the pre-2.12 error identifier shape).
