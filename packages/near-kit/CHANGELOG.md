# near-kit

## 0.16.0

### Minor Changes

- e795c10: Add `nonceValidation` option to `verifyNep413Signature` for custom nonce schemes

  NEP-413 defines the nonce as an opaque 32-byte value; embedding a timestamp in the first 8 bytes is a near-kit convention used by `generateNonce()`. Previously, verification always interpreted the first 8 bytes as a timestamp and enforced `maxAge`, which rejected valid signatures from apps using their own nonce schemes (e.g. intents.near).

  - `nonceValidation: "timestamp"` (default) - existing behavior, unchanged
  - `nonceValidation: "none"` - treat the nonce as opaque bytes per the spec; no timestamp/expiry check (`maxAge` is ignored), caller is responsible for nonce validation and replay protection

## 0.15.0

### Minor Changes

- 36aab93: Add DelegateV2 meta-transactions (NEAR 2.13 / protocol v85)

  - `Action::DelegateV2` (borsh discriminant 14) with `VersionedDelegateActionPayload` / `DelegateActionV2`, whose nonce is a `TransactionNonce` so it can target a gas key's nonce slot.
  - Signed under a DISTINCT NEP-461 domain tag (NEP-611, `2^30 + 611`), so a V1 delegate signature is never valid for a V2 action.
  - Builder `.delegateV2({ nonceIndex? })` to sign a V2 delegate action and `.signedDelegateActionV2()` for relayers, plus `encodeSignedDelegateActionV2` / `decodeSignedDelegateActionV2` for transport.
  - RPC view schema for the `DelegateV2` action, so a relay transaction's default `.send()` path parses the echoed response.

- 259a1ad: Type ExecutionMetadata V4 per-action `contracts` (nearcore 2.13)

  `ExecutionMetadataSchema` is now a union discriminated on `version`. V4 metadata exposes a typed `contracts` array — one entry per action recording the contract attached to the receiver account before that action ran (`{ local } | { global_hash } | { global_account_id } | null`). V1-V3 parsing is unchanged, and unknown future versions still parse via a fallback.

- 581b961: Add gas-key actions and permissions (NEAR 2.13 / protocol v85)

  - `TransferToGasKey` (borsh discriminant 12) and `WithdrawFromGasKey` (13) actions, with `.transferToGasKey()` / `.withdrawFromGasKey()` builder methods.
  - `GasKeyFullAccess` and `GasKeyFunctionCall` access-key permissions (discriminants 3 and 2) plus `GasKeyInfo`, usable via `.addKey(pk, { type: "gasKeyFullAccess", numNonces })` and `{ type: "gasKeyFunctionCall", numNonces, receiverId, methodNames }`.

  Together with the gas-key RPC view schemas, the default `.send()` path parses a successful 2.13 response (and `getAccessKey` accepts gas keys) without errors.

- db06bac: Parse gas-key variants in RPC view responses (nearcore 2.13)

  The RPC response schemas now accept the gas-key shapes, so reading a gas key or a transaction that touched one no longer throws:

  - `AccessKeyPermission` view accepts `GasKeyFunctionCall` and `GasKeyFullAccess` (each with `balance` + `num_nonces`), so `getAccessKey`/`getAccessKeys` work on gas keys.
  - The RPC action view accepts `TransferToGasKey` and `WithdrawFromGasKey`, so status-bearing transaction reads that echo those actions parse.

- c714e62: Add gas-key transacting and strict nonce mode (NEAR 2.13 / protocol v85)

  - Versioned transaction (V1) borsh encoding: `TransactionNonce` (`Nonce` / `GasKeyNonce`), `NonceMode` (`Monotonic` / `Strict`), and the custom `[0x01]`-tag scheme. V0 transactions stay tag-less and remain the default, so existing transactions are unchanged.
  - `.useGasKey(nonceIndex)` on the transaction builder signs with a gas key, carrying a `GasKeyNonce` and fetching the per-slot nonce via `EXPERIMENTAL_view_gas_key_nonces`.
  - `.strictNonceMode()` opts into strict (`ak_nonce + 1`) nonce validation.

- 0f736d5: Add ML-DSA-65 (FIPS 204) post-quantum signing support (nearcore 2.13 / protocol v85)

  - New `KeyType.ML_DSA_65` and `MlDsa65KeyPair` (deterministic keygen from a 32-byte seed via `@noble/post-quantum`, sign, `ml-dsa-65:` parse/format).
  - `parseKey`/`parsePublicKey` and `signWith`/`addKey`/transaction signing accept `ml-dsa-65:` keys; Borsh `PublicKey` and `Signature` gain the `[2]` variant (1952-byte key, 3309-byte signature).
  - View handles: `ml-dsa-65-hash:` (the 32-byte on-trie form returned by `view_access_key_list`) validates and parses via the read-only `parseMlDsa65Handle` helper, and is rejected as a signing key.

- 6cd17be: Expose `nonce_mode` on transaction views (new in nearcore 2.12)
- 4b5ef41: Add `receiptToTx()` to the RPC client for the new `EXPERIMENTAL_receipt_to_tx` endpoint (nearcore 2.12), accessible via `near.rpc.receiptToTx()`. The configured low-level RPC client is now exposed through the `near.rpc` getter for advanced calls not wrapped by `Near`.
- f8e8254: Add `view_state` with pagination and wrappers for RPC methods stabilized in nearcore 2.13

  - `near.viewState(accountId, { prefix, afterKey, limit, includeProof, ... })` reads a page of contract state; `near.viewStateAll(accountId, { prefix, limit })` is an async iterator that follows the `last_key` cursor across pages. Both are also on the low-level `near.rpc` client. `prefix` and `afterKey` are base64-encoded strings (sent as `prefix_base64`/`after_key_base64`); the returned `last_key` cursor is already base64, so pass it straight back as `afterKey`.
  - `near.rpc.blockEffects()`, `near.rpc.genesisConfig()`, and `near.rpc.maintenanceWindows(accountId)` wrap the stabilized methods, falling back to the `EXPERIMENTAL_*` aliases on pre-2.13 nodes.

### Patch Changes

- e9480f3: Make RPC error-handling and view-method integration tests deterministic by running them against the local sandbox instead of live public RPC.
- 7a96bd8: Harden flaky tests: make RPC-init unit tests assert configured URL without live network, raise tight 10s integration-test timeouts to the 60s global, and make the CI codecov upload non-fatal and conditional.
- adaa4a3: Update sandbox to nearcore 2.12.0
- 3c5e28a: Update sandbox default to nearcore 2.13.0-rc.2

## 0.14.0

### Minor Changes

- 7b6857b: Add `near-kit/schemas` subpath export for Zod validation schemas

  Export `AccountIdSchema`, `AmountSchema`, `GasSchema`, `PublicKeySchema`, `PrivateKeySchema` and their inferred types via `import { ... } from 'near-kit/schemas'`. Useful for composing your own validation logic without duplicating NEAR's validation rules.

- 23dc90a: Fix NearConnectWallet / NearConnectConnector types to match @hot-labs/near-connect reality

  - `manifest` is now required (was optional) — all wallets always provide it
  - `signDelegateActions` is now required on NearConnectWallet (was optional) — all wallets since v0.10.0 implement it
  - `getAccounts` return type `publicKey` is now optional (`string | undefined`) — hardware wallets and some wallet types don't always return it
  - Fixed `signDelegateAction` → `signDelegateActions` typo in manifest features — the feature gate check was dead code because the property name didn't match @hot-labs/near-connect's `WalletFeatures.signDelegateActions`
  - `NearConnectSignDelegateActionsResponse` now returns `string[]` (base64-encoded) matching near-connect's actual `SignDelegateActionsResponse` type — the adapter decodes these using `decodeSignedDelegateAction`
  - Adapter runtime guard now only checks `manifest.features.signDelegateActions` flag

  These changes eliminate the need for `as any` casts when passing `@hot-labs/near-connect` connectors to `fromNearConnect()`.

  Bumped `@hot-labs/near-connect` peer dependency from `>=0.9.0` to `>=0.11.0` — types now align with v0.11.0+ which changed `WalletFeatures.signDelegateAction` → `signDelegateActions` and `SignDelegateActionsResponse` from structured objects to `string[]`.

### Patch Changes

- bc4ca03: build(deps): bump the production-dependencies group with 2 updates

## 0.13.1

### Patch Changes

- fe383e3: Bump @noble/curves, @noble/hashes, @scure/base, @scure/bip32, @scure/bip39, tar, and @zorsh/zorsh production dependencies. Switch DeployContract, FunctionCall, and DeployGlobalContract Borsh schemas from `vec(u8)` to `bytes()` so inferred field types remain `Uint8Array` after the @zorsh/zorsh 0.5.0 type changes (wire format unchanged).

## 0.13.0

### Minor Changes

- ad3bba1: Rename `fromHotConnect` to `fromNearConnect` and deprecate old name. Deprecate `fromWalletSelector` (NEAR Wallet Selector is deprecated). Internal `HotConnect*` types renamed to `NearConnect*` with deprecated aliases.
- 8311ffc: Update Gas.MAX from "300 Tgas" to "1 Pgas" ("1000 Tgas") to match nearcore 2.11 protocol change

### Patch Changes

- c084f7f: Update sandbox to nearcore 2.11.0
- d1dfd2d: Update sandbox to nearcore 2.11.1
- e25c855: build(deps): bump tar from 7.5.9 to 7.5.11 in the production-dependencies group

## 0.12.0

### Minor Changes

- e75be6e: Add sandbox state manipulation methods: patchState, fastForward, dumpState, restoreState, saveSnapshot, loadSnapshot, and restart with snapshot support. Fix race conditions in dumpState and patchState, and fix restart DbVersion crash caused by stale process handles.

### Patch Changes

- 5987f39: build(deps): bump tar from 7.5.6 to 7.5.7 in the production-dependencies group
- 1f33644: build(deps): bump tar from 7.5.7 to 7.5.9 in the production-dependencies group
- d6c541e: Update sandbox to nearcore 2.10.7
- 5987f39: build(deps): bump tar from 7.5.6 to 7.5.7 in the production-dependencies group

## 0.11.0

### Minor Changes

- 9005294: Add wallet-based delegate action signing (meta-transactions via HOT Connect)

## 0.10.0

### Minor Changes

- 7039bbf: Add `getAccount()` method and fix `getBalance()` to return available balance

  - **`getBalance()`** now returns the **available** (spendable) balance, accounting for storage costs. Previously it returned the raw `amount` field which didn't account for tokens reserved for storage.

  - **`getAccount()`** is a new method that returns complete account state including:

    - `balance` - liquid balance (amount field)
    - `available` - actually spendable balance
    - `staked` - locked/staked balance
    - `storageUsage` - NEAR reserved for storage
    - `storageBytes` - raw storage in bytes
    - `hasContract` - whether a contract is deployed
    - `codeHash` - code hash of deployed contract

  - **`STORAGE_AMOUNT_PER_BYTE`** constant is now exported for custom calculations

  The available balance calculation follows the NEAR protocol rule that staked tokens count towards storage requirements:

  - If staked ≥ storage cost → all liquid balance is available
  - If staked < storage cost → some liquid balance is reserved for storage

## 0.9.0

### Minor Changes

- a42b460: Release v0.9.0

  - Move near-kit from peerDependencies to dependencies in @near-kit/react
  - This enables proper lockstep versioning with changesets

### Patch Changes

- a58fd6c: build(deps): bump the production-dependencies group across 1 directory with 2 updates

## 0.8.3

### Patch Changes

- ef3d67f: Add getAccessKeys() method to list all access keys for an account
- 78b65fd: Fix SLIP-0010 seed phrase derivation and global contract RPC schema

  - Fix `parseSeedPhrase()` to use SLIP-0010 standard ('ed25519 seed' HMAC key) instead of BIP32 ('Bitcoin seed')
  - Fix global contract action names in RPC schema: `DeployGlobalContract` and `UseGlobalContract` for code hash mode

- c387dad: Update sandbox to nearcore 2.10.5
