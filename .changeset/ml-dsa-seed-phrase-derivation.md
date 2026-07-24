---
"near-kit": minor
---

Add ML-DSA-65 key derivation from BIP-39 seed phrases. `parseSeedPhrase` now accepts an options object with a `keyType` of `"ed25519"` (default) or `"ml-dsa-65"`, deriving post-quantum keys via the SLIP-0010 construction from satoshilabs/slips#1968 (master node `HMAC-SHA512(key = "ML-DSA-65 seed", data = BIP-39 seed)`, hardened-only children, node secret used as the FIPS 204 seed ξ). Validated against the slips#1968 test vectors.
