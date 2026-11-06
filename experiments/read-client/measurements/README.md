# Measurement evidence

`final-raw.json.gz` contains all final samples and provenance for the buffer/module-import
prototype; `initial-raw.json.gz` preserves the first result before those revisions. These are
ordinary gzip-compressed JSON files, not executable artifacts. Decompress with `gzip -dc FILE`.

Uncompressed SHA256:

- Final: `2bd98998574e7bc00988d85c734146c3aeb1827e1193e9c44bb403a6c1bf8309`
- Initial: `ac86ad891d5b14ebf5104048eaf314631e0cdf3542936f8fcb40b1a2414631fc`

The raw records include environment, exact package hashes, request counts, every timing sample,
consumer bundle sizes and controlled-fragment observations. `method-source-hashes.sha256`
identifies the harness sources used. The generated consumers/metafiles can be reproduced by
[the pinned harness](../scripts/bench/README.md); generated dependencies are not committed.
The [summary](summary.md) is derived from these samples, not a separate measurement.
