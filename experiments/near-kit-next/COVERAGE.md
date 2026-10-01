# Coverage and acceptance

This is an implementation candidate, not a full-SDK completion claim. Existing packages remain unchanged.

| Workflow | Candidate disposition |
| --- | --- |
| Account/block/status, JSON/binary views, same-block composition | Named Effect reads |
| Permissions/key lists/gas lanes, code/global code | Named inspection reads; no signing/nonce allocation |
| State pages and complete traversal | Pinned page Stream with explicit partial-consumption semantics |
| Exact units and public account/key/hash data | Pure `/units` and `/data` |
| Genesis summary, maintenance windows, touched-account kinds | Named `/operator` reads; not full raw wire schemas |
| Full raw block/chunk/config inspection | Runnable explicit official-RPC CLI; original bytes, no full-wire typing claim |
| Wallet observation, framework cache/SSR/polling | Concrete version-pinned observation, React/Query/SSR and native polling recipes; acceptance is tracked below |
| Sandbox process management | External pinned Docker/static-genesis test infrastructure |
| Contract proxies, batch aliases, owned runtime, rounded spendability, catch-all existence | Deliberately omitted; ordinary functions/native Effect/exact data cover the useful jobs |
| Signing/custody/authentication/state-init and transaction/reconciliation paths | Separately paused/gated; not reconstructed as “pure helpers” |

## Current evidence

The broader source checkpoint `842b463` passed 278 tests on Node 22 and 24, isolated packed strict core/optional-wallet consumers, 33 real-browser cases and 16 static-genesis nearcore Docker tests. Unchanged repository CI is separate baseline evidence. Subsequent curl delegation passed independent source review and 282 local tests; final-head CI/measurements are recorded in [the evaluation](EVALUATION.md) and [draft 257](https://github.com/r-near/near-kit/pull/257). Earlier five-read results are historical only.

The static nearcore 2.13.4 fixture can seed public account/data/access-key/gas-lane/local-code records. It cannot seed the global-contract registry or manufacture historical block-effects categories. Successful global-code, full ML-DSA lookup and nonempty historical category coverage remain open. Both official-doc public testnet global-code candidates returned absence at the recorded final block; no transaction setup is used to close these gaps.

Native JSON feature failure, exact raw u64 values, parser depth errors, cancellation/no-prefetch, mutable cursor isolation, wallet-observation limitations and strict public consumer types have dedicated acceptance checks. Protocol tests, synthetic transport tests, mocked connector behavior and real platform coverage are labelled separately.

Full extension/mobile/hardware wallet, React Native, Deno and Bun compatibility are not implied by desktop browser or Node tests. Effect remains pinned to a release candidate. No publication or default-package replacement is proposed yet.
