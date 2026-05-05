# near-kit

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
