# Effect implementation experiment

Status: planning and baseline verification. This branch is experimental and is not
ready to merge or publish.

Base: `86cf14a2a9e0c7d3acaa8e3d40b5fb4c85ef172d` (main, 2026-09-30), including
explicit caller-selected transaction nonces from PR #247.

## Goal and compatibility contract

Reimplement near-kit's asynchronous core idiomatically with Effect while retaining
a 1:1-compatible public SDK. Existing imports, fluent builders, Promise results,
error classes and data, key formats, JSON-RPC behavior, deterministic wire bytes,
and `@near-kit/react` consumers must keep working. Add an optional `near-kit/effect`
entrypoint for consumers who want composable Effects and injectable services.
React remains the existing separate package, `@near-kit/react`.

Effect programs own orchestration, typed failures, retry schedules, concurrency,
and scoped resources. Promise conversion belongs at compatibility boundaries and
external Promise-only integrations, not around the existing implementation. Pure
cryptography, amount parsing, and deterministic Borsh algorithms should remain
ordinary pure functions. Existing exported Zod schemas remain usable by consumers;
Effect-native protocol validation must preserve their accepted wire contracts.

## Migration slices

1. Establish the unchanged baseline, public compatibility fixtures, and test-audit
   review criteria. Record the Effect and tooling version decision with sources.
2. Add the shared Effect runtime boundary, typed services/layers, and optional
   entrypoint. Pin the runtime and requested toolchain dependencies.
3. Migrate RPC transport, protocol decoding, cancellation, and retry schedules.
4. Migrate nonce coordination, signing, transaction builders, and delegate flows.
   Preserve explicit-nonce semantics and never introduce unsafe transaction replay.
5. Migrate Near orchestration, contract proxies, wallet adapters, and key stores.
6. Migrate sandbox process/filesystem lifecycle and resource cleanup.
7. Migrate React asynchronous ownership while preserving hook/provider APIs;
   update examples and documentation for both entrypoints.
8. Run independent test-audit and compatibility checks, full package checks,
   browser/bundle checks, measured size/performance comparison, and exact-commit CI.

Each coherent slice receives its own reviewed commit. Push successful checkpoints
frequently. Keep implementation lanes on disjoint files or separate worktrees;
never mutate source/tests in a checkout while its Vitest process is running.

## Verification requirements

- Retain and run the existing 44 unit, 25 integration, 7 wallet, and 6 React test
  files; report actual counts and any environment-dependent failures separately.
- Validate unchanged consumer examples and declaration compatibility.
- Add behavior-focused negative/error-path tests only when they protect an
  independent regression risk not already covered by stronger existing tests.
- Exercise layer substitution, typed error identity, retry counts and delays,
  interruption, cleanup, concurrent nonces, wallet rejection, and React unmounts.
- Preserve existing byte-level crypto/Borsh/transaction/delegate vectors.
- Run format/lint, build, typecheck, focused tests, aggregate tests, and CI for the
  exact final commit. Do not call unrun or blocked stages successful.
- Review workflow privileges before changes. No merge, release, deployment, or
  direct push to main is part of this experiment.

## Baseline observations

- Clean clone and frozen-lockfile installation succeeded with Bun 1.4.2.
- Root build, typecheck, and existing lint commands pass.
- Initial unit run: 1,169 passed and one environment-path failure: the home-path
  test attempts to create `/home/agent/.near-test`, outside this workspace. Rerun
  with an isolated temporary HOME to exercise the same behavior safely.
- Isolated-HOME rerun: all 1,170 unit tests pass; all 80 wallet and 49 React tests pass.
- Full integration baseline is blocked locally: nearcore requires 65,535 file
  descriptors but the container hard limit is 16,384. The historical 2.10 binary
  download also returned HTTP 502. Only 2 integration tests ran successfully;
  277 were skipped after suite startup failures. This is not integration proof.
- Sandbox integration needs a usable local nearcore binary and adequate file
  descriptor limits. Investigate permitted isolated configuration; CI results
  must be distinguished from local proof if the environment remains constrained.

## Progress

- [x] Fresh main checked out on a unique experiment branch
- [x] Existing source layout, contributor guidance, and workflows inspected
- [x] Requested OpenClaw test-audit skill inspected and installed with provenance
- [x] Baseline dependency install, build, typecheck, and lint
- [ ] Full baseline and compatibility fixtures
- [ ] Effect/tooling version decision
- [ ] Implementation slices
- [ ] Independent audit and exact-commit CI

## Runtime version decision

Pin `effect` to `4.0.0-rc.118` for this isolated experiment. This is a prerelease,
not the stable v3 line; the experiment intentionally evaluates the current v4
service, schema, runtime, and resource APIs without committing to a release.
The Promise boundary was tested against the installed version: domain failure
identity is preserved. Third-party Promise rejections become tagged ExternalError
values in native programs and are unwrapped only at the compatibility facade.

Sources: [Effect migration guide](https://github.com/Effect-TS/effect/blob/main/MIGRATION.md),
[Effect tsgo setup](https://github.com/Effect-TS/tsgo/blob/main/docs/README.md).

## Acceptance process

Maintain explicit subsystem ownership and dependency contracts. Each coherent
slice follows implementation, independent review, and behavioral QA. An absent,
null, skipped, or environment-blocked result never counts as passing. Diagnose
failed checks before bounded repair attempts; preserve the failure evidence.
Before integration, compare commit ancestry to avoid applying a completed slice
twice. Green inherited tests are necessary but do not replace lifecycle, wire
compatibility, and end-to-end acceptance evidence.

## Core checkpoint 2

The native reservation service now replaces the internal NonceManager entirely.
Its behavioral tests exercise the service directly; no old internal class is kept
just for tests. Memory key storage owns immutable state through Effect Ref.
Insertion order and empty rotating pools retain existing behavior. Returned key
arrays are snapshots, so mutating a result cannot mutate internal key storage.

RPC and transaction workflows now use Effects for decoding, retry, interruption,
and coordination. Independent review reproduced and repaired alias fallback, HTTP
body cleanup, callback receiver, account ordering, and empty-pool regressions.
The checkpoint passes build, typecheck, lint, 1,212 unit tests, 80 wallet tests, and
49 React tests. Full exact-commit CI is pending.

Further cleanup moves the remaining internal RPC implementation into a class-free
native service, with only the public near.rpc Promise boundary retained. Client,
wallet, filesystem, sandbox, React, and final acceptance work remains in progress.
The native TypeScript/Oxc toolchain is validated separately and will land with its
strict source/lifecycle corrections; this checkpoint keeps the passing existing
gates rather than publishing known lint failures.
