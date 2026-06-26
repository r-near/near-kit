---
"near-kit": minor
---

Add gas-key transacting and strict nonce mode (NEAR 2.13 / protocol v85)

- Versioned transaction (V1) borsh encoding: `TransactionNonce` (`Nonce` / `GasKeyNonce`), `NonceMode` (`Monotonic` / `Strict`), and the custom `[0x01]`-tag scheme. V0 transactions stay tag-less and remain the default, so existing transactions are unchanged.
- `.useGasKey(nonceIndex)` on the transaction builder signs with a gas key, carrying a `GasKeyNonce` and fetching the per-slot nonce via `EXPERIMENTAL_view_gas_key_nonces`.
- `.strictNonceMode()` opts into strict (`ak_nonce + 1`) nonce validation.
