---
"near-kit": minor
---

Add gas-key actions and permissions (NEAR 2.13 / protocol v85)

- `TransferToGasKey` (borsh discriminant 12) and `WithdrawFromGasKey` (13) actions, with `.transferToGasKey()` / `.withdrawFromGasKey()` builder methods.
- `GasKeyFullAccess` and `GasKeyFunctionCall` access-key permissions (discriminants 3 and 2) plus `GasKeyInfo`, usable via `.addKey(pk, { type: "gasKeyFullAccess", numNonces })` and `{ type: "gasKeyFunctionCall", numNonces, receiverId, methodNames }`.
- RPC view schemas for the gas-key actions and permissions, so the default `.send()` path parses a successful 2.13 response (and `getAccessKey` accepts gas keys) without errors.
