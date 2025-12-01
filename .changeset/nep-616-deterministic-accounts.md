---
"near-kit": minor
---

Add support for NEP-616 (Deterministic AccountIds)

- Update Sandbox default version to 2.10-release
- Add StateInit action for deploying contracts with deterministically derived account IDs
- Add `stateInit()` method to TransactionBuilder
- Add `deriveAccountId()` utility to compute deterministic account IDs from StateInit
- Add `isDeterministicAccountId()` and `verifyDeterministicAccountId()` helper functions
- Export new types: `StateInit`, `StateInitOptions`, `ContractCode`
