---
"near-kit": patch
---

Fix SLIP-0010 seed phrase derivation and global contract RPC schema

- Fix `parseSeedPhrase()` to use SLIP-0010 standard ('ed25519 seed' HMAC key) instead of BIP32 ('Bitcoin seed')
- Fix global contract action names in RPC schema: `DeployGlobalContract` and `UseGlobalContract` for code hash mode
