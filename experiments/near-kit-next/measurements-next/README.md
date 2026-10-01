# Broader candidate measurements

Measured package: `@near-kit/next`, SHA256 `c1734db3169cc54c695597d02553e6a09e56be1d54d43d61b568e538c89eaf69`, checkpoint `842b463`.

- [Summary and complete caveats](summary.md)
- [Reproduction harness](../scripts/bench/next/README.md)
- `raw.json.gz`: raw distributions, source/bundle provenance and fixture checks
- `audited-bundles.json.gz`: three corrected consumer-bundle records; read alongside the raw file, without overwriting runtime samples
- `provenance.json.gz`, `runtime-harness-hashes.json.gz`, `checksums.json`: exact inputs and integrity records
- `bundle-execution-checks.json.gz`: execution of eleven minified workflows in Node, not browser compatibility

All comparisons use one loopback fixture with safe-range u64 fields and large decimal-string quantities. Legacy validation/precision/cancellation contracts are weaker; near-api-js uses public generic query for pinned keys and paginated state. Browser near-api-js includes Browserify util. Process-cold imports have warm filesystem caches. Complete file-export timing includes publication and harness verification/cleanup. Wallet modules/selector creation and actual browser rendering are excluded from the mocked wallet workload.

These results do not establish a speedup, mainnet performance or full-SDK completion. The old `measurements/` directory and historical report remain separate immutable checkpoints.

Machine-generated evidence is stored compressed to preserve its exact original bytes through formatting tools. Runtime sample hashes are unchanged. Later harness formatting and a split counter initialization are behavior-preserving; a separate smoke run verifies the current harness without replacing measured samples.
