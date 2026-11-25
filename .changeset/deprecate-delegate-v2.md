---
"near-kit": patch
---

Deprecate the DelegateV2 builders: `delegateV2()`, `signedDelegateActionV2()`, `signedDelegateV2()`, `DelegateActionV2`, `serializeDelegateActionV2()` and the V2 payload codecs. nearcore rejects `Action::DelegateV2` from protocol version 87 (NEAR 2.14), and near-kit now throws that rejection as `RemovedProtocolFeatureError` instead of a generic `InvalidTransactionError`. DelegateV2 actions in existing transactions still decode.
