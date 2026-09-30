---
"near-kit": patch
---

Reject the transaction builder's `.nonce()` setting in `delegate()` and `delegateV2()` before RPC calls, signing, or wallet prompts. Use the existing delegate `{ nonce }` options for local signing; relayers can still set an independent outer transaction nonce when wrapping a signed delegate action.
