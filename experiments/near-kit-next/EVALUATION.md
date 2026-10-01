# Coherent independent workflows; full rewrite still open

The candidate now covers exact protocol reads and state streams, pure data/units/address calculation, public NEP-413 verification, wallet observation, complete snapshot export, and request-to-hydration and authentication-receipt examples. Independent public/authentication work was not inherently blocked by transaction implementation; those gaps were designed and built separately. The [original full goal](GOAL.md) still requires the paused signing/custody/action/delegate/submission/reconciliation work before this can replace the general SDK.

## Why this architecture

Competing designs included a NEAR service, Promise facade, upstream adapter, configured methods and named functions over an opaque client. The selected module surface has one HTTP implementation and resolves the caller's Effect transport at execution. Effects own network/body interruption; applications retain their framework, cache, HTTP server and session lifetimes. Pure computations stay ordinary synchronous functions. Builders, generic RPC assertions, extra service tags and an owned library runtime did not earn their cost.

Public-address design compared a tiny fixed encoder with a concrete Borsh dependency. Authentication compared a pure verifier plus the existing keyed read with upstream provider delegation and app-owned WebCrypto. The selected optional subpaths keep their computation independent of the read root, with explicit error and crypto profiles.

Independent reviews corrected numeric and wire contracts, tracing/body lifetime, state cursors, wallet callbacks, raw-output delegation, SSR cleanup and hydration, challenge source capture, body/deadline/replay behavior and exact consumer compiler commands. The complete auth example does not hide its server/store ownership behind an SDK service.

## Acceptance

Initial continuation head `100fbdc` passed Node 22/24, packed Deno/Bun, all existing browser cases, pinned nearcore Docker including full ML-DSA lookup, and six independent Rust address vectors. Global-code success and all four nonempty historical block-effect kinds now have recorded live public reads plus replay coverage. Later source has independent approval, 387 local tests, 45 authentication cases, a complete packed SSR handoff, and nine public proofs executed from a fresh packed Node consumer. Implementation head `7ab144b` passed [the expanded candidate matrix](https://github.com/r-near/near-kit/actions/runs/36818029551) and [unchanged SDK CI](https://github.com/r-near/near-kit/actions/runs/36818029665), including the added SSR/public-crypto browser and Deno/Bun proof cases. Final documentation-head checks are recorded on [draft 257](https://github.com/r-near/near-kit/pull/257).

Node-global-free public declarations remain distinct from optional WalletSelector declarations, whose upstream type mappings and Node type-only requirement are documented. Real browser tests use controlled HTTP and a typed connector mock. Authentication tests use independent disposable public proofs and local HTTP/RPC, not user wallets or chain writes.

## Recommendation and remaining limits

Keep this coherent Effect-first direction, but do not claim the requested complete rewrite or replace/publish the SDK yet. It provides explicit resources, precise read errors and exact protocol values with smaller matched read bundles than the broad SDK baselines. Its measured startup and workflow costs are higher; conventional small fetch applications can remain cheaper and simpler.

- Essential transaction/custody/submission/reconciliation scope remains paused; a larger read/auth candidate is not a substitute
- The crypto profile supports Ed25519 and secp256k1; ML-DSA authentication, real extension/mobile/hardware wallets and untested runtime/OS targets are not claimed
- Protocol values are exact where represented; arbitrary contract JSON uses ordinary JavaScript numeric semantics. Metadata/proof bytes remain node-reported/unverified
- Effect 4.0.0-rc.118/HTTP APIs remain prerelease dependencies. Already-aborted runner startup requires the documented application guard
- Response/envelope byte caps are not total CPU/heap budgets, and synchronous computation cannot be preempted
- Receipt atomicity is one-process only; production storage, HTTPS, rate limits and session revocation belong to the application

## Added workflow costs

[Retained measurements](https://github.com/r-near/near-kit/tree/experiment/near-kit-full-20261001/experiments/near-kit-next/measurements-gaps) bind all 53 runtime/example members to archive SHA `14a06e61…5d5ec8b`, with raw distributions and consumer-resolution checks. The matched root/data/units graphs and minified/compressed bytes are unchanged from the prior artifact; optional crypto is unreachable there. Installation still grows by 2,333,421 bytes to about 52.1 MB of package/runtime files, primarily because dependencies include source/maps/docs.

| Consumer or workload | Measured result |
| --- | ---: |
| Public address browser gzip | 4,519 B |
| Both-scheme NEP-413 verifier gzip | 24,315 B |
| Complete receipt Node bundle gzip | 69,718 B |
| Complete SSR hydration gzip | 114,911 B |
| Matched weaker SSR fetch/React/Query reference gzip | 70,624 B |
| Six-vector address batch median | 0.327 ms |
| Ed25519 / secp256k1 proof median | 2.565 / 2.339 ms |
| Receipt including four HTTP steps/start/close median | 12.081 ms |
| SSR route/DTO/query-refresh median; weaker reference | 1.966 / 0.689 ms |

The run retains 180 fresh-process imports and 175 samples per workload. These are shared-host, filesystem-warm observations. Receipt timing includes real loopback HTTP, while authority reads are controlled fixtures. Browser bundles are actual consumers, but no browser-render/hydration timing is claimed. A prior diagnostic package-resolution error was caught and excluded before the final measurement pass.

## Prior broad-SDK workflow comparison

The [full results](https://github.com/r-near/near-kit/tree/experiment/near-kit-full-20261001/experiments/near-kit-next/measurements-next) retain raw samples and semantic differences. Node 24.19.0 on one Xeon 8370C; esbuild 0.28.2; measured tarball `c1734db3…89eaf69` at `842b463`. The new matched root/data/units comparison confirms those runtime paths remain unchanged; optional added workflows are measured separately above.

| Complete consumer/workload | Candidate | Main 86cf14a | near-api-js 7.3.1 |
| --- | ---: | ---: | ---: |
| Account browser gzip | 44,145 B | 115,238 B | 65,215 B |
| Snapshot browser gzip | 48,183 B | 115,894 B | 65,929 B |
| Account import median | 213.46 ms | 154.72 ms | 62.14 ms |
| Warm account median | 3.01 ms | 2.31 ms | 2.33 ms |
| Complete snapshot median | 24.11 ms | 18.37 ms | 17.96 ms |

Smaller tree-shaken bundles come with slower imports and loopback workflows in these measurements. The candidate adds 19,733 gzip bytes to the measured Effect+Schema leaf-import app; it is not free merely because an application already uses Effect. Effect alone contributes about 49.5 MB of unpacked source/maps/docs. A small direct-fetch application remains much cheaper when it does not need this contract.

The snapshot includes eight reads, 237 binary state entries and complete serialized output. Legacy lanes do not provide identical precision, validation or cancellation. The dataset's u64 values are safely representable; projecting already-rounded numbers cannot repair other inputs. The near-api browser lane includes util, and its snapshot uses generic query for pinned keys and cursors. All 12,405 fixture requests and eleven minified workflow checks passed. These are local, process-cold/filesystem-warm results, not mainnet speed claims.

Actual mountable React and React Query consumers including ReactDOM cost 105,813 / 115,484 gzip bytes, about 46 KB beyond their matched existing apps. Selector setup/modules are excluded. The actual filesystem export measured 26.63 ms median including fsync/publication and harness validation/removal. Pure data/units consumers are 1,797 / 516 gzip bytes with zero Effect runtime input, though installation still includes the package dependency.
