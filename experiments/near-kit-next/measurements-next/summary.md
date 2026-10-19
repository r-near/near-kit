# Broader candidate measurement report

Immutable candidate SHA-256: `c1734db3169cc54c695597d02553e6a09e56be1d54d43d61b568e538c89eaf69`.
Tracked checkpoint: `842b46352b222b1f68be6f8bb5c51b83d1399340`; baseline: `86cf14a2a9e0c7d3acaa8e3d40b5fb4c85ef172d`.
Node v24.19.0; Intel(R) Xeon(R) Platinum 8370C CPU @ 2.80GHz; esbuild 0.28.2. Completed 2026-10-01T02:08:51.522Z.
Raw data SHA-256: `cb0aa85036dc862a281f8b2e686b9caff94b2649a11b94b8c984afd4e9e7d5b0`; relative raw path: `runs/final/raw.json`.

## Scope and limits

Bundle audit: combined mountable-app entries explicitly preserve both mount exports; the Node file-export bundle exposes only its callable factory. The retained audited-bundles/results.json supersedes those three initial bundler entries without changing runtime samples.

Account-only, complete same-block state export, actual file export, packed wallet/application recipes, pure subpaths and Effect import styles are separate consumers. Source/bundle hashes, all raw samples, request counts and method/selector/cursor checks are retained. This is filesystem-warm/process-cold local measurement, not mainnet or browser UI timing. See scripts/bench/next/README.md for reproduction and semantic differences.
Main and near-api-js do not offer the same raw-u64 precision, body/validation guarantees or caller cancellation. This safe-u64 dataset does not test out-of-range equivalence. near-api-js uses public generic query for pinned key-list and cursor-based state reads. Its browser bundle includes the actual util 0.12.5 polyfill. Direct fetch variants are weaker application references; even bounded fetch lacks full protocol validation and exact numeric-token parsing. The two fetch references share a transport factory; esbuild retains its conditional bounded/minimal branches, so their bundles are the same size. They are reproducible reference adapters, not hand-optimized minimum-size fetch implementations. No speedup or SDK-completion conclusion follows from these numbers.

## Process-cold imports, milliseconds

Each has 15 fresh-process samples. Import excludes startup; wall includes it. Node module evaluation, warm filesystem caches.

| Entry | Median | p10–p90 | Min–max | Wall median | RSS median MiB |
| --- | --- | --- | --- | --- | --- |
| candidate-wallet-react-app | 243.19 | 212.22–322.41 | 202.79–673.22 | 381.62 | 75.89 |
| fetch-minimal-account | 1.97 | 1.47–4.41 | 1.34–5.84 | 142.84 | 41.60 |
| candidate-wallet-react | 224.63 | 205.32–296.31 | 204.16–374.01 | 369.03 | 72.07 |
| candidate-account | 213.46 | 202.87–407.18 | 177.85–501.66 | 363.82 | 69.62 |
| fetch-bounded-account | 1.58 | 1.33–2.00 | 1.29–2.45 | 150.84 | 41.60 |
| effect-leaf | 86.03 | 74.30–106.22 | 72.21–206.26 | 238.66 | 53.37 |
| candidate-operator | 207.67 | 187.41–282.62 | 182.69–304.01 | 363.23 | 68.90 |
| fetch-minimal-snapshot | 5.50 | 4.36–12.64 | 4.25–26.86 | 151.34 | 42.10 |
| baseline-snapshot | 160.27 | 145.98–347.71 | 136.48–391.98 | 321.29 | 63.20 |
| candidate-wallet-query-app | 281.38 | 255.51–295.22 | 250.51–385.41 | 425.08 | 76.51 |
| effect-schema-barrel | 295.13 | 267.00–413.88 | 259.10–482.28 | 431.78 | 75.83 |
| react-query-existing | 41.45 | 36.91–69.40 | 34.38–74.21 | 181.08 | 47.07 |
| candidate-snapshot | 224.43 | 186.79–262.46 | 183.69–325.82 | 378.40 | 69.48 |
| react-existing | 4.68 | 4.17–8.94 | 3.89–10.69 | 147.00 | 42.38 |
| candidate-file-export | 224.00 | 203.33–259.78 | 194.65–513.15 | 373.82 | 70.09 |
| near-api-snapshot | 64.69 | 55.37–110.20 | 55.08–141.92 | 200.54 | 49.41 |
| candidate-units | 3.02 | 2.49–3.82 | 2.31–11.67 | 149.36 | 42.07 |
| near-api-account | 62.14 | 53.20–87.99 | 51.88–120.07 | 207.65 | 49.15 |
| fetch-bounded-snapshot | 4.77 | 4.44–8.52 | 4.28–9.33 | 151.10 | 42.10 |
| baseline-account | 154.72 | 145.22–211.02 | 137.09–445.86 | 299.81 | 63.14 |
| candidate-data | 7.39 | 5.35–10.71 | 5.20–13.71 | 153.79 | 42.30 |
| effect-schema-leaf | 158.39 | 140.63–189.56 | 125.76–317.41 | 308.35 | 61.63 |
| effect-barrel | 301.75 | 251.51–443.75 | 244.32–529.55 | 465.46 | 76.05 |
| candidate-wallet-query | 260.12 | 235.10–305.35 | 206.93–335.63 | 428.03 | 74.05 |

## Browser/Node consumer bundles, bytes

Browser production ESM unless the entry says node. Component-only wallet entries exclude ReactDOM; app entries include it. Wallet modules/selector creation are caller supplied and not included. File-export Node built-ins are external. Attribution is minified emitted code before compression, not additive gzip ownership.

| Entry | Platform | Minified | gzip | Brotli | Effect emitted bytes |
| --- | --- | --- | --- | --- | --- |
| effect-leaf | browser | 24342 | 8627 | 7928 | 24287 |
| effect-barrel | browser | 85080 | 29658 | 26731 | 84913 |
| effect-schema-leaf | browser | 73223 | 24469 | 22070 | 73150 |
| effect-schema-barrel | browser | 291742 | 91321 | 79694 | 291531 |
| react-existing | browser | 8267 | 3198 | 2868 | 0 |
| react-query-existing | browser | 41793 | 12953 | 11736 | 0 |
| react-app-existing | browser | 192228 | 60028 | 51717 | 0 |
| react-query-app-existing | browser | 225633 | 69621 | 60414 | 0 |
| candidate-data | browser | 4611 | 1797 | 1606 | 0 |
| candidate-units | browser | 1056 | 516 | 436 | 0 |
| candidate-operator | browser | 131933 | 43784 | 39109 | 117428 |
| candidate-wallet-react | browser | 145945 | 48717 | 43415 | 118053 |
| candidate-wallet-query | browser | 158536 | 52739 | 47002 | 118070 |
| candidate-wallet-react-app | browser | 330332 | 105813 | 92330 | 118278 |
| candidate-wallet-query-app | browser | 363756 | 115484 | 100915 | 118299 |
| candidate-account | browser | 132972 | 44145 | 39409 | 117602 |
| candidate-snapshot | browser | 146926 | 48183 | 43008 | 119534 |
| baseline-account | browser | 482908 | 115238 | 96813 | 0 |
| baseline-snapshot | browser | 484867 | 115894 | 97340 | 0 |
| near-api-account | browser | 202380 | 65215 | 55940 | 0 |
| near-api-snapshot | browser | 204458 | 65929 | 56624 | 0 |
| fetch-minimal-account | browser | 1422 | 841 | 724 | 0 |
| fetch-minimal-snapshot | browser | 8068 | 3409 | 3047 | 0 |
| fetch-bounded-account | browser | 1422 | 841 | 723 | 0 |
| fetch-bounded-snapshot | browser | 8068 | 3412 | 3049 | 0 |
| candidate-file-export-node | node | 150868 | 49650 | 44292 | 121942 |

## Marginal combined-bundle costs, bytes

Each delta subtracts the exact existing application bundle from the actual combined bundle. Existing-app examples define the scope; this is not a universal cost for every app with Effect or React installed.

| Consumer | Existing app | Minified delta | gzip delta | Brotli delta |
| --- | --- | --- | --- | --- |
| candidate-account | effect-leaf | 108675 | 35551 | 31454 |
| candidate-account | effect-barrel | 81541 | 26625 | 23169 |
| candidate-account | effect-schema-leaf | 59811 | 19733 | 17353 |
| candidate-account | effect-schema-barrel | 30774 | 10446 | 8857 |
| candidate-snapshot | effect-leaf | 122629 | 39575 | 35128 |
| candidate-snapshot | effect-barrel | 94541 | 30317 | 26440 |
| candidate-snapshot | effect-schema-leaf | 73765 | 23739 | 21004 |
| candidate-snapshot | effect-schema-barrel | 43141 | 13968 | 11918 |
| baseline-account | effect-leaf | 483247 | 115144 | 96306 |
| baseline-account | effect-barrel | 483671 | 115332 | 96278 |
| baseline-account | effect-schema-leaf | 483321 | 115134 | 96067 |
| baseline-account | effect-schema-barrel | 484714 | 115642 | 95403 |
| baseline-snapshot | effect-leaf | 485206 | 115817 | 96991 |
| baseline-snapshot | effect-barrel | 485630 | 115994 | 96835 |
| baseline-snapshot | effect-schema-leaf | 485280 | 115801 | 96702 |
| baseline-snapshot | effect-schema-barrel | 486685 | 116287 | 95981 |
| near-api-account | effect-leaf | 202723 | 65200 | 55509 |
| near-api-account | effect-barrel | 203141 | 65441 | 55660 |
| near-api-account | effect-schema-leaf | 202785 | 65234 | 55457 |
| near-api-account | effect-schema-barrel | 203544 | 65469 | 55157 |
| near-api-snapshot | effect-leaf | 204805 | 65879 | 56167 |
| near-api-snapshot | effect-barrel | 205223 | 66154 | 56244 |
| near-api-snapshot | effect-schema-leaf | 204867 | 65924 | 56090 |
| near-api-snapshot | effect-schema-barrel | 205638 | 66210 | 55777 |
| fetch-minimal-account | effect-leaf | 1431 | 702 | 582 |
| fetch-minimal-account | effect-barrel | 1436 | 731 | 621 |
| fetch-minimal-account | effect-schema-leaf | 1423 | 681 | 586 |
| fetch-minimal-account | effect-schema-barrel | 1423 | 716 | 584 |
| fetch-minimal-snapshot | effect-leaf | 8174 | 3194 | 2815 |
| fetch-minimal-snapshot | effect-barrel | 8184 | 3224 | 2698 |
| fetch-minimal-snapshot | effect-schema-leaf | 8171 | 3174 | 2696 |
| fetch-minimal-snapshot | effect-schema-barrel | 8171 | 3211 | 2618 |
| fetch-bounded-account | effect-leaf | 1431 | 701 | 605 |
| fetch-bounded-account | effect-barrel | 1436 | 731 | 579 |
| fetch-bounded-account | effect-schema-leaf | 1423 | 680 | 588 |
| fetch-bounded-account | effect-schema-barrel | 1423 | 716 | 545 |
| fetch-bounded-snapshot | effect-leaf | 8174 | 3194 | 2812 |
| fetch-bounded-snapshot | effect-barrel | 8184 | 3223 | 2781 |
| fetch-bounded-snapshot | effect-schema-leaf | 8171 | 3173 | 2701 |
| fetch-bounded-snapshot | effect-schema-barrel | 8171 | 3210 | 2627 |
| candidate-wallet-react | react-existing | 137850 | 45594 | 40568 |
| candidate-wallet-query | react-query-existing | 137891 | 45518 | 40413 |
| candidate-wallet-react-app | react-app-existing | 138387 | 45862 | 40562 |
| candidate-wallet-query-app | react-query-app-existing | 138397 | 45973 | 40628 |

## Warm workload distributions, milliseconds

7 randomized independent process rounds × 25 measured samples after 5 warmups. All assertions included. Snapshot is 8 checked requests and 42,600 serialized bytes. File-export also includes fsync/publication and harness verification/cleanup. Wallet query uses a selector-shaped mock, not a real wallet.

| Workload | n | Median | p10–p90 | p95 | Min–max | Round median range |
| --- | --- | --- | --- | --- | --- | --- |
| baseline-http503 | 175 | 2.21 | 1.83–3.16 | 3.62 | 0.65–6.42 | 1.99–2.44 |
| near-api-http503 | 175 | 2.19 | 1.82–3.12 | 3.44 | 0.75–5.96 | 1.90–2.46 |
| candidate-wallet-query | 175 | 3.18 | 2.61–5.64 | 6.40 | 1.35–9.72 | 2.87–3.80 |
| candidate-account | 175 | 3.01 | 2.51–4.55 | 5.14 | 1.31–10.85 | 2.60–3.41 |
| fetch-minimal-snapshot | 175 | 17.31 | 14.67–23.10 | 25.04 | 13.16–30.70 | 16.91–18.25 |
| near-api-snapshot | 175 | 17.96 | 15.32–24.80 | 27.44 | 13.91–47.98 | 17.48–19.88 |
| fetch-bounded-account | 175 | 2.20 | 1.90–3.43 | 4.07 | 0.84–7.34 | 2.02–2.39 |
| fetch-minimal-http503 | 175 | 2.18 | 1.65–3.13 | 4.04 | 0.77–5.63 | 1.91–2.55 |
| fetch-bounded-snapshot | 175 | 18.41 | 15.28–25.75 | 34.54 | 13.76–136.99 | 16.74–22.24 |
| baseline-snapshot | 175 | 18.37 | 15.31–25.71 | 29.99 | 13.29–47.07 | 17.32–20.94 |
| near-api-account | 175 | 2.33 | 1.94–3.48 | 3.90 | 0.84–5.56 | 2.08–2.98 |
| candidate-snapshot | 175 | 24.11 | 20.15–33.36 | 38.30 | 18.46–61.04 | 20.99–33.75 |
| baseline-account | 175 | 2.31 | 1.87–3.79 | 4.56 | 0.77–7.87 | 2.07–3.13 |
| candidate-file-export | 175 | 26.63 | 22.02–37.23 | 42.32 | 19.18–69.57 | 24.51–29.98 |
| candidate-http503 | 175 | 2.82 | 2.20–3.87 | 4.49 | 1.18–14.52 | 2.50–3.05 |
| fetch-bounded-http503 | 175 | 2.13 | 1.81–3.04 | 3.56 | 0.75–4.64 | 2.00–2.23 |
| fetch-minimal-account | 175 | 2.19 | 1.85–3.35 | 3.96 | 0.69–6.14 | 2.07–2.39 |

## Cancellation after response headers

| Lane | Support | Median ms | Min–max ms |
| --- | --- | --- | --- |
| near-api | Unsupported selected public API | — | — |
| fetch-minimal | Full request/body signal | 0.51 | 0.34–3.78 |
| baseline | Unsupported selected public API | — | — |
| fetch-bounded | Full request/body signal | 0.64 | 0.60–9.49 |
| candidate | Full request/body signal | 0.55 | 0.41–4.74 |

## Dependency and import interpretation

Candidate declares {"@scure/base":"2.2.0","effect":"4.0.0-rc.118"}. Effect itself declares {}. Its unpacked package alone is 49493973 bytes across 2561 files; the candidate package is 142154 bytes. The declared @scure/base package is 166984 bytes; candidate + Effect + @scure/base total 49803111 unpacked file bytes. These are actual package files including source/maps/docs, not tarball transfer sizes or disk block usage.
Pure /data and /units browser metafiles contain zero Effect runtime inputs or emitted contribution; the package installation still carries Effect. Leaf versus barrel application imports are explicitly measured, rather than substituting a transformed source package. The total standalone runtime and the marginal runtime added to an existing Effect/Schema app must both inform the cost decision. The smaller delta for a barrel-import app does not recommend barrel imports: Effect+Schema existing gzip is 91,321 bytes with a barrel versus 24,469 with leaves, and combined account gzip is 101,767 versus 44,202 bytes.

## Fixture acceptance

12405 observed local HTTP requests; 0 fixture violations. All workload client counts and server methods/selectors/cursors match the specified work. Successful reads and every serialized binary entry were checked. This is synthetic protocol/consumer evidence, not real-node, wallet or browser acceptance. Historical phase-1 artifacts remain unchanged and are not relabelled as this candidate.
