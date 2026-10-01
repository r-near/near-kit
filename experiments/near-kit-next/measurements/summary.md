# Read-only benchmark results

Measured artifact SHA256: 55c8059aaee28618805e7ca15da99d6aa6a47bd6981dcaa01a9b3b23fd762b48
Baseline: 86cf14a2a9e0c7d3acaa8e3d40b5fb4c85ef172d; near-api-js 7.3.1; v24.19.0; Intel(R) Xeon(R) Platinum 8370C CPU @ 2.80GHz.

Method and limitations: ../scripts/bench/README.md. Full raw samples: final-raw.json.gz.
No general speedup claim: these process-cold imports and warm loopback reads have different validation/resource guarantees.

## Process-cold import (milliseconds)

| Lane | Median | p10–p90 | Min–max |
|---|---:|---:|---:|
| prototype | 200.70 | 175.51–427.49 | 174.19–533.34 |
| baseline | 155.81 | 143.85–188.66 | 142.33–202.89 |
| near-api | 59.30 | 49.78–144.90 | 46.78–344.38 |
| fetch-minimal | 1.04 | 0.83–3.83 | 0.74–17.23 |
| fetch-validated | 1.10 | 1.00–2.00 | 0.91–2.60 |

## Browser account consumers (bytes)

near-api-js includes an actual util polyfill; plain browser bundling failed without it.

| Lane | Minified | gzip | Brotli | gzip increment / barrel Effect | gzip increment / barrel Effect+Schema |
|---|---:|---:|---:|---:|---:|
| prototype | 128428 | 42639 | 38265 | 24784 | 8507 |
| baseline | 483571 | 115415 | 96996 | 115488 | 115756 |
| near-api | 203074 | 65474 | 56196 | 65524 | 65735 |
| fetch-minimal | 1397 | 725 | 644 | 621 | 566 |
| fetch-validated | 3030 | 1495 | 1324 | 1335 | 1343 |

### Prototype marginal gzip: import style matters

| Existing app | Existing gzip | Combined gzip | Increment |
|---|---:|---:|---:|
| effect | 29658 | 54442 | 24784 |
| effect-schema | 91321 | 99828 | 8507 |
| effect-leaf | 8627 | 42667 | 34040 |
| effect-schema-leaf | 24469 | 42679 | 18210 |

## account latency (milliseconds)

| Lane | Pooled median | Pooled p95 | Round-median range |
|---|---:|---:|---:|
| prototype | 2.63 | 3.85 | 2.43–2.88 |
| baseline | 2.26 | 4.35 | 2.06–2.48 |
| near-api | 2.23 | 3.65 | 2.05–2.47 |
| fetch-minimal | 2.16 | 3.61 | 2.04–2.48 |
| fetch-validated | 2.19 | 3.46 | 1.96–2.57 |

## view latency (milliseconds)

| Lane | Pooled median | Pooled p95 | Round-median range |
|---|---:|---:|---:|
| prototype | 2.51 | 3.19 | 2.34–2.62 |
| baseline | 2.11 | 3.13 | 1.94–2.32 |
| near-api | 2.12 | 3.38 | 1.93–2.29 |
| fetch-minimal | 2.00 | 3.11 | 1.84–2.13 |
| fetch-validated | 2.03 | 2.79 | 1.92–2.21 |

## four latency (milliseconds)

| Lane | Pooled median | Pooled p95 | Round-median range |
|---|---:|---:|---:|
| prototype | 5.23 | 10.21 | 4.79–6.14 |
| baseline | 3.85 | 5.68 | 3.48–4.40 |
| near-api | 3.64 | 5.68 | 3.39–4.10 |
| fetch-minimal | 3.24 | 5.36 | 3.01–3.82 |
| fetch-validated | 3.40 | 5.50 | 3.21–3.63 |

## missing latency (milliseconds)

| Lane | Pooled median | Pooled p95 | Round-median range |
|---|---:|---:|---:|
| prototype | 2.46 | 3.31 | 2.35–2.54 |
| baseline | 2.15 | 4.62 | 1.97–2.38 |
| near-api | 2.00 | 2.75 | 1.89–2.12 |
| fetch-minimal | 1.92 | 2.63 | 1.82–2.00 |
| fetch-validated | 1.93 | 2.42 | 1.85–2.03 |

## http503 latency (milliseconds)

| Lane | Pooled median | Pooled p95 | Round-median range |
|---|---:|---:|---:|
| prototype | 2.37 | 4.48 | 2.14–2.62 |
| baseline | 1.98 | 3.88 | 1.84–2.40 |
| near-api | 1.95 | 3.01 | 1.84–2.29 |
| fetch-minimal | 1.81 | 2.31 | 1.73–1.96 |
| fetch-validated | 1.94 | 2.85 | 1.83–2.06 |

## retry3 latency (milliseconds)

| Lane | Pooled median | Pooled p95 | Round-median range |
|---|---:|---:|---:|
| prototype | 6.44 | 9.11 | 6.14–6.92 |
| baseline | 5.62 | 8.48 | 5.29–6.38 |
| near-api | 5.39 | 6.82 | 5.23–5.73 |
| fetch-minimal | 5.31 | 8.83 | 5.02–6.61 |
| fetch-validated | 5.59 | 8.21 | 5.30–5.81 |

## cancel latency (milliseconds)

| Lane | Pooled median | Pooled p95 | Round-median range |
|---|---:|---:|---:|
| prototype | 0.45 | 3.46 | 0.31–0.68 |
| baseline | Unsupported | | |
| near-api | Unsupported | | |
| fetch-minimal | 0.36 | 4.34 | 0.29–0.47 |
| fetch-validated | 0.41 | 2.95 | 0.35–0.70 |

## Controlled chunking observation

~256 KiB envelope, separate Fetch stream fixture. Process maxRSS includes imports/runtime; this is not an exact per-request memory measurement.

| Lane | 1-byte median ms | 16-KiB median ms | 1-byte median maxRSS MiB | 16-KiB median maxRSS MiB |
|---|---:|---:|---:|---:|
| prototype | 467.36 | 19.10 | 92.05 | 69.89 |
| baseline | 273.87 | 10.34 | 152.80 | 65.39 |
| near-api | 248.98 | 6.71 | 139.80 | 51.17 |
| fetch-minimal | 281.97 | 4.38 | 137.36 | 40.40 |
| fetch-validated | 405.88 | 9.65 | 213.96 | 40.99 |

All observed requests were read-only and selectors/argument checks passed. Each normal read made one internal attempt; retry3 made three explicit application attempts. Source-independent protocol/browser acceptance remains separate.
