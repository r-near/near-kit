---
"near-kit": minor
---

Add DelegateV2 meta-transactions (NEAR 2.13 / protocol v85)

- `Action::DelegateV2` (borsh discriminant 14) with `VersionedDelegateActionPayload` / `DelegateActionV2`, whose nonce is a `TransactionNonce` so it can target a gas key's nonce slot.
- Signed under a DISTINCT NEP-461 domain tag (NEP-611, `2^30 + 611`), so a V1 delegate signature is never valid for a V2 action.
- Builder `.delegateV2({ nonceIndex? })` to sign a V2 delegate action and `.signedDelegateActionV2()` for relayers, plus `encodeSignedDelegateActionV2` / `decodeSignedDelegateActionV2` for transport.
- RPC view schema for the `DelegateV2` action, so a relay transaction's default `.send()` path parses the echoed response.
