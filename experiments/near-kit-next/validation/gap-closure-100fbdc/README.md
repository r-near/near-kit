# Initial independent gap-closure checkpoint

Source: `100fbdc5cb69bb8a559aa357dddf7ca36ec94e4a`.

[Candidate CI](https://github.com/r-near/near-kit/actions/runs/36815383853) passed Node 22/24, packed Deno 2.9.7/Bun 1.4.2, pinned nearcore Docker including full ML-DSA key lookup, existing Chromium/Firefox/WebKit cases, and the independent Rust public-address reference. [Unchanged SDK CI](https://github.com/r-near/near-kit/actions/runs/36815383849) passed separately.

These are the downloaded CI artifacts, not reconstructed local claims. The Rust reference uses the official registry versions from pinned nearcore 2.13.4's lockfile, independently defined public structs and a BTreeMap; it matched all six candidate byte/address vectors. Its generated transitive Cargo.lock is retained under test/reference/address and final CI uses --locked. Deno/Bun execute the npm-packed ESM with native JSON and Web APIs; Deno uses no allow-* runtime permission flags.

This checkpoint predates SSR hydration and NEP-413 implementation. It does not cover those additions or the final package. The final-head record supersedes these narrower results where applicable; source/profile differences stay explicit.
