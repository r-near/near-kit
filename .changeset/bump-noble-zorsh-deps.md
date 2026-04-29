---
"near-kit": patch
---

Bump @noble/curves, @noble/hashes, @scure/base, @scure/bip32, @scure/bip39, tar, and @zorsh/zorsh production dependencies. Switch DeployContract, FunctionCall, and DeployGlobalContract Borsh schemas from `vec(u8)` to `bytes()` so inferred field types remain `Uint8Array` after the @zorsh/zorsh 0.5.0 type changes (wire format unchanged).
