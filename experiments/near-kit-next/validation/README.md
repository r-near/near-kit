# Pinned read-only protocol checkpoint

These public static-fixture artifacts were downloaded from [run 36803350082](https://github.com/r-near/near-kit/actions/runs/36803350082), exact head `842b46352b222b1f68be6f8bb5c51b83d1399340`. The 16 Docker tests passed. Tests and the genesis generator remain the reproducible specification; subsequent exact-head checks are recorded on the PR.

Official image: `nearprotocol/sandbox@sha256:1f36ba675ecce97cf5311b8f29f6ca7c42af17b6d6c45d38a652f0f9bad282a7`. No key files or transaction-based setup are included. Gas balances are serialization fixtures, not economic/funding evidence. The captured block-effects array is empty, so it does not prove historical category branches. Proof bytes are not verified cryptographically.

`exact-nonces-response.json` preserves the native unquoted full-range u64 tokens. `fixture.json` is the deterministic public input manifest; state-derived block metadata/time changes across runs.
