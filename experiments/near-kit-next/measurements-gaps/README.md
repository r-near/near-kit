# Added workflow costs: packed checkpoint 26ac716

## Findings

- Optional crypto remains isolated from the read root, `/data` and `/units`: each matched old/new consumer has the same normalized graph and byte-identical minified output, gzip and Brotli. No `@noble`, address or NEP-413 module is reachable from those three entrypoints. `/data` and `/units` have no Effect input or emitted runtime contribution.
- This is optional import cost, not optional installation. The packed candidate plus declared runtime package files total 52,136,532 bytes, compared with 49,803,111 bytes for the prior checkpoint: **+2,333,421 bytes**. The added curves and hashes packages account for 2,281,856 bytes; the candidate itself adds 51,565 bytes of shipped code, declarations, examples and documentation.
- `/address` is 4,519 gzip bytes, `/nep413` is 24,315 gzip bytes, and the complete receipt Node bundle is 69,718 gzip bytes. The verifier bundles both supported scheme branches; an application choosing only Ed25519 at runtime does not remove the secp256k1 branch.
- The actual shipped SSR hydration helper, component and SDK total 114,911 gzip bytes with React/ReactDOM/Query included. The matched application reference is 70,624 bytes. These are actual complete bundles; the measured difference is 44,287 bytes. The reference uses the same client helper and rendered UI but has weaker transport/DTO validation.
- Workload medians are observations on a shared host, not speed claims: the full SSR workflow is 1.966 ms versus 0.689 ms for the weaker reference; the complete Ed25519 receipt is 12.081 ms. No latency subtraction, extrapolation from the pure verifier, mainnet claim, or browser-hydration timing is made.

## Immutable evidence

- Candidate archive SHA-256: `14a06e61a4aa3b3ad05e10cd427d8a720af1087aaaf1f43ee710134fd5d5ec8b`
- Archive: `artifacts/bench-gaps/final/candidate.tgz` (52,867 bytes)
- Raw samples: `artifacts/bench-gaps/final/raw.json`
- Raw SHA-256: `0ad5d34b91a3bfbd4bc6570c78f8829911677366fb1eff7e7112150731558cca`
- Summary: `artifacts/bench-gaps/final/summary.json`
- Harness: `experiments/near-kit-next/scripts/bench/gaps.mjs`, SHA-256 `fa2236bca0b37c8ab210a67da8526020af0c2674ddf06f73d4aeee6f5a186c70`; the exact measured copy is `final/harness.mjs`
- Harness commit: `577406b` (`Measure packed address auth and SSR workflow costs`)
- Checkout HEAD at capture: `26ac71621642302f77bcf1587280f8b6f9d550f1`. `raw.json` also records the working-tree status, source file hashes, lock hash and every packed file hash; those distinguish the already-ready SSR helper edits from the HEAD label
- All 53 current `dist/` and `examples/` members matched the archive in both directions before measurement. `postrun-equality.json` verifies they still matched afterward and that the harness hash was unchanged
- Prior immutable package SHA-256: `c1734db3169cc54c695597d02553e6a09e56be1d54d43d61b568e538c89eaf69`, recorded source checkpoint `842b46352b222b1f68be6f8bb5c51b83d1399340`. Its previously recorded emitted-file hashes were verified before use
- Runtime: v24.19.0; Intel(R) Xeon(R) Platinum 8370C CPU @ 2.80GHz; esbuild 0.28.2. Measured 2026-10-01T04:52:09.371Z to 2026-10-01T04:53:40.182Z

## Bundle sizes

All values are bytes. Browser bundles are production ESM targeting ES2022. The server and receipt rows target Node, retain builtin imports, and include a small `createRequire` compatibility banner needed by the actual bundled ReactDOM server dependency. Gzip uses level 9; Brotli quality 11. Plain output includes esbuild path comments, so unchanged-runtime byte equality is asserted for minified/compressed output, not path-labelled plain output.

| Consumer | Platform | Plain | Minified | gzip | Brotli |
| --- | --- | ---: | ---: | ---: | ---: |
| Root account consumer | browser | 295,566 | 132,919 | 44,116 | 39,359 |
| /data | browser | 8,129 | 4,611 | 1,797 | 1,606 |
| /units | browser | 1,816 | 1,056 | 516 | 436 |
| /address | browser | 20,942 | 11,566 | 4,519 | 4,092 |
| SSR candidate component | browser | 362,823 | 156,450 | 52,033 | 46,341 |
| SSR reference component | browser | 65,312 | 22,830 | 8,029 | 7,252 |
| SSR candidate server | node | 968,851 | 382,410 | 119,268 | 85,257 |
| SSR reference server | node | 668,513 | 248,013 | 74,817 | 46,091 |
| SSR candidate hydration entry | browser | 996,919 | 362,242 | 114,911 | 100,368 |
| SSR reference hydration entry | browser | 698,094 | 228,264 | 70,624 | 61,319 |
| /nep413 (both supported schemes) | browser | 127,736 | 63,921 | 24,315 | 21,177 |
| Complete receipt application | node | 432,579 | 201,987 | 69,718 | 61,265 |

The root-read wrapper here is slightly different from the historical account harness. The comparison rebuilds the exact same new wrapper against both old and new packages; do not subtract the earlier report’s account row from this one.

| Matched old/new consumer | Same graph | Same minified SHA | Minified delta | gzip delta | Brotli delta |
| --- | --- | --- | ---: | ---: | ---: |
| Root account consumer | True | True | 0 | 0 | 0 |
| /data | True | True | 0 | 0 | 0 |
| /units | True | True | 0 | 0 | 0 |

SSR application differences below subtract measured complete bundles containing the same React/Query application job. They are not sums or subtractions of separately compressed dependency files.

| Candidate minus matching reference | Plain delta | Minified delta | gzip delta | Brotli delta |
| --- | ---: | ---: | ---: | ---: |
| component | 297,511 | 133,620 | 44,004 | 39,089 |
| hydrate | 298,825 | 133,978 | 44,287 | 39,049 |
| server | 300,338 | 134,397 | 44,451 | 39,166 |

Minified emitted attribution is retained per bundle and is not additive gzip ownership. The hydration entry includes 117,861 emitted Effect bytes; the pure verifier includes 55,234 emitted Noble bytes and no Effect. Dependency module graphs can contain third-party signing-capable objects; near-kit exposes only the requested public verifier and this harness never calls signing.

## Fresh-process imports

15 fresh Node processes per entry, shuffled each round. Module import time excludes process startup; wall time includes startup and the probe. These are filesystem-warm/process-cold observations. They do not time browser load, hydration or a reboot-cold machine. Every import records the resolved packed package path.

| Entry | Median ms | p10–p90 ms | Min–max ms | Wall median ms | RSS median MiB |
| --- | ---: | --- | --- | ---: | ---: |
| Root account consumer | 211.868 | 189.704–283.632 | 185.140–321.360 | 304.286 | 67.93 |
| /data | 6.729 | 5.046–19.827 | 4.968–25.890 | 98.332 | 38.07 |
| /units | 3.296 | 2.374–7.154 | 2.270–8.112 | 134.994 | 37.87 |
| /address | 14.313 | 10.019–25.016 | 9.616–31.748 | 117.085 | 38.75 |
| SSR candidate component | 263.576 | 219.031–790.999 | 209.381–2175.504 | 348.330 | 72.18 |
| SSR reference component | 58.645 | 45.166–125.522 | 42.122–346.035 | 179.936 | 45.91 |
| SSR candidate server | 321.539 | 253.659–633.948 | 240.867–638.067 | 414.437 | 74.13 |
| SSR reference server | 61.964 | 50.165–118.838 | 49.006–137.660 | 162.416 | 46.68 |
| SSR candidate hydration entry | 300.052 | 260.320–632.834 | 247.956–689.152 | 394.111 | 75.52 |
| SSR reference hydration entry | 64.422 | 59.977–112.795 | 57.841–256.007 | 165.030 | 49.05 |
| /nep413 (both supported schemes) | 43.022 | 32.935–66.389 | 30.824–152.768 | 135.548 | 45.75 |
| Complete receipt application | 258.487 | 230.718–379.403 | 214.942–782.284 | 349.216 | 72.59 |

## Fixed complete workloads

7 independently shuffled process rounds per workload, 5 warmups and 25 retained samples per round: 175 observations each. The sample includes all outcome assertions. No sample is discarded, no outlier is clipped, and no adjusted timing is substituted. CPU/memory observations and every sample are retained in raw data.

| Workload | n | Median ms | p10–p90 ms | p95 ms | Min–max ms | Round median range ms |
| --- | ---: | ---: | --- | ---: | --- | --- |
| Six-vector address batch | 175 | 0.327 | 0.177–1.125 | 1.815 | 0.118–6.340 | 0.224–0.540 |
| SSR candidate server | 175 | 1.966 | 1.494–4.011 | 5.705 | 1.297–10.423 | 1.632–4.781 |
| SSR reference server | 175 | 0.689 | 0.432–1.496 | 2.251 | 0.359–4.988 | 0.578–0.834 |
| One fixed Ed25519 proof | 175 | 2.565 | 2.038–6.045 | 7.160 | 1.804–11.256 | 2.240–6.268 |
| One fixed secp256k1 proof | 175 | 2.339 | 1.868–4.137 | 5.348 | 1.764–7.414 | 2.029–4.946 |
| Complete receipt application | 175 | 12.081 | 10.275–15.988 | 17.233 | 8.201–32.672 | 10.482–13.047 |

- Address samples calculate all six independent public Borsh/Keccak address vectors and check each expected address. The batch is not divided by six to invent a per-address measurement.
- Each pure verification sample consumes one ready fixed public proof, checks the exact trusted payload and asserts `true`. The Ed25519 and secp256k1 samples use separate fixture records. No fixture generator, key-generation or signing function is run.
- Each SSR sample invokes the real packed Fetch route, reads and renders one fixed account response, consumes the complete HTML Response, parses and validates the DTO, creates a fresh QueryClient/QueryObserver from initial data with no extra initial read, explicitly refreshes once, checks exact bigint/hash identity and cleans up. Each lane performs exactly two mocked RPC reads per sample; 350 retained reads per lane.
- Both SSR lanes produce 966-byte documents. A supplemental complete execution in `normalized-html.json` proves identical full HTML after replacing only the random document UUID: SHA-256 `13451cbb13d97796af8f0cbd8992c7ccaf66adec723df65ed19420d83612a161`. The reference preserves application rendering/cache options but lacks the candidate’s full RPC/schema/body validation and raw-u64 parser. This dataset intentionally uses block height 123, representable in both lanes, and the max-u128 balance as a decimal string. It cannot establish unsafe-u64 equivalence.
- Each receipt sample starts a fresh actual loopback HTTP server from the packed application example, obtains the fixed application challenge, sends its disposable fixed Ed25519 proof, checks one mocked FullAccess key read, fetches the newly created `/me` session, rejects replay with 401 without another key read, and closes the server. Server setup/teardown, four HTTP exchanges, JSON/body checks and assertions are all included. There are 175 retained successful receipts and 175 retained mocked key reads. The application clock/nonce/token/source seams supply only published test fixtures.
- The in-memory RPC responses avoid external networks. The receipt server listens only on ephemeral loopback. No wallet, production key, transaction, chain write, reconciliation or real account authentication occurs. Browser bundle construction is measured; browser rendering and actual hydration execution remain separate platform acceptance work.

## Installed package cost

Actual regular file sizes, including published source/maps/docs; not disk blocks or compressed transfer sizes. Existing installed pins are reused without reinstalling broader SDK baselines. Direct runtime packages are deduplicated, so curves’ hashes dependency is counted once.

| Package | Version | Files | File bytes |
| --- | --- | ---: | ---: |
| @near-kit/next | 0.0.0-experimental.1 | 59 | 193,719 |
| @noble/curves | 2.4.0 | 72 | 1,590,210 |
| @noble/hashes | 2.4.0 | 60 | 691,646 |
| @scure/base | 2.2.0 | 8 | 166,984 |
| effect | 4.0.0-rc.118 | 2561 | 49,493,973 |
| Total candidate + declared runtime packages | | | **52,136,532** |
| Prior candidate + declared runtime packages | | | **49,803,111** |
| Difference | | | **+2,333,421** |

The application-level SSR dependencies below are the same in both lanes and are not newly introduced SDK runtime dependencies. They total 12,498,325 published file bytes, with query-core and scheduler counted once.

| SSR application package | Version | Files | File bytes |
| --- | --- | ---: | ---: |
| react | 19.2.7 | 27 | 171,604 |
| react-dom | 19.2.7 | 43 | 7,319,413 |
| @tanstack/react-query | 5.104.0 | 410 | 1,731,043 |
| @tanstack/query-core | 5.104.0 | 365 | 3,193,600 |
| scheduler | 0.27.0 | 15 | 82,665 |

## Validation and reproduction

Node syntax and repository Biome checks passed for the new harness. Before sampling it executes each of the six workloads once from its unbundled packed consumer and once from its minified bundle: 12 successful checks. It then records 180 fresh import samples and 1,050 retained workload samples. The runtime package is extracted under a separate consumer package scope, and both Node resolution and esbuild input paths are asserted to target that package. Historical SDK files are copied read-only into their own consumer scope while sharing the same installed dependency tree, preventing duplicate Effect instances.

From `experiments/near-kit-next`, with the project’s pinned dependencies and verified historical `artifacts/bench-next` checkpoint available:

```sh
node scripts/bench/gaps.mjs artifacts/bench-gaps/checkpoint-26ac716/near-kit-next-0.0.0-experimental.1.tgz 14a06e61a4aa3b3ad05e10cd427d8a720af1087aaaf1f43ee710134fd5d5ec8b unique-run-name
```

The run name must be new. For a new artifact, build and pack after the source/dependency acceptance gate, pass its actual SHA, and keep it distinct from this checkpoint. The script refuses mismatched current dist/example members. This harness reuses the historical package/provenance locally; rebuilding that checkpoint from a fresh checkout is described by the existing `scripts/bench/next/README.md` infrastructure. Sample-count environment overrides are diagnostics, not the recorded full pass.

Two earlier diagnostic directories are explicitly excluded: `smoke` lacked an independent consumer package boundary, and `smoke-packed` used a historical symlink that duplicated Effect. They retain their original raw results plus `INVALID-FOR-CONCLUSIONS.txt`; nothing from them is used in this report. The final run corrects and asserts both boundaries. Final raw samples are immutable; normalized-HTML and postrun-equality checks are separate sidecar evidence.


## Rebuild the historical input without retained artifacts

The exact historical archive was independently reconstructed from Git with the current pinned TypeScript 7.0.2 compiler and existing pinned dependencies; it reproduced SHA256 `c1734db3169cc54c695597d02553e6a09e56be1d54d43d61b568e538c89eaf69`. No additional SDK/dependency installation is needed. From this package directory after npm ci, use a fresh path:

```sh
mkdir -p artifacts/gap-reproduction/source artifacts/gap-reproduction/packed artifacts/gap-reproduction/previous
git -C ../.. archive 842b46352b222b1f68be6f8bb5c51b83d1399340 experiments/near-kit-next | tar -x -C artifacts/gap-reproduction/source --strip-components=2
node node_modules/typescript/bin/tsc -p artifacts/gap-reproduction/source/tsconfig.json
npm pack ./artifacts/gap-reproduction/source --ignore-scripts --pack-destination "$PWD/artifacts/gap-reproduction/packed"
sha256sum artifacts/gap-reproduction/packed/near-kit-next-0.0.0-experimental.1.tgz
tar -xzf artifacts/gap-reproduction/packed/near-kit-next-0.0.0-experimental.1.tgz -C artifacts/gap-reproduction/previous --strip-components=1
```

Compare that digest with the one above. The baseline provenance is tracked as `measurements-next/provenance.json.gz`; the harness currently reads its materialized form at `artifacts/bench-next/provenance.json`. In a fresh checkout, create that directory and decompress the tracked file there. If the file already exists, verify it matches instead of replacing retained evidence. Then set `BENCH_GAPS_PREVIOUS="$PWD/artifacts/gap-reproduction/previous"` for the existing measurement command. The harness verifies every historical dist member against that provenance and every current dist/example member against the newly supplied candidate archive. Keep each run name unique. A shallow checkout must first fetch the exact public source commit from the authorized repository origin.
