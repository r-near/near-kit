# Read-only comparison

This is a measurement harness, not production client code or a full SDK comparison.
It never submits transactions, reads keys, uses real accounts/secrets, or calls an external RPC.

From `experiments/read-client`:

1. `node scripts/bench/setup.mjs /absolute/path/to/prototype.tgz`
2. `node scripts/bench/run.mjs`
3. `node scripts/bench/summarize.mjs`, then inspect `artifacts/bench/provenance.json`, `raw.json`,
   `summary.json`, retained consumer sources and bundle metafiles

Setup downloads exact official registry packages with lifecycle scripts disabled. All generated
files/cache stay in ignored `artifacts/bench`. It extracts main commit
`86cf14a2a9e0c7d3acaa8e3d40b5fb4c85ef172d` without touching another checkout or its patch.
The baseline's original TypeScript 6.0.3/target/module options emit unchanged sources with
`--noCheck`; this runtime measurement does not claim the full baseline SDK was typechecked.
Direct runtime dependencies are selected from its lockfile; the resulting complete npm lock
is retained and hashed. The supplied prototype is installed from its tarball, whose hash is recorded.

## Lanes and semantic differences

- **Prototype:** packed `@near-kit/read-experiment`, Effect 4.0.0-rc.118, default fetch layer,
  mandatory view-result schema, bounded response stream, strict UTF-8/envelope/represented-number checks
- **Exact main:** `Near.rpc.getAccount` and `viewFunction`, built-in retries disabled with
  `maxRetries: 0`; application bigint projection avoids the rounded `Near.getAccount` convenience
  result. Existing Zod response checks do not enforce the same complete wire contract/body bounds
- **near-api-js 7.3.1:** public `JsonRpcProvider.viewAccount` and `callFunctionRaw`;
  `retries: 1` means one total attempt in this version, verified by observed requests.
  Account quantities are bigint; application code validates the JSON view's `{count:number}`
- **Minimal fetch:** response.json, basic HTTP/RPC-error handling, bigint projection and the
  same application view check. No byte bound, strict UTF-8, envelope correlation, canonical/range
  validation or byte-element validation. Its small cost is not equivalent validation
- **Validated fetch reference:** manually checks the measured envelope/body/account/byte/view
  boundaries, including 2 MiB wire-body bound and strict UTF-8. This remains a benchmark reference:
  it lacks the prototype's general input/configuration validation, full typed error model, schema
  services and Effect composition. It is not asserted to implement the whole library contract

All measured successful reads return checked exact quantities/provenance or checked contract JSON.
All single reads explicitly request `final`; the four-read workflow uses one explicit block hash
and concurrency four. The same loopback fixture checks methods, arguments, selectors and counts.
`retry3` is exactly three immediate application-level calls against HTTP 503, not a hidden SDK retry.
Failure cases compare costs for expected rejection; error categories/diagnostics are not equivalent.

Cancellation is measured after response headers with an unfinished body, using a stable Fetch hook
and a caller AbortSignal. The baseline and near-api-js selected public APIs have no signal input;
they are marked unsupported rather than wrapped in a timeout that only abandons a Promise.
The prototype recipe checks an already-aborted signal before entering Effect's pinned runner.

## Sampling and bundles

Defaults: 15 fresh-process imports per lane; seven randomly ordered process rounds per lane,
five warmups and 25 recorded samples per workload/round. Shuffle seed, raw durations, Node/CPU/OS,
memory/CPU readings and server counts are retained. Import time excludes process startup; wall
duration includes it. These are process-cold imports with OS/filesystem cache warm, not reboot-cold.
Loopback latency is noisy and is not mainnet performance or evidence of end-to-end user speedups.

Browser consumers use identical esbuild 0.28.2 options, ES2022/ESM, tree-shaking, minification,
gzip level 9 and Brotli quality 11. Uncompressed, minified and compressed lengths are retained.
Consumers use the same small measurement factory and therefore include its application glue;
the precise entry files and metafiles are part of the evidence. Separate existing-Effect and
existing-Effect+Schema consumers support *incremental combined-bundle differences*, not estimates
obtained by summing independently compressed files.
Both barrel-import and leaf-import versions of those existing applications are measured.
The final prototype consumer uses leaf imports, matching its revised runnable examples;
the historical first run and separate root/leaf diagnostic retain the original barrel usage.

The first unmodified near-api-js root import failed browser bundling on Node's `util`, reached
through is-my-json-valid/generate-function. Its labelled browser lane includes the actual
Browserify `util@0.12.5` polyfill package and its dependencies; nothing is stubbed or externalized.
The Node lane continues using Node's built-in util. The original failure log is retained.

A separate non-network stream observation feeds the identical ~256 KiB JSON envelope as one-byte
or 16 KiB chunks, in fresh processes. It reports time, process maxRSS and before/after memory.
Chunking is controlled here because TCP may coalesce writes in the HTTP fixture. These figures
include import/runtime overhead and are not exact allocation attribution. A wire-byte limit is
not a total-memory cap; chunk objects and downstream decoding can amplify allocation.

No benchmark result substitutes for independent correctness, real-node, browser, or exact-head CI
acceptance. Raw samples and semantic differences must accompany any comparative conclusion.
