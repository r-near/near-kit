# Reproducing the independent acceptance probes

The report is `acceptance-report.md`. The scripts require built near-kit checkouts. They do not contact a live RPC service or use real account credentials. The benchmark key is an existing public test fixture.

## Standard project gates

From the candidate checkout:

```sh
bun install --frozen-lockfile
bun run check
(cd packages/near-kit && bun run test:unit && bun run test:wallets)
(cd packages/react && bun run test)
```

Use an isolated writable HOME for filesystem tests. Full integration requires a functioning nearcore binary and a hard file-descriptor limit of at least 65,535. Do not call startup failures or skipped suites successful.

## Controlled baseline comparison

Create separate baseline and candidate worktrees. Build the candidate using its frozen dependencies. For the measurements in this report, the baseline package was compiled with that same TypeScript toolchain and common dependency installation; this avoids attributing dependency/compiler-version differences to the migration. Its public source is unchanged.

From this probe directory, pass checkout paths explicitly:

```sh
node compare.mjs BASELINE_CHECKOUT CANDIDATE_CHECKOUT 7 > benchmark-results.json
node package-probe.mjs CANDIDATE_CHECKOUT
node schema-parity.mjs CANDIDATE_CHECKOUT
node schema-parity-deep.mjs CANDIDATE_CHECKOUT
```

`compare.mjs` launches fresh Node processes in alternating order and records raw observations, medians, and ranges. `benchmark.mjs` can run one sample directly. Schema probes compare the retained public Zod contract with the native Effect codec. Counts include repeated generated cases and are not coverage percentages.

## Browser harness

With Bun on PATH:

```sh
node prepare-browser.mjs CANDIDATE_CHECKOUT BROWSER_OUTPUT_DIRECTORY
```

Serve the output directory over localhost HTTP using your normal development server, then open its `index.html` in a browser. A successful page has a PASS title and JSON with `ok`, `signatureVerified`, and `transportAborted` set to true; `processPresent` and `bufferPresent` must be false. It exercises root/native reads, a generated in-memory key, NEP-413 signing/verification, and cancellation through the mocked fetch boundary.

The same bundled harness can run in a standards-global Node VM without Node globals:

```sh
node --experimental-vm-modules browser-vm.mjs BROWSER_OUTPUT_DIRECTORY/smoke.js
```

The VM result is useful import/runtime evidence, not a substitute for claiming an actual browser was tested. No source file in the target checkout is modified; browser preparation stages its input under the ignored node_modules cache directory.
