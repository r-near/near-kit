---
"near-kit": minor
---

Add RPC validation to verifyNep413Signature for access key ownership verification

The `verifyNep413Signature` function now supports an optional `rpc` parameter that enables verification that the public key in the signed message actually belongs to the claimed account ID on the NEAR blockchain.

**Breaking change**: `verifyNep413Signature` is now an async function that returns `Promise<boolean>` instead of `boolean`.

Usage:
```typescript
// Without RPC validation (cryptographic verification only)
const isValid = await verifyNep413Signature(signedMessage, params)

// With RPC validation (also verifies key belongs to account)
const isValid = await verifyNep413Signature(signedMessage, params, {
  rpc: "https://rpc.mainnet.near.org",
})

// Or with an RpcClient instance
const rpc = new RpcClient("https://rpc.mainnet.near.org")
const isValid = await verifyNep413Signature(signedMessage, params, { rpc })
```
