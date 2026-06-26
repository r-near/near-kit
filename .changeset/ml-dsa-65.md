---
"near-kit": minor
---

Add ML-DSA-65 (FIPS 204) post-quantum signing support (nearcore 2.13 / protocol v85)

- New `KeyType.ML_DSA_65` and `MlDsa65KeyPair` (deterministic keygen from a 32-byte seed via `@noble/post-quantum`, sign, `ml-dsa-65:` parse/format).
- `parseKey`/`parsePublicKey` and `signWith`/`addKey`/transaction signing accept `ml-dsa-65:` keys; Borsh `PublicKey` and `Signature` gain the `[2]` variant (1952-byte key, 3309-byte signature).
- View handles: `ml-dsa-65-hash:` (the 32-byte on-trie form returned by `view_access_key_list`) validates and parses via the read-only `parseMlDsa65Handle` helper, and is rejected as a signing key.
