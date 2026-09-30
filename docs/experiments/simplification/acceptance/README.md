# Reproducing the second-pass acceptance evidence

Read `acceptance-report.md` for the verdict, exact commits, scope and limitations.
The scripts run against separate built checkouts supplied as arguments. They do
not contact a live RPC service or use real account credentials. The benchmark key
is an existing public test fixture.

## Standard gates

From a clean candidate checkout:

```sh
bun install --frozen-lockfile
bun run check
(cd packages/near-kit && bun run test:unit && bun run test:wallets)
(cd packages/react && bun run test)
```

Use an isolated writable HOME for filesystem tests. Real nearcore integration
needs the required hard file-descriptor limit; startup failure is not a pass.
Repeat the supported runtime pairings described in the report.

## Baselines and measurements

Use phase-one `95111ba` and original `86cf14a` checkouts. The original package was
compiled with the same compiler and common dependency versions as the candidate
to isolate migration cost. The phase-one source matches its accepted `a39d1aa`
source; the later commit only records documentation.

From this artifact directory, with Bun 1.4.2 on PATH and Node 24.19.0:

```sh
node compare.mjs PHASE_ONE_CHECKOUT CANDIDATE_CHECKOUT 7
node compare.mjs ORIGINAL_CHECKOUT CANDIDATE_CHECKOUT 7
node bundle-probe.mjs PHASE_ONE_CHECKOUT
node bundle-probe.mjs ORIGINAL_CHECKOUT
node bundle-probe.mjs CANDIDATE_CHECKOUT
node package-probe.mjs CANDIDATE_CHECKOUT
node schema-parity.mjs PHASE_ONE_CHECKOUT CANDIDATE_CHECKOUT
node schema-parity-deep.mjs PHASE_ONE_CHECKOUT CANDIDATE_CHECKOUT
node helper-parity.mjs PHASE_ONE_CHECKOUT CANDIDATE_CHECKOUT
```

`compare.mjs` alternates fresh processes and retains raw samples, medians and
ranges. `bundle-probe.mjs` builds all available source entrypoints together and
uses Node gzip level 9, matching the earlier report. Independent compiled-entry
bundles can be smaller; do not mix the methods. Codec probes read the historical
decoder only from the baseline; the candidate does not retain it in production.
Generated-case counts include duplicate inputs and are not coverage percentages.

## Browser harness

```sh
node prepare-browser.mjs CANDIDATE_CHECKOUT BROWSER_OUTPUT_DIRECTORY
node --experimental-vm-modules browser-vm.mjs BROWSER_OUTPUT_DIRECTORY/smoke.js
```

Serve the output directory with a normal localhost development server and open
`index.html` to perform a real browser check. Success is a PASS title and JSON
with both signature checks and transport interruption true, five requests, and
no process/Buffer globals. This covers public and native reads, real in-memory
NEP-413 signing/verification, and cancellation at a mocked fetch boundary.
The standards-global VM is useful runtime evidence but is not a live browser.
Preparation stages its input under the candidate's ignored node_modules cache;
it does not change production source.

## Files

- `benchmark-vs-*.json`: two separate alternating comparisons; raw duration
  values are totals for the operation counts in each row
- `bundle-*.json`: paired source-entry sizes and dependency-graph observations
- [Baseline](../architecture-baseline.json) and [candidate](../architecture-candidate.json)
  inventories: tracked production modules and AST comment-stripped accounting,
  including type declarations. Independently generated audit copies matched these
  files byte-for-byte and are not stored twice.
- `schema-*.json`, `helper-results.json`: generated differential outcomes
- `package-result.json`, `browser-result.txt`, `ci-evidence.json`: distribution,
  VM and independently inspected exact-source CI proof

Environment limitations and residual costs remain part of acceptance even when
the supported checks pass. This evidence does not authorize a release.
