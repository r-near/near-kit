---
"near-kit": minor
---

Parse gas-key variants in RPC view responses (nearcore 2.13)

The RPC response schemas now accept the gas-key shapes, so reading a gas key or a transaction that touched one no longer throws:

- `AccessKeyPermission` view accepts `GasKeyFunctionCall` and `GasKeyFullAccess` (each with `balance` + `num_nonces`), so `getAccessKey`/`getAccessKeys` work on gas keys.
- The RPC action view accepts `TransferToGasKey` and `WithdrawFromGasKey`, so status-bearing transaction reads that echo those actions parse.
