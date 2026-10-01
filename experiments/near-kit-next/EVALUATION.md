# Useful independent candidate; keep it experimental

The coherent part of the redesign is now implemented beyond five reads: exact protocol inspection, pinned state streams, public data/units, operator summaries and runnable application read recipes. The [full rewrite goal](GOAL.md) remains open: independent public-address/authentication and additional application handoffs are ordinary unfinished work, while transaction-dependent work remains paused. Existing packages are unchanged.

## Why the selected design

The audit separated protocol knowledge from custody, wallet UI, cache/runtime ownership and test-node processes. Competing designs considered a NEAR service, Promise facade, upstream SDK adapter, configured method client and named functions over an opaque client. Named native-Effect functions keep one network implementation and caller-owned fibers/resources; pure encodings use ordinary TypeScript. No builder, generic RPC assertion, contract proxy, extra service layer or owned runtime is needed.

Native source-aware JSON preserves protocol u64/u128 quantities. This deliberately raises the runtime floor; contract JSON still has ordinary JavaScript numeric semantics. All version/range/resource claims need their specific evidence, not a broad “exact everywhere” label.

Independent reviews forced revisions to numeric/error contracts, borrowed HTTP behavior, pagination, missing-key compatibility, wallet callback/selection lifetimes and output completion. A custom full-wire Fetch/stdout example was removed when review showed needless lifetime complexity; the bounded raw-inspection recipe delegates to curl instead.

## Current acceptance

The current source checkpoint `99bc9fe` passed Node 22/24 checks (282 tests each), isolated packed consumers, 16 read-only nearcore Docker tests, 33 Chromium/Firefox/WebKit tests and unchanged repository CI. Non-author source review passed the core and all application recipes after recorded corrections. Final documentation/measurement head checks are recorded on [draft 257](https://github.com/r-near/near-kit/pull/257).

Browser tests use a real controlled HTTP server and a typed mocked connector with real RxJS/React/Query behavior. They establish application cleanup and stale-result handling, not real extension/mobile/hardware-wallet compatibility. The static node uses official nearcore 2.13.4, protocol 86, with genesis-only fixtures and no submitted transactions. Native JSON was exercised on Chromium 153, Firefox 155 and WebKit 26.6; stated feature floors are not historical-engine test results.

Strict core/data/units consumers remain Node-global-free. WalletSelector 10.1.4's optional declarations require Bundler resolution, type-only Node declarations and two explicit upstream declaration-path mappings. Those onboarding costs are real; they are not hidden by skipLibCheck or runtime polyfills.

## Remaining product boundaries

- Signing/custody, transaction encoding/submission/reconciliation and applying state-init on-chain remain paused. Independent public address calculation and NEP-413 verification/challenge receipt are separately open implementation work. No full completion or release recommendation is possible while the required workflows remain unresolved
- Successful global-code retrieval lacks real-node evidence: both official-doc public testnet examples returned absence at the recorded block, and the static genesis has no registry record. Historical block-effect categories and full ML-DSA lookup also retain narrower evidence
- Proof bytes are unverified. Account/code metadata is node-reported, not consensus proof; parsing a key does not verify its mathematics
- Effect 4.0.0-rc.118 and its HTTP APIs are prerelease dependencies. The already-aborted runner limitation remains documented; application entry guards are required
- The response-byte cap is not a total heap/CPU bound. Synchronous parsing and caller non-cooperative effects are not preemptible

The prior experiment's measurements are preserved in the [historical report](https://github.com/r-near/near-kit/blob/137ce56eea4cc0a14f15d75e06685cefe25dc26a/experiments/read-client/EVALUATION.md). The new complete-workflow measurements below do not cover the paused product scope.


## Measured costs

The [full results](https://github.com/r-near/near-kit/tree/experiment/near-kit-full-20261001/experiments/near-kit-next/measurements-next) retain raw samples and semantic differences. Node 24.19.0 on one Xeon 8370C; esbuild 0.28.2; measured tarball `c1734db3…89eaf69` at `842b463`. Later edits affect the unmeasured raw-inspection tool and documentation; packaged-member equivalence is recorded separately.

| Complete consumer/workload | Candidate | Main 86cf14a | near-api-js 7.3.1 |
| --- | ---: | ---: | ---: |
| Account browser gzip | 44,145 B | 115,238 B | 65,215 B |
| Snapshot browser gzip | 48,183 B | 115,894 B | 65,929 B |
| Account import median | 213.46 ms | 154.72 ms | 62.14 ms |
| Warm account median | 3.01 ms | 2.31 ms | 2.33 ms |
| Complete snapshot median | 24.11 ms | 18.37 ms | 17.96 ms |

Smaller tree-shaken bundles come with slower imports and loopback workflows in these measurements. The candidate adds 19,733 gzip bytes to the measured Effect+Schema leaf-import app; it is not free merely because an application already uses Effect. Effect alone contributes about 49.5 MB of unpacked source/maps/docs. A small direct-fetch application remains much cheaper when it does not need this contract.

The snapshot includes eight reads, 237 binary state entries and complete serialized output. Legacy lanes do not provide identical precision, validation or cancellation. The dataset's u64 values are safely representable; projecting already-rounded numbers cannot repair other inputs. The near-api browser lane includes util, and its snapshot uses generic query for pinned keys and cursors. All 12,405 fixture requests and eleven minified workflow checks passed. These are local, process-cold/filesystem-warm results, not mainnet speed claims.

Actual mountable React and React Query consumers including ReactDOM cost 105,813 / 115,484 gzip bytes, about 46 KB beyond their matched existing apps. Selector setup/modules are excluded. The actual filesystem export measured 26.63 ms median including fsync/publication and harness validation/removal. Pure data/units consumers are 1,797 / 516 gzip bytes with zero Effect runtime input, though installation still includes the package dependency.

Recommendation: retain the coherent Effect-first candidate for further review, but do not replace or publish the SDK yet. Resolve essential paused scope and the explicit protocol/platform gaps first; do not justify adoption through a speed claim or architecture alone.
