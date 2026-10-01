# Coverage and acceptance

This is an implementation candidate, not a full-SDK completion claim. Existing packages remain unchanged.

| Workflow | Candidate disposition |
| --- | --- |
| Account/block/status, JSON/binary views, same-block composition | Named Effect reads |
| Permissions/key lists/gas lanes, code/global code | Named inspection reads; no signing/nonce allocation |
| State pages and complete traversal | Pinned page Stream with explicit partial-consumption semantics |
| Exact units and public account/key/hash data | Pure `/units` and `/data` |
| Genesis summary, maintenance windows, touched-account kinds | Named `/operator` reads; not full raw wire schemas |
| Full raw block/chunk/config inspection | Explicit official-RPC recipe to be completed |
| Wallet observation, framework cache/SSR/polling | Application-owned recipes to be completed and tested |
| Sandbox process management | External pinned Docker/static-genesis test infrastructure |
| Contract proxies, batch aliases, owned runtime, rounded spendability, catch-all existence | Deliberately omitted; ordinary functions/native Effect/exact data cover the useful jobs |
| Signing/custody/authentication/state-init and transaction/reconciliation paths | Separately paused/gated; not reconstructed as “pure helpers” |

## Current evidence

The source builds and the migrated first-checkpoint regressions pass. Expanded black-box, packed consumer, browser and real-node acceptance is still being completed. The historical evaluation is evidence for its exact earlier artifact, not acceptance of this candidate.

The static nearcore 2.13.4 fixture can seed public account/data/access-key/gas-lane/local-code records. It cannot seed the global-contract registry or manufacture historical block-effects categories. Successful global-code and some nonempty category coverage need existing, separately identified read-only evidence; no transaction setup is used to close these gaps.

Native JSON feature failure, exact raw u64 values, parser depth errors, cancellation/no-prefetch, mutable cursor isolation, known wallet-observation limitations and strict public consumer types are required gates. Protocol tests, synthetic transport tests, mocked connector behavior and real platform coverage are labelled separately.

Full extension/mobile/hardware wallet, React Native, Deno and Bun compatibility are not implied by desktop browser or Node tests. Effect remains pinned to a release candidate. No publication or default-package replacement is proposed yet.
