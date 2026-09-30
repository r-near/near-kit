# Independent acceptance report: Effect-native near-kit experiment

Date: 2026-09-30. Baseline: `86cf14a2a9e0c7d3acaa8e3d40b5fb4c85ef172d`.
Source target: `a39d1aa517fe3d3b90d16b19c8da957f4172a3d8`. PR: [#252](https://github.com/r-near/near-kit/pull/252).

## Scope and verdict

The review covered the complete migration diff, the public Promise SDK and optional Effect entrypoint, protocol decoding, transaction/signing paths, nonce coordination, wallets, memory/file/native key stores, sandbox resources, React hooks, packaging, documentation examples, and the TypeScript/Oxc gates. The repository guidance, installed Kit Langton Effect v4 skill, OpenClaw test-audit skill, migration plan, and checkpoint ledger were read before acceptance work.

No unresolved reproducible implementation finding remains in the reviewed scope. Every reproduced implementation finding was returned to its owner and tested again after repair. Passing source, behavioral, package, and CI gates are distinguished from the explicit live-browser and local-environment limitations below. This is an experimental acceptance report, not authorization to merge, publish, or deploy.

## Exact-source gate results

- Fresh independent frozen installation and prepare patch passed. The final source delta did not change dependency manifests or lockfile.
- Aggregate `bun run check` passed on both Node 24.19.0 and Node 22.19.0, including source/declaration builds, public/native consumer fixtures, examples, zero-warning lint, and formatting.
- Independent local unit/wallet run: **1,329 tests passed in 62 files**, repeated on both Node versions; no skipped tests.
- React: **52 tests passed in 7 files** with React 19.2.7 on Node 24 and React 18.3.1 on Node 22.19.
- [Exact-source CI run 36664462378](https://github.com/r-near/near-kit/actions/runs/36664462378) passed both jobs. Its test log records **1,615 near-kit tests in 87 files plus 52 React tests in 7 files**, totaling **1,667 passed**. The 25 integration files account for 286 passing tests; no test was skipped. The optional Codecov upload step was skipped and is not test or coverage evidence.
- GitHub's commit-to-run lookup associates that run with the source target above. The checkout log identifies synthetic PR merge `2a1f768`, merging that exact source SHA into the stated `86cf14a` baseline; this was not a claim that the runner checked out the head SHA directly.
- Tracked source remained unchanged during the isolated final runs. No source or test edits were made while Vitest was running.

## Acceptance matrix

| Area                         | Independent evidence                                                                                                                            | Result                                                                                                  |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Reproducible installation    | Fresh detached checkout, frozen Bun 1.4.2 install, Effect-tsgo prepare patch; dependencies remain pinned                                        | Passed                                                                                                  |
| Source/tooling               | Build; declaration project-reference typecheck; strict public/native consumer fixtures; examples; type-aware Oxc; Oxfmt; diff check             | Passed on Node 24.19 and 22.19                                                                          |
| Public API and declarations  | Complete emitted declaration comparison against baseline, plus the same strict public consumer compiled against both implementations            | No narrowed original public method signatures found; native methods and runtime parameters are additive |
| Legacy internals             | Source review of the single native pipeline and the Promise edges                                                                               | Internal NonceManager and RpcClient class removed; no retained old asynchronous engine                  |
| Native composition and state | Actual supplied keys and nonce service determine an unsigned transaction; request IDs and reservation isolation/concurrency tested              | Passed                                                                                                  |
| RPC/wire semantics           | Request body/headers, aliases, public middleware, typed errors, retry deadlines, identical signed-byte replay, streaming termination            | Passed                                                                                                  |
| Native protocol codecs       | 40 legacy/native schema pairs; 110,055 top-level and 89,667 nested generated evaluations, including repeated cases                              | Zero differences after repair; sampling is not exhaustive proof                                         |
| Signing/transactions         | Retained crypto/Borsh tests, captured pre-migration wire commitments, explicit nonce, strict/gas-key modes, delegates, failure/retry boundaries | Passed                                                                                                  |
| Wallets and policy overrides | Exact rejection preservation, finality reconciliation, no repeated approval on failure, native cancellation, Near/key-store overrides           | Passed                                                                                                  |
| Key stores                   | Insertion order, rotating selection, snapshot arrays, real filesystem persistence and malformed credentials, keyring FFI failure fakes          | Passed at tested boundaries; no real operating-system keyring exercised                                 |
| Sandbox ownership            | Real fixture subprocesses, init/start failure, interruption, detached cleanup, stop/restart race, snapshot preservation                         | Passed locally; real nearcore integration covered by exact CI                                           |
| React                        | Complete inherited and new lifecycle suites with React 19.2.7 and React 18.3.1; actual native-read finalization and latest-mutation ownership   | 52 tests passed on each runtime pairing                                                                 |
| Original coverage            | All 82 baseline test files retained: 44 unit, 25 integration, 7 wallet, 6 React                                                                 | Retained; no new silent skips                                                                           |
| Browser distribution         | Both root and native entries bundle for browser; no Node imports or process/Buffer globals required for smoke operations                        | Passed                                                                                                  |
| Browser-like execution       | Bundled root/native reads, real generated-key NEP-413 signing/verification, request interruption in a standards-global VM                       | Passed; four expected mock-transport requests                                                           |
| Live browser execution       | Attempt to open the local harness in the available cloud Chrome                                                                                 | Blocked by `net::ERR_BLOCKED_BY_CLIENT`; not marked passed                                              |
| Package exports              | npm pack dry-run and every JS/declaration export target checked                                                                                 | All 10 subpaths present                                                                                 |
| Real sandbox integration     | Full exact-source GitHub Actions test logs inspected                                                                                            | See exact CI totals below; local nearcore remains blocked by hard nofile limit                          |

The root typecheck now uses declaration-only project builds because TypeScript 7 rejected the previous aggregate `--build --noEmit` combination under correctly isolated workspace resolution. The package typecheck is aligned to its production project. The old package test config already failed with TS6059; it was not a working baseline gate. New generic/requirements claims are checked by real compile-only consumer fixtures, rather than relying on runtime `expectTypeOf` calls in transpiled tests.

## Reproduced findings and repairs

- Native wallet submission originally escaped the transaction's owning fiber through a Promise round-trip. A Deferred-controlled test showed submission after cancellation. Native wallet operations now remain in the caller's fiber.
- NEP-413 verification, and the analogous React native selection, bypassed caller overrides on real Near instances. A valid signed-message test returned false on baseline and true before repair. The central override-aware native edge now preserves application policy.
- Public RPC replacement methods were bypassed, including an inherited wallet finality regression. Raw `call` instrumentation also stopped observing higher-level methods. Matching-method and transitive raw-call dispatch now preserve these contracts without restoring the old class.
- Synchronous key-signing, amount/JSON encoding, decoded numeric/base64 values, block hashes, gas-slot strings, delegate heights, and malformed nonce retry hints initially escaped as Effect defects. Owner-boundary guards now produce recoverable typed failures while preserving Promise error classes. Invalid retry hints do not cause another submission.
- Empty `CreateAccount` payloads had divergent Effect/Zod behavior: arrays and primitives could be accepted and extra fields preserved. The native codec now matches the existing public contract.
- Native snapshot decoding rejected gas-key permissions that baseline snapshots preserved. The corrected schema retains gas-key and future fields.
- Eager constructor key-store initialization, nested error-message formatting, and the runtime minimum were checked and preserved or explicitly aligned. Node 22.19 is the checked minimum.
- Debug JSON encoding initially changed a public NetworkError into TypeError and bypassed legacy retries. The final regression verifies the error shape, bounded encoding attempts, and zero transport calls.

The acceptance probes were demonstrated failing before their repairs. Earlier migration-lane fixes for stale nonce reads, HTTP body release, callback receivers, resource-store overrides, and stop/restart ownership were also reviewed and retained.

## Test-audit retention rationale

This was a compatibility/acceptance audit, not a deletion campaign. Retained tests protect independent contracts:

- Fixed pre-migration byte/hash commitments catch joint encoder/decoder drift; expected values are not computed by the migrated encoder.
- Transport-level JSON, headers, retry timing, aliases, and error identity are protocol/public API contracts. Their call-shape assertions are intentional.
- Deferred/TestClock tests exercise cancellation, invalidation, and ordering without arbitrary sleeps. Real subprocess fixtures verify process death and filesystem cleanup; the fixture does not implement the SDK's cleanup behavior.
- Filesystem malformed-data tests and keyring permission fakes exercise distinct persistence/FFI failure boundaries. They do not pretend to validate a real OS keyring.
- React lifecycle tests assert resource finalization and visible state ownership; their failure on the previous hook implementation was demonstrated.
- Declaration/consumer fixtures now provide actual static checks for Promise shapes, native requirements/errors, layer dependencies, delegate payloads, wait-level narrowing, contract options, and tuple inference.
- Former private RpcClient/NonceManager tests were ported to their native owner or real transport boundary. Obsolete production wrappers were not retained solely to make tests pass.

No baseline test file was removed. Against baseline, production source changed by +6,981/-3,889 lines and tests/type fixtures by +3,065/-398 lines. These totals include formatting and are descriptive, not a quality score.

## Measured costs and method

The comparison uses the same Node runtime, compiler, common installed dependency versions, and synthetic work on both trees. It measures fresh-process module import, 2,000 sequential Promise views through a real Response/JSON mock boundary after 100 warmups, 2,000 fresh client constructions, and 200 explicit-nonce Ed25519 signing operations after 20 warmups. The read value, request count, and captured transaction hash are checked. Baseline and candidate fresh processes alternate order.

These are local no-network microbenchmarks in a shared execution environment. They exclude remote RPC latency, chain execution, wallet UI, production load, and cold filesystem-cache guarantees. Construction is an allocation microbenchmark; normal applications should reuse a client. GC and CPU contention affect results, especially signing, so medians and ranges are retained without asserting statistical significance. No performance budget was specified.

Browser sizes use Bun 1.4.2, target browser, minification, complete entrypoint exports, and gzip level 9. Application-specific tree shaking may produce different sizes. Effect is a prerelease dependency and adds meaningful distribution/runtime cost even when the public API is unchanged.

### Final measurements

Seven fresh-process samples per tree, alternating which version runs first. The raw samples are retained in `benchmark-results.json`. Each row below reports median cost per operation and the observed per-operation range, rather than only a percentage:

| Operation                 | Baseline median | Candidate median | Ratio  | Baseline / candidate observed range      |
| ------------------------- | --------------- | ---------------- | ------ | ---------------------------------------- |
| Fresh-process import      | 156.2074 ms     | 351.6792 ms      | 2.25×  | 143.0646–211.5400 / 305.9831–426.6696 ms |
| Promise view              | 0.0473 ms       | 0.2904 ms        | 6.14×  | 0.0404–0.0580 / 0.2641–0.5543 ms         |
| Fresh client construction | 0.0051 ms       | 0.4648 ms        | 90.26× | 0.0039–0.0065 / 0.4416–0.6306 ms         |
| Explicit-nonce signature  | 1.0144 ms       | 1.1381 ms        | 1.12×  | 0.9039–1.7296 / 1.0816–1.2396 ms         |

The largest relative change is construction: about **0.465 ms per new client** versus **0.005 ms**, roughly 90× in this allocation microbenchmark. The Promise read adds about **0.243 ms** of local processing per call; remote network/chain time is excluded. Import adds about **195 ms** per fresh process. Signing medians differ by about **0.124 ms** with overlapping sample ranges; this is not evidence of a statistically established crypto regression.

| Complete browser entry  | Minified bytes | gzip-9 bytes |
| ----------------------- | -------------: | -----------: |
| Baseline root           |        258,032 |       82,046 |
| Candidate root          |        417,507 |      131,292 |
| Candidate native Effect |        422,841 |      132,948 |

The root entry grows by **159,475 minified bytes (61.8%)** and **49,246 gzip bytes (60.0%)**. The native entry is measured independently, not an additional payload to add to the root entry. These costs are meaningful residual tradeoffs for this experiment.

## Limitations and remaining decisions

- Local real nearcore execution was not passed: the environment's hard descriptor limit is 16,384 while nearcore requires 65,535. Successful real-chain tests are CI evidence, separate from local fixture-process tests.
- Live cloud-browser navigation was blocked. Browser bundling and the standards-global VM smoke passed; an actual local browser can run the supplied portable harness. No Chromium/Safari/Firefox compatibility sweep or live wallet-extension interaction was performed.
- React 18.3.1 and 19.2.7 were executed; every React 18 minor release was not tested.
- Native keyring integration was tested with controlled FFI fakes, not personal OS credentials. Windows/macOS runtime behavior was not executed in this Linux environment.
- Generated schema comparisons cover many deterministic cases, including duplicates, but are not exhaustive protocol proof.
- No fuzzing campaign, sustained production-load test, or long-duration memory/leak soak was run.
- The decision to publish a prerelease Effect dependency and accept the measured costs remains separate from this experiment. No merge, release, or deployment occurred during this audit.
