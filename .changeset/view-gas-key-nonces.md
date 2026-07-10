---
"near-kit": minor
---

Add `RpcClient.getGasKeyNonces` to read a gas key's per-lane nonces via the `view_gas_key_nonces` query (NEAR 2.13)

- Returns a typed `GasKeyNoncesResponse` (`{ nonces, block_height, block_hash }`), mirroring `getAccessKey`; `nonces` is the gas key's parallel per-lane `u64` nonces indexed by lane.
- Maps the node's `UNKNOWN_GAS_KEY` error to `AccessKeyDoesNotExistError`, re-keyed with the queried account, so reading a non-gas key throws the same typed error as the access-key path.
