---
"near-kit": patch
---

Redesign `publishContract` API with clearer `identifiedBy` parameter

The `publishContract` method now uses an options object with `identifiedBy: "hash" | "account"` instead of the misleading `accountId` parameter. The default mode is now `"account"` (updatable contracts).

**Migration guide:**

```typescript
// Before
publishContract(wasm) // immutable (hash)
publishContract(wasm, "factory.near") // updatable (account)

// After
publishContract(wasm) // updatable (account) - DEFAULT CHANGED
publishContract(wasm, { identifiedBy: "hash" }) // immutable (hash)
```

This change makes it clear that:
- `"account"` mode: Contract is updatable by the signer, identified by their account
- `"hash"` mode: Contract is immutable, identified by its code hash
