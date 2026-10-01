# Keep the experiment; do not replace the SDK yet

The explicit Effect client earned a useful, bounded role for Effect applications. It has one
execution model, exact protocol values and request/body cancellation. It does not justify a
wholesale SDK replacement or a performance claim. Keep it private while the broader workflow
and prerelease-dependency decisions remain open.

## What the audit changed

The current SDK combines RPC, custody, signing, wallets, contract proxies, React and node-process
management. Those concerns do not need one lifetime. The read experiment removes them from the
read boundary rather than recreating each behind an Effect service.

The essential read workflows are an exact account/block read, validated contract JSON or bytes,
same-block composition, and an application-owned account/network selection. State-changing
workflows are also essential to a complete SDK, but remain outside this experiment. Access-key,
state and code inspection, cursor traversal and broader wallet/platform support are still open.

Three misleading conveniences were deliberately omitted: absence inferred from any exception,
generic contract results with JSON-to-text fallback, and rounded balances described as spendable.
One finality default and returned block metadata replace implicit snapshot assumptions. Unit tests
focus on those observable contracts and resource cleanup; real-node tests verify protocol shapes.

The [design comparison](DESIGN.md) selects a configured value returning native Effects over a
second NEAR service, a Promise/Effect mirror, or an adapter inheriting another SDK's behavior.
A small direct-fetch application remains a reasonable choice. The result is aimed at Effect users;
requiring Effect for every small Promise script is not an established benefit.

## Validation checkpoint

Runtime source and examples: `d5ab6f79ab530aa60a782aff5945655616d48948`.
The [read workflow](https://github.com/r-near/near-kit/actions/runs/36790889070) passed:

- Node 22 and 24: build, strict types, 72 unit/resource tests, and a fresh packed consumer
- Docker: 9 reads against official nearcore sandbox 2.13.4, protocol 86
- Chromium 153, Firefox 155 and WebKit 26.6: 12 application lifecycle/read cases

The Docker fixture seeds a small contract in genesis. It submits no transactions. The image is
pinned to `nearprotocol/sandbox@sha256:1f36ba675ecce97cf5311b8f29f6ca7c42af17b6d6c45d38a652f0f9bad282a7`.
The [Docker evidence](https://github.com/r-near/near-kit/actions/runs/36790889070/artifacts/11131408933)
records node/image/fixture identities and read results. Ordinary GitHub-hosted Ubuntu Docker
worked with default isolation; the ARC runner had no daemon. No local Docker/browser success
is claimed. Browser coverage uses a controlled HTTP server, separately from real-node coverage.

Independent design reviews required revisions before implementation. Initial source review and
an isolated packed-consumer review passed. The latter also exercised SSR and a simulated DOM,
including a failing control with selection-revision handling removed. The final independent source-delta review also passed, including reused chunk storage, buffer
growth, split Unicode, exact byte limits and cancellation. Final branch checks are recorded on
the draft PR.

The [existing repository workflow](https://github.com/r-near/near-kit/actions/runs/36790889073)
passed lint/typecheck, but its unchanged integration suite had one sandbox startup timeout:
1,527 core tests passed and 9 were skipped by that failed setup; 49 React tests passed. That run
is not a full repository pass. Existing SDK implementation and tests were not changed to hide it.

## Measured tradeoffs

Node 24.19.0, one Intel Xeon 8370C host, exact main `86cf14a`, near-api-js 7.3.1, and the
packed prototype SHA256 `55c8059aaee28618805e7ca15da99d6aa6a47bd6981dcaa01a9b3b23fd762b48`.
Methods, semantic differences and reproduction commands are in [the harness](scripts/bench/README.md).
[Full results](measurements/summary.md) and compressed raw samples accompany this checkpoint.

| Account consumer / workload | Prototype | Existing main | near-api-js |
| --- | ---: | ---: | ---: |
| Browser gzip bytes | 42,639 | 115,415 | 65,474* |
| Process-cold import median | 201 ms | 156 ms | 59 ms |
| Warm account median | 2.63 ms | 2.26 ms | 2.23 ms |
| Four-read median | 5.23 ms | 3.85 ms | 3.64 ms |

*The near-api-js browser consumer needs the Browserify util polyfill; its bytes are included.
The five-read prototype is much narrower than either SDK. Direct fetch costs far less, with
weaker or more manually implemented contracts. These are process-cold/warm-filesystem imports
and noisy loopback workloads, not mainnet speedups. All 12,705 measured requests satisfied the
fixture's method/argument/selector/count checks. Supported cancellation lanes each closed all
35 deliberately unfinished bodies; selected baseline/near-api APIs lack a signal input.

Effect module imports matter: changing package and example imports reduced the initial account
bundle from 122,943 to 42,639 gzip bytes. The increment is still 34,040 bytes in an existing
leaf-import Effect app, or 18,210 with Effect+Schema already present. Barrel-app marginal figures
are smaller only because those existing bundles are larger; the full results show both.

A bounded growing buffer replaced retained per-chunk arrays after one-byte fragmentation exposed
memory amplification. For the controlled ~256 KiB body, process-wide median peak RSS fell from
251 to 92 MiB (16 KiB chunks: 70 MiB). Fragmented parsing remains slower than the comparison lanes.
The byte limit is not a total-memory cap; parsing and the runtime allocate additional memory.

## Remaining decisions

- Effect 4.0.0-rc.118 and its unstable HTTP API are deliberately pinned. Production adoption needs
  a supported-version policy and a repeat of this evidence when upgrading. Stable Effect 3.22.2
  was available at evaluation time; choosing it would require a separately tested v3/platform
  implementation. The [official v4 docs](https://effect.website/docs/v4/getting-started/installation)
  and installed rc.118 APIs take precedence over older examples in the reviewed
  [Effect skill](https://github.com/kitlangton/skills/tree/main/skills/effect)
- The pinned runner starts evaluation before checking an already-aborted signal. Examples call
  `signal.throwIfAborted()` at entry; the library does not patch the runner or hide this limitation
- This is not real wallet-extension, mobile, hardware-wallet, React Native, Deno or Bun coverage
- Full SDK replacement needs a separate design for remaining read breadth and state-changing
  workflows. The previously paused transaction/reconciliation scope remains paused
- Keep this draft for review; do not publish or replace existing packages based on these results
