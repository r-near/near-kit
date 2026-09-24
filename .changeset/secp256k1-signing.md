---
"near-kit": patch
---

Fix secp256k1 signing so nearcore accepts it: sign the 32-byte transaction / delegate / NEP-413 hash directly (no extra SHA-256) and emit `[r][s][v]` instead of `[v][r][s]`. `Secp256k1KeyPair` now also accepts 32-byte secret keys (near-cli / near-crypto format).
