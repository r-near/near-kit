---
"near-kit": minor
---

Replace `fullAccessKeyExists` with more general `getAccessKey` method

**Breaking change**: `Near.fullAccessKeyExists()` has been removed.

**New method**: `Near.getAccessKey(accountId, publicKey)` - Returns the full access key information or `null` if the key doesn't exist.

Migration:
```typescript
// Before
const hasFullAccessKey = await near.fullAccessKeyExists("alice.near", "ed25519:...")

// After  
const accessKey = await near.getAccessKey("alice.near", "ed25519:...")
const hasFullAccessKey = accessKey !== null && accessKey.permission === "FullAccess"
```

This change provides more flexibility by exposing the full `AccessKeyView` data instead of a boolean, allowing users to inspect key permissions, nonces, and other metadata.
