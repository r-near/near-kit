# near-kit

## 0.11.1

### Patch Changes

- 5987f39: build(deps): bump tar from 7.5.6 to 7.5.7 in the production-dependencies group
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
