---
"near-kit": minor
---

Type ExecutionMetadata V4 per-action `contracts` (nearcore 2.13)

`ExecutionMetadataSchema` is now a union discriminated on `version`. V4 metadata exposes a typed `contracts` array — one entry per action recording the contract attached to the receiver account before that action ran (`{ local } | { global_hash } | { global_account_id } | null`). V1-V3 parsing is unchanged, and unknown future versions still parse via a fallback.
