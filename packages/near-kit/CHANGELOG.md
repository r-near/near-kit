# near-kit

## 0.8.3

### Patch Changes

- ef3d67f: Add getAccessKeys() method to list all access keys for an account
- 78b65fd: Fix SLIP-0010 seed phrase derivation and global contract RPC schema

  - Fix `parseSeedPhrase()` to use SLIP-0010 standard ('ed25519 seed' HMAC key) instead of BIP32 ('Bitcoin seed')
  - Fix global contract action names in RPC schema: `DeployGlobalContract` and `UseGlobalContract` for code hash mode

- c387dad: Update sandbox to nearcore 2.10.5
