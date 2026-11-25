# Coverage and acceptance

The [complete SDK goal](GOAL.md) remains open. This candidate now includes independently designed reads, public-data/address utilities, NEP-413 verification and complete application read/authentication examples. Required transaction/custody/submission workflows remain unfinished behind the recorded boundary; they are not replaced by the read implementation.

| Workflow | Candidate disposition |
| --- | --- |
| Account/block/status, JSON/binary views, same-block composition | Named Effect reads |
| Permissions/key lists/gas lanes, account/global code | Named inspection reads, including real full ML-DSA lookup and both global registry references |
| State pages and complete traversal | Pinned page Stream with explicit partial-consumption semantics |
| Exact units and public account/key/hash data | Pure `/units` and `/data` |
| Public deterministic account calculation | Pure `/address`, fixed NEP-616 V1; six independently reproduced Borsh/Keccak vectors |
| Public NEP-413 proof verification | Pure `/nep413`, explicit Ed25519/secp256k1 profile; not standalone account authentication |
| Challenge/authority/replay/session receipt | Runnable Node application example with its own bounded store, clock, timeout and atomic commit |
| Genesis/maintenance/touched-account inspection | Named `/operator` summaries, including all four nonempty historical effect kinds |
| Full raw block/chunk/config inspection | Runnable bounded official-RPC curl recipe; original bytes, no full-wire typing claim |
| Wallet observation, React/Query/polling | Version-pinned recipes with caller-owned connector/cache/runtime |
| Server read to browser hydration | Shipped route, bounded exact DTO and hydration/disposal examples; per-request/document identity |
| Sandbox process management | External pinned Docker/static-genesis test infrastructure |
| Advanced sandbox patch/fast-forward/full-node backup | Deliberately external node/test tooling; account export is not node restore |
| Contract proxies, batch aliases, owned runtime, rounded spendability, catch-all existence | Deliberately omitted; ordinary functions/native Effect/exact data cover useful jobs |
| Signing/custody, on-chain state-init, actions/delegates, submission and reconciliation | Paused; full replacement acceptance remains open |

## Evidence and limits

The first continuation checkpoint `100fbdc` passed [candidate CI](https://github.com/r-near/near-kit/actions/runs/36815383853) on Node 22/24, Deno 2.9.7, Bun 1.4.2, the three browser engines, pinned nearcore Docker and an independent Rust public-address reference. It also passed [unchanged SDK CI](https://github.com/r-near/near-kit/actions/runs/36815383849). Implementation head `7ab144b` passed [the expanded candidate matrix](https://github.com/r-near/near-kit/actions/runs/36818029551) and [unchanged SDK CI](https://github.com/r-near/near-kit/actions/runs/36818029665): 387 tests each on Node 22/24, fresh strict packed consumers, the new SSR/public-crypto browser cases, Deno/Bun public proofs, Docker and locked Rust vectors. Final documentation-head checks are recorded on [draft 257](https://github.com/r-near/near-kit/pull/257).

Successful public mainnet global-code retrieval is captured by hash and publisher, with independent content hashes. Four nonempty block-effect kinds are captured from fixed public blocks. These live read results and replay fixtures are distinct from static-genesis Docker, which proves the full ML-DSA key lookup. No transaction setup manufactured these states.

Public NEP-413 fixtures use disposable off-chain material and independent Node/OpenSSL framing/verification. The receipt tests exercise actual local HTTP and controlled RPC, including source capture, races, expiry, timeout, chunked uploads and response loss after commit. They do not establish real-wallet behavior. ML-DSA authentication verification is deliberately unsupported by the selected crypto profile.

Real extension/mobile/hardware wallets, React Native, macOS/Windows/ARM runtimes and historical browser floors are not inferred from the tested Linux/desktop engines. Wallet connection/signing remains separate from observation. Storage proofs are explicitly unverified; node-reported metadata is not consensus authentication. Effect's pinned release-candidate status and native JSON requirements remain explicit in [the evaluation](EVALUATION.md).
