---
"near-kit": minor
---

Simplify the meta-transaction delegate flow by returning `{ signedDelegateAction, payload, format }` from `.delegate()`, introducing first-class payload encode/decode helpers, and updating docs/examples to match the new transport pattern.
