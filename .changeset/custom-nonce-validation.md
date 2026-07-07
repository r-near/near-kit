---
"near-kit": minor
---

Add `nonceValidation` option to `verifyNep413Signature` for custom nonce schemes

NEP-413 defines the nonce as an opaque 32-byte value; embedding a timestamp in the first 8 bytes is a near-kit convention used by `generateNonce()`. Previously, verification always interpreted the first 8 bytes as a timestamp and enforced `maxAge`, which rejected valid signatures from apps using their own nonce schemes (e.g. intents.near).

- `nonceValidation: "timestamp"` (default) - existing behavior, unchanged
- `nonceValidation: "none"` - treat the nonce as opaque bytes per the spec; no timestamp/expiry check (`maxAge` is ignored), caller is responsible for nonce validation and replay protection
