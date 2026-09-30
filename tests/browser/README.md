# Real browser contracts

These Playwright tests exercise the **built package exports** (`near-kit`,
`near-kit/effect`, and `@near-kit/react`) in Chromium, Firefox and WebKit with
React 18.0.0 (the declared minimum) and React 19. The local HTTP fixture is a
small deterministic node, not a replacement SDK. It records independently
decoded transaction bytes and signatures, admits transfers into a disposable
ledger, and can drop a response after admission or hold an unfinished body.
No public RPC, real accounts, funded keys or wallet extensions are used.

## Run

```sh
bun install --frozen-lockfile
bunx --no-install playwright install chromium firefox webkit
bun run test:browser
bun run typecheck:browser
```

Browser system libraries must be installed on the host. CI uses the official
Playwright image pinned to the exact `@playwright/test` version. Keep those pins
in sync when upgrading. The test command builds both packages first; the two
local Vite servers load package exports normally, without source aliases.

```sh
# Fast local matrix
bun run test:browser --project=chromium-react18 --project=chromium-react19
# Repeat to expose lifecycle/order flakes
bun run test:browser --project=chromium-react19 --repeat-each=5
# Inspect a failure trace
bunx --no-install playwright show-trace test-results/browser/<test>/trace.zip
```

## Ownership and coverage

- `sdk.spec.ts`: real fetch, package/browser globals, native service injection,
  independently decoded V0/V1 and gas-key signatures, NEP-413, lost responses,
  correlated versus ambiguous nonce errors, exact-byte replays, concurrent
  nonce reservations, extension failure identity, and HTTP/body cancellation
- `react.spec.ts`: real provider/hooks, changing/unmounting reads, error recovery,
  authority replacement, concurrent mutation results, and reset/unmount after
  submission
- `wire-oracle.ts`: tiny independent Borsh reader and Node Ed25519/SHA-256
  verification. It imports no SDK encoder or crypto implementation
- `rpc-server.ts`: per-test HTTP state and a ledger. It models node responses,
  admission and transport faults; retry decisions belong entirely to the SDK

Use observable responses, UI and ledger effects for assertions. Do not patch SDK
methods, fake hook values, add test-only production exports, or replace a browser
run with jsdom. Controls and per-test ledgers are torn down after each test;
external page requests fail the test. Unit tests remain the owner for exhaustive
internal fault tables and unchanged historical vectors.

A successful test listing, typecheck or Node transport preflight is not evidence
that a browser passed. If a host cannot launch browsers, run this suite on an
appropriate isolated runner and retain its test report before calling it green.
