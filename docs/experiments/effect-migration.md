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

- Retain and run the existing 44 unit, 25 integration, 8 wallet, and 6 React test
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
- Wallet, React, isolated-HOME unit rerun, and integration baseline pending.
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
