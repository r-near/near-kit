# Broader candidate measurements

This is an independent consumer harness for the immutable `@near-kit/next`
checkpoint. It is not a whole-SDK equivalence or adoption claim. The original
`scripts/bench` harness and every `artifacts/bench` result remain historical.

## Fresh-checkout reproduction

Use the repository's public Git checkout with Node 24.19.0/npm 11.9.0 for the
recorded bootstrap tool versions (other engines are new observations). From
`experiments/near-kit-next`, install the tracked candidate lock and build the
candidate before packing it. No ignored historical artifacts are prerequisites:

```sh
npm ci --ignore-scripts
npm run build
mkdir -p artifacts/repro-package
npm pack --ignore-scripts --pack-destination artifacts/repro-package
sha256sum artifacts/repro-package/near-kit-next-0.0.0-experimental.1.tgz
export BENCH_WORK_DIR="$PWD/artifacts/bench-next-reproduction"
node scripts/bench/next/setup.mjs artifacts/repro-package/near-kit-next-0.0.0-experimental.1.tgz SHA256_FROM_ABOVE
node scripts/bench/next/run.mjs
node scripts/bench/next/audit-bundles.mjs
node scripts/bench/next/check-bundles.mjs
node scripts/bench/next/summarize.mjs
```

The candidate archive hash identifies the artifact actually supplied. A new pack
with changed documentation is not relabelled as the historical measured tarball.
Setup also compares its emitted `dist` and measured examples with the current
build. Use a fresh ignored `BENCH_WORK_DIR`: setup refuses to overwrite checkpoint
provenance, and run names with existing raw data are immutable. All pipeline
commands honor the same environment variable; without it they use
`artifacts/bench-next`.

The exact main baseline is reconstructed automatically by
`bootstrap-baseline.mjs`. The source commit must be present locally. For a shallow
checkout, first fetch the pinned public commit from the repository's authorized
origin (from the repository root):

```sh
git fetch --no-tags --depth=1 origin 86cf14a2a9e0c7d3acaa8e3d40b5fb4c85ef172d
```

The tracked `registry/package.json` and `registry/package-lock.json` are derived
from the measured dependency lock: only root dependencies and package records for
unused `@near-kit/read-experiment` and the generated local `near-kit` were removed.
Every one of the 103 retained registry records, including integrity hashes and
resolved versions, is unchanged. Lifecycle scripts and optional native packages
are disabled during `npm ci`; no new SDK binary is shipped in the repository.
`baseline.json` records the original lock digest, normalized lock/manifest digests,
source commit/archive digest and expected baseline package digest.

Bootstrap runs the original exact `git archive` selection, checks its SHA-256,
emits the unchanged sources using pinned TypeScript 6.0.3 with the original
configuration and `--noCheck --composite false --declaration false
--declarationMap false`, and runs `npm pack --ignore-scripts`. The regenerated
baseline tarball **must** hash to
`1bb7aa1c346720e0b7f5cb918b3e33a9ead4bd1117591b5347c92d210b1466ad`.
It is extracted into standard `node_modules/near-kit` without asking npm to
resolve any ranges again. The normalized registry lock remains unchanged.
The supplied candidate is similarly extracted into `node_modules/@near-kit/next`.
App-only dependencies resolve from the already installed candidate project and
its separately hashed tracked lock. Full baseline SDK typechecking is not claimed.

Bootstrap can also be checked separately, without first installing the candidate
project or having esbuild available:

```sh
node scripts/bench/next/bootstrap-baseline.mjs artifacts/bench-next-bootstrap-proof
```

A prepared baseline can be reused by setup only after its expected artifact,
registry lock/manifest and installed versions are verified; arbitrary existing
`node_modules` trees are refused. `baseline-reconstruction.json` records the
result. The original measurement used the unnormalized lock, including an unused
historical prototype; its raw evidence is unchanged. The fresh bootstrap proves
byte-identical baseline reconstruction and identical retained registry records,
not new performance numbers for that historical run.

No source/package/workflow changes or registry publication are made. Generated
files remain under the chosen ignored artifact directory.

## Consumer and operation boundaries

- Account-only consumers export just a factory for one account read. They use
  public root imports (`import * as Near` for the candidate, named exports for
  the two existing SDKs) and Effect leaf imports. Browser bundles tree-shake
  unused operations. Node module imports are ordinary unbundled imports and
  evaluate each public entrypoint's actual dependency graph.
- Complete same-block snapshot: fetch one final block; perform account,
  access-key list, account code and gas price concurrently at that hash; then
  naturally exhaust three state pages of 100, 100 and 37 binary entries. The
  page size is 100 and each value is 64 bytes. All lanes decode bytes, project
  exact decimal/bigint values, and serialize the same 42,600-byte NDJSON content
  to memory, including header, every state entry and completion record.
- The actual packed Node file-export recipe is also run, separately. Its timed
  operation includes file open, writes, sync, close, exclusive hard-link
  publication, and the harness's subsequent read/validation/removal. This is a
  complete-output observation, not a clean disk-only or RPC-only comparison.
- Packed plain-React and React Query examples are measured as browser consumer
  modules and as complete mountable application entries including ReactDOM.
  Wallet selector creation/modules and authorization are caller-supplied and
  are not part of these entries. Its imports in the examples are type-only.
  The measured wallet workload uses the actual observation/query-options
  recipe with a synchronous selector-shaped local fixture, performs one checked
  account read, checks known network-mismatch suspension and listener cleanup.
  It does not measure actual wallet initialization, browser rendering,
  extension/mobile/hardware compatibility, or authentication.
- Pure `/data` and `/units` exports and the optional `/operator` entry are also
  measured. The pure subpaths have no Effect runtime imports, but installing
  the package still includes its declared Effect dependency.

## Semantic differences are part of the results

- Candidate uses native exact wire JSON, strict protocol/schema projection,
  bounded/strict-UTF8 bodies, correlation and typed errors. State traversal checks
  pinning, byte order and progress. The benchmark does not replace its correctness
  or real-platform acceptance tests.
- Main `86cf14a2a9e0c7d3acaa8e3d40b5fb4c85ef172d` uses `.rpc` public methods,
  existing Zod validators and `maxRetries: 0`. Application code projects balances
  from decimal strings. It does not have equivalent exact u64 wire parsing,
  stream bounds, traversal validation or caller-signal cancellation.
- `near-api-js@7.3.1` uses `JsonRpcProvider`, with `retries: 1` meaning one total
  attempt, verified by request counts. Its named key-list read accepts finality
  only, and its named state read has no page cursor/limit. The snapshot adapter
  therefore uses the **public generic `query` read API** for those two operations;
  application code supplies pinning and pagination. Other reads use named public
  methods. This is not equivalent named-operation coverage or validation.
- `fetch-minimal` uses `response.json` and simple HTTP/RPC error handling plus
  application projection. `fetch-bounded` additionally implements a 2 MiB body
  bound, strict UTF8, envelope shape/correlation and body cancellation. Neither
  is a full reference implementation of the candidate: protocol schemas, exact
  raw-u64 parsing, input/range/permission/progress validation and typed errors
  are not equivalent. Both use the same application serialization/projections. Their shared transport
  factory retains both conditional branches in esbuild, so their bundled sizes
  coincide; they are not hand-optimized minimum-size fetch implementations.
- Every timed fixture u64 number is in JavaScript's exact represented range;
  u128 and timestamp decimal strings exercise large exact quantities. Projecting
  a rounded legacy number to bigint cannot repair it. Do not infer equivalence
  beyond this dataset or treat weaker validation as a general speedup.
- No key generation, signing, transactions, state initialization, external RPC,
  Docker, browser launch, or previously blocked probe occurs. A single loopback
  HTTP fixture rejects unsupported methods and checks account IDs, finality/hash
  selectors, state prefix, limit, cursors and exact method/request counts.

## Sampling and attribution

Defaults are 15 fresh-process imports for each entry, seven independently
shuffled process rounds per workload, five warmups and 25 retained samples per
round. Shuffle seed is 20261001. Imports exclude process startup; their `wallMs`
includes it. These are process-cold/filesystem-warm observations, not reboot-cold
or browser load times. Workload samples include assertions and use one reused
client per process; no latency-adjusted subtraction is performed. Memory and CPU
are process-wide observations, not exact allocation attribution. Loopback results
are not mainnet/UI performance claims.

Failures use the same HTTP 503 response and one request per sample. Cancellation
is observed after headers while the body remains unfinished. SDK lanes without
caller AbortSignal inputs are explicitly unsupported; no timeout or abandoned
Promise is presented as transport cancellation.

Browser bundles use esbuild 0.28.2, ES2022/ESM, production React, tree shaking,
minification, gzip level 9 and Brotli quality 11. Unminified/minified/compressed
sizes, exact entry sources and metafiles are retained. The Node file-export bundle
is separately labelled and leaves Node built-ins external. Browser `near-api-js`
uses the actual Browserify `util@0.12.5` package required by its dependency graph;
it is not stubbed or externalized. Node uses its built-in `util`.

Both Effect root-barrel and leaf-import existing-app baselines are measured, with
and without Schema. Marginal costs are the actual combined compressed bundle
minus that existing app's compressed bundle. They cannot be obtained by adding
separately compressed files. Metafile `bytesInOutput` attribution is uncompressed
emitted contribution, not separable gzip allocation. React-only and React Query
existing-app deltas similarly use actual combined bundles; the artificial existing
apps define the scope of each delta.

The default final run is `runs/final`; each run retains its own consumer, example,
harness and bundle sources. Reusing a recorded run name is refused.

`runs/<name>/raw.json` contains samples, environment, counts, semantics and source
provenance. `summary.json` and `summary.md` present distributions, not invented
speedups. `BENCH_RUN_NAME` can retain a separate smoke or diagnostic run; smaller
sample settings must remain labelled. Historical first-checkpoint numbers cannot
be presented as measurements of this broader candidate.

The retained bundle audit explicitly aliases both mount exports in combined React
app consumers, and measures the file-export callable without re-exporting the
harness’s entire Effect namespace. Those three audited records supersede initial
bundle entries; raw runtime measurements are never rewritten.

`check-bundles` executes all ten browser-targeted account/snapshot bundles in
Node against the same fixture and exercises the audited actual Node file exporter.
That detects packaging errors without launching a browser; it is not browser
engine or wallet acceptance. The current runner also incorporates the audited
entry corrections so future runs preserve both mount functions from the start.
