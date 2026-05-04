---
"near-kit": minor
---

Fix NearConnectWallet / NearConnectConnector types to match @hot-labs/near-connect reality

- `manifest` is now required (was optional) — all wallets always provide it
- `signDelegateActions` is now required on NearConnectWallet (was optional) — all wallets since v0.10.0 implement it
- `getAccounts` return type `publicKey` is now optional (`string | undefined`) — hardware wallets and some wallet types don't always return it
- Fixed `signDelegateAction` → `signDelegateActions` typo in manifest features — the feature gate check was dead code because the property name didn't match @hot-labs/near-connect's `WalletFeatures.signDelegateActions`
- `NearConnectSignDelegateActionsResponse` now returns `string[]` (base64-encoded) matching near-connect's actual `SignDelegateActionsResponse` type — the adapter decodes these using `decodeSignedDelegateAction`
- Adapter runtime guard now only checks `manifest.features.signDelegateActions` flag

These changes eliminate the need for `as any` casts when passing `@hot-labs/near-connect` connectors to `fromNearConnect()`.

Bumped `@hot-labs/near-connect` peer dependency from `>=0.9.0` to `>=0.11.0` — types now align with v0.11.0+ which changed `WalletFeatures.signDelegateAction` → `signDelegateActions` and `SignDelegateActionsResponse` from structured objects to `string[]`.
