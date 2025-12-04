---
"near-kit": minor
---

Add full access key validation to verifyNep413Signature and fullAccessKeyExists method to Near class

The `verifyNep413Signature` function now supports an optional `near` parameter that enables verification that the public key in the signed message actually belongs to the claimed account ID on the NEAR blockchain AND is a full access key (not a function call key).

**Breaking change**: `verifyNep413Signature` is now an async function that returns `Promise<boolean>` instead of `boolean`.

**New method**: `Near.fullAccessKeyExists(accountId, publicKey)` - Check if a full access key exists for an account.

Usage:
```typescript
// Without blockchain validation (cryptographic verification only)
const isValid = await verifyNep413Signature(signedMessage, params)

// With blockchain validation (verifies key belongs to account AND is full access)
const near = new Near({ network: "mainnet" })
const isValid = await verifyNep413Signature(signedMessage, params, { near })

// Check if full access key exists directly
const hasFullAccessKey = await near.fullAccessKeyExists("alice.near", "ed25519:...")
```
