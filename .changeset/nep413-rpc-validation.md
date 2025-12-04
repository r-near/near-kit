---
"near-kit": minor
---

Add access key validation to verifyNep413Signature and accessKeyExists method to Near class

The `verifyNep413Signature` function now supports an optional `near` parameter that enables verification that the public key in the signed message actually belongs to the claimed account ID on the NEAR blockchain.

**Breaking change**: `verifyNep413Signature` is now an async function that returns `Promise<boolean>` instead of `boolean`.

**New method**: `Near.accessKeyExists(accountId, publicKey)` - Check if an access key exists for an account.

Usage:
```typescript
// Without blockchain validation (cryptographic verification only)
const isValid = await verifyNep413Signature(signedMessage, params)

// With blockchain validation (also verifies key belongs to account)
const near = new Near({ network: "mainnet" })
const isValid = await verifyNep413Signature(signedMessage, params, { near })

// Check if access key exists directly
const hasKey = await near.accessKeyExists("alice.near", "ed25519:...")
```
