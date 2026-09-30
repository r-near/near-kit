# Independent acceptance: Effect simplification pass

Date: 2026-09-30. Reviewed source: `1d314715725520178a9c659ee6bb6ef5832a8589`.
Phase-one baseline: `95111ba2076939ae8ab9820bd27428214858e245`.
Original baseline: `86cf14a2a9e0c7d3acaa8e3d40b5fb4c85ef172d`.
Experiment: [PR #252](https://github.com/r-near/near-kit/pull/252).

## Verdict

The second pass materially simplifies ownership and implementation, beyond renaming or shortening comments. No unresolved reproduced implementation finding remains in the reviewed scope. The exact-source local gates and CI pass. Live-browser execution and local real-nearcore execution remain explicitly unverified or blocked as described below; neither is represented as a local pass. This is acceptance of an experiment, not a merge or release decision.

The review re-read the installed Effect v4 and test-audit guidance, inspected every production-module family, independently reviewed the implementation slices, and ran a fresh detached-checkout installation and final verification. The review challenged the first pass's compatibility scaffolding rather than treating it as a required design.

## What became smaller

| Measure                                  | Phase one | Final source |         Change |
| ---------------------------------------- | --------: | -----------: | -------------: |
| Production TypeScript/TSX modules        |        59 |           57 |             -2 |
| Physical production lines                |    17,291 |       14,761 | -2,530 (14.6%) |
| Nonblank lines after AST comment removal |    11,371 |        9,608 | -1,763 (15.5%) |
| Classes                                  |        52 |           50 |             -2 |
| WeakMaps                                 |         4 |            0 |             -4 |
| Static `fromPromise` call sites          |        83 |           40 |            -43 |
| Static `runPromise` call sites           |        79 |           78 |             -1 |
| Static `tryPromise` call sites           |         3 |            2 |             -1 |

These are descriptive counts, including types, not quality scores or dynamic runtime-boundary counts. A thin public Promise API still needs Promise runners. The important deletion is the native-to-Promise-to-native reconstruction and interception machinery. Against the original pre-Effect source, the final production tree is only 562 physical lines larger (+6,451/-5,889), while adding the optional native API and resource ownership.

- One native acquisition owns resolved RPC, keys, wallet, nonce allocation, readiness and transaction dependencies. The public Near class projects it; native acquisition no longer constructs a Promise Near or carries a client backreference.
- RPC program cloning, four WeakMaps, prototype snapshots and method-override dispatch are gone. Named operations are defined once at module scope, with explicit dependencies.
- One native RPC codec/type owner replaces the duplicate internal Zod RPC schema module and failure-time decoder replay. Public Zod composition remains available at its supported subpaths and is absent from normal root/native bundles.
- Transactions share preparation, hashing/signing and delegate-resolution logic while retaining separate protocol encoders, one fluent action state, and explicit submission retry provenance.
- Built-in key stores and wallets retain one native capability. Structural application-provided Promise integrations are adapted at their actual boundaries. File/native storage layers provide the shared KeyStore service.
- React consumes native capabilities directly. The dead contract prototype helper and fake-client compatibility paths are removed. Nonce reservation and sandbox lifetime machinery remain because they protect demonstrated races, not because of compatibility with old private classes.

## Explicit contract decisions

The familiar root Promise methods, fluent transaction operations, supported KeyStore/Signer/Wallet interfaces, domain error classes and wire formats remain. The root has the same 57 runtime export names. Public response types retain nested mutability and wait-level narrowing. Strict public/native/NEP-413/Zod composition consumers compile in CI.

This pass intentionally retires undocumented built-in monkeypatch/subclass interception and private source-import contracts. Invalid internal config/RPC and root validation-helper inputs now use Effect Schema diagnostics instead of replaying internal Zod errors. A path-string keyStore, which previously silently selected empty memory storage, is rejected. The unpublished native `make` API now returns the native service. Debug configuration is captured at acquisition; the public constructor reads current SDK environment settings on each construction. These decisions must remain explicit in the migration guide.

Genuine Zod schemas under `near-kit/schemas` and credential schema exports under `near-kit/keys` remain composable Zod values. External rejection identity remains preserved through the public Promise boundary.

## Exact-source acceptance matrix

| Area                                  | Evidence and result                                                                                                                                                                      |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frozen installation                   | Fresh detached worktree, Bun 1.4.2 frozen install and prepare patches passed; no shared workspace package-link substitution                                                              |
| Build/tooling                         | Aggregate check passed with Node 24.19.0 and 22.19.0: source/declarations, public/native/NEP/Zod consumers, examples, zero-warning type-aware lint and formatting                        |
| Core and wallet behavior              | 1,316 tests in 64 files passed independently on both Node versions; no skips                                                                                                             |
| React                                 | 54 tests in 8 files passed with React 19.2.7/Node 24 and React 18.3.1/Node 22.19, including the real signing-authority replacement regression                                            |
| Public API                            | Emitted public declarations and runtime export sets compared; public consumer remains unchanged; constructor positional provider support and nested mutable response types retained      |
| Native composition                    | Injected RPC, keys, wallet and nonce services control actual operations; lazy acquisition, cached readiness, typed errors and custom NEP reader requirements checked                     |
| RPC and protocol codecs               | 40 baseline Zod/native schema pairs: 110,055 top-level plus 89,667 nested generated evaluations, zero differences in acceptance/successful output                                        |
| Validation helpers and public schemas | 46,228 generated comparisons, zero helper-acceptance/success-value or public-Zod-result/error-message differences; actual Zod composition and static inference checked                   |
| Transactions and wallets              | Retained signed-byte commitments, explicit/strict/gas-key nonce paths, delegate versions, callback receivers, rejection identity, cancellation and bounded submission retry tests passed |
| Stores and resources                  | Real filesystem and fixture-process regressions, insertion/rotation behavior, malformed persistence and scoped cleanup retained; keyring is tested with FFI fakes                        |
| Package                               | Fresh-build npm pack dry-run: all 10 subpath JS/declaration targets present; 201 packaged files                                                                                          |
| Browser distribution                  | Root/native browser bundles have zero Zod inputs, zero compatibility-schema inputs and zero external imports in their build graphs                                                       |
| Browser-like runtime                  | Bundled Promise/native reads, real generated-key public and native NEP-413 verification, and interruption passed in a standards-global VM: 5 requests, no process or Buffer globals      |
| Live browser                          | Not passed: the available cloud Chrome localhost navigation was blocked during this experiment; the VM is not a browser sweep                                                            |
| Real-chain integration                | Exact-source CI passed all 25 integration files, 286 tests. Local nearcore remains blocked by hard descriptor limit 16,384 versus required 65,535                                        |

[Exact-source CI run 36671572748](https://github.com/r-near/near-kit/actions/runs/36671572748) passed both jobs. Independently inspected logs show **1,602 near-kit tests in 89 files plus 54 React tests in 8 files: 1,656 passed**, including all 286 integration tests, with no skipped-test summary. Only the optional Codecov upload step was skipped; this is not coverage evidence. The checkout was synthetic merge `9292961`, explicitly merging the reviewed source SHA into `86cf14a`; the commit-to-run lookup associates it with the reviewed source.

## Findings independently reproduced and repaired

1. React JSON config stabilization retained stale signing authority. Replacing the wallet or key store still produced a signature with the old key. Two real-key tests failed before the identity-aware provider repair and pass on the final source.
2. The new transaction constructor discriminated dependencies using an `rpc` property. A valid external provider with unrelated `rpc` metadata was misclassified and failed at key lookup. Constructor arity now distinguishes the overloads; the exact signed hash is preserved.
3. Pure RPC error classification exposed TypeError defects for malformed nested InvalidNonce values and hostile JSON coercion fields. Explicit input refinements and a narrow coercion boundary restore recoverable failures. Real transport regressions prove typed recovery and one request rather than retry.
4. An external signer rejecting InvalidNonce before submission was invoked three times despite zero broadcasts. Only a rejection from the submission operation can now create the private retry signal. Independent probes confirm one pre-submit signing attempt, successful recovery after a real submission rejection, and bounded three-attempt exhaustion with original rejection identity.

The async initialization test port was also strengthened: an observation at native acquisition proves it cannot return the service while a controlled key write is still blocked. That closes a test gap without restoring private implementation fields.

## Test-audit accounting

No test file was removed. Unit/wallet runtime cases change from 1,329 to 1,316, while React changes from 52 to 54. The integration suite retains all 25 files and 286 cases. Source changed +2,804/-5,334 lines; tests, support and compile-only fixtures changed +1,715/-1,930.

Retired checks were source-only `.parse`/private-field probes, the eight tests owning the unused prototype helper, and assertions specifically preserving undocumented method interception. Config checks now exercise actual routing, headers, retries and signing; readiness checks use gated external writes and real signatures; signature reuse checks observe the key signer rather than a builder method. RPC classifier throw-to-return renames preserve the original error cases. Zod and native environment/type claims are compiler-enforced consumers, not merely transpiled `expectTypeOf` assertions. Native-capability React fakes test real Effect lifetimes; separate real-client account/authority tests check integration. Fixed protocol bytes, safety failures, resource finalizers, wallet approval counts and real-chain assertions remain.

The accompanying repository test-retention ledger records exact categories and literal declarations. Table-driven declarations expand into multiple runtime cases, so declaration counts are not test counts.

## Performance method and results

The portable benchmark checks the returned read value, 2,100 mock transport calls and an independent pre-migration transaction hash. Each run uses a fresh process, 100 read and 20 signing warmups, then 2,000 sequential Promise reads, 2,000 fresh clients and 200 explicit-nonce signatures. Baseline and candidate alternate order for seven samples per comparison. Both comparisons use Node 24.19.0, the same compiler/common dependency versions and no real network. Raw totals, medians and ranges are included. Shared-container CPU/GC noise means these are local microbenchmarks, not production load results or significance claims.

### Against the first Effect pass

| Operation                 | 95111ba median per operation | Final median per operation | Change |
| ------------------------- | ---------------------------: | -------------------------: | -----: |
| Fresh-process import      |                   314.925 ms |                 293.228 ms |  -6.9% |
| Promise view              |                  0.269007 ms |                0.152569 ms | -43.3% |
| Fresh client construction |                  0.429775 ms |                0.062714 ms | -85.4% |
| Explicit-nonce signature  |                  1.063075 ms |                0.869986 ms | -18.2% |

Profiling explained the construction cost. Initially, 73% of sampled CPU hits were Effect.fn setup helpers. Hoisting operations removed that waste, revealing a second cost: constructing and indexing a full environment provider per client (66.5% of an intermediate profile). A direct service provision with a two-setting public-boundary snapshot removes that work. Native callers retain their own ConfigProvider. No tracing was disabled.

### Against the original pre-Effect SDK

This was a separate alternating comparison; candidate medians differ slightly and are intentionally not mixed with the table above.

| Operation                 | 86cf14a median per operation | Final median per operation | Residual ratio |
| ------------------------- | ---------------------------: | -------------------------: | -------------: |
| Fresh-process import      |                   135.273 ms |                 290.021 ms |          2.14x |
| Promise view              |                  0.040833 ms |                0.158967 ms |          3.89x |
| Fresh client construction |                  0.005052 ms |                0.067401 ms |         13.34x |
| Explicit-nonce signature  |                  0.826918 ms |                0.954708 ms |          1.15x |

The final experiment still adds about **0.118 ms per mock Promise read**, **0.062 ms per fresh client**, and **155 ms per fresh-process import** versus the original. Signing samples overlap substantially in the original comparison. Applications should reuse clients; remote RPC/chain time is excluded. The Effect migration is not a performance improvement over the original SDK overall.

### Browser size

To reproduce the phase-one figures exactly, this comparison builds both available **source entrypoints together** with Bun 1.4.2, browser target and minification, then measures each output with Node 24 gzip level 9. Outputs are not added together. Paired and independent entrypoint builds can tree-shake differently; Python zlib also produced different compressed sizes, so it was not used for the comparison.

| Version / complete entry | Minified bytes | gzip-9 bytes |
| ------------------------ | -------------: | -----------: |
| Original root            |        258,032 |       82,046 |
| Phase-one root           |        417,507 |      131,292 |
| Final root               |        333,986 |      112,111 |
| Phase-one native         |        422,841 |      132,948 |
| Final native             |        326,602 |      109,856 |

The final root is **19,181 gzip bytes smaller (14.6%)** than phase one; the native output is **23,092 bytes smaller (17.4%)**. The root remains **30,065 gzip bytes larger (36.6%)** than the original. As an additional distribution check, independently built compiled package entries measured 111,568 gzip bytes for root and 97,566 for native; those figures use a different entry-build method and are not substituted into the comparison table. Application-specific tree shaking can differ further. Both final entry graphs contain no Zod runtime.

## Remaining limits and decisions

- Live browser execution, wallet-extension interaction, a multi-browser sweep, actual OS keyrings, and macOS/Windows execution were not verified.
- Local real-nearcore execution is still blocked; exact CI supplies that evidence separately.
- React 18.3.1 and 19.2.7 were tested, not every supported minor version.
- Generated differential cases include repeated inputs and are not exhaustive protocol proof. There was no production-load, long-running memory/leak soak or general fuzzing campaign.
- Effect 4.0.0-rc.118 remains a pinned prerelease. Accepting its residual bundle/startup/runtime costs and the documented compatibility decisions is a separate release decision.

The frozen source remained unchanged during final validation. No source/test edits were made while its Vitest processes ran. No merge, release or deployment was performed by this review.
