---
"near-kit": minor
---

Add AuthPayload type and helper functions for NEP-413 HTTP authentication

- Add `AuthPayload` interface for standardized HTTP request payloads
- Add `createAuthPayload()` to serialize SignedMessage + SignMessageParams for HTTP
- Add `parseAuthPayload()` to deserialize on the server side
- Nonce is now base64-encoded for compact JSON transport
