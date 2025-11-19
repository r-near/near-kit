---
"near-kit": patch
---

Improve NEP-413 message signing with timestamp-based nonce generation and automatic expiration

- Add `generateNonce()` helper that embeds timestamp in nonce (first 8 bytes)
- Add `maxAge` parameter to `verifyNep413Signature()` for automatic expiration checking (default: 5 minutes)
- Add `callbackUrl` and `state` fields to `SignMessageParams` and `SignedMessage` per NEP-413 spec
- Add comprehensive TSDoc to NEP-413 functions explaining security considerations
- Reduce nonce storage burden: only need to track nonces within the `maxAge` window instead of forever
