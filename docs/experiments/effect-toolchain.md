# Effect experiment: toolchain and migration contract

This branch evaluates an Effect-native core behind near-kit's existing Promise
API. It is an experiment, not a production release or a decision to publish a
prerelease dependency.

## Reproducible versions

Versions were checked against npm package metadata on September 30, 2026.

| Package           | Exact version  | Purpose                                              |
| ----------------- | -------------- | ---------------------------------------------------- |
| `effect`          | `4.0.0-rc.118` | Native workflows, Schema, services and resources     |
| `typescript`      | `7.0.2`        | Native compiler and declaration emit                 |
| `@effect/tsgo`    | `0.47.0`       | Effect diagnostics and TypeScript/Oxlint integration |
| `oxlint`          | `1.86.0`       | Standard and type-aware lint                         |
| `oxlint-tsgolint` | `7.0.2003`     | Oxlint's type-aware engine                           |
| `oxfmt`           | `0.71.0`       | Formatting                                           |
| Bun               | `1.4.2`        | Workspace installation and scripts                   |

Effect's stable `latest` tag is still `3.22.2`; v4 is a release candidate.
The exact v4 pin is intentional. Do not replace it with `latest`, `rc`, or a
caret range, and keep additional Effect ecosystem packages on the same release.
The compiler/linter combination above is listed in `@effect/tsgo`'s compatibility
manifest. Upgrading Oxlint independently may make patching fail; update and test
the compatible set together.

Vitest 4 and the existing React 18+ peer contract are retained. The v4
`@effect/atom-react` release requires React 19, and `@effect/vitest` RC.118 requires
Vitest 5; neither dependency is needed to expose native Effects or test them.
Use normal Vitest tests that return/await `Effect.runPromise` or
`Effect.runPromiseExit`, and Effect's TestClock/Deferred for deterministic tests.

## Commands

```sh
bun install --frozen-lockfile
bun run build
bun run typecheck
bun run lint
bun run format:check
bun run test
```

`prepare` runs `effect-tsgo patch --oxlint --no-force` after installation. It patches the
installed native TypeScript and Oxlint engines using the pinned Effect toolchain;
it does not patch repository source. The explicit `--no-force` works around a
0.47.0 CLI bug: its unused, deprecated `force` boolean has no default and is
otherwise treated as required. Compatibility validation remains enabled.
If installation was run with
`--ignore-scripts`, explicitly run `bun run prepare` before checking code.

`bun run lint` is read-only. Use `bun run lint:fix` for safe lint fixes and
`bun run format` for formatting. CI never writes fixes. The pre-commit hook
formats staged files and checks staged JavaScript/TypeScript files.

Oxlint extends Effect's published recommended preset, which enables its
type-aware `effecttsgo` plugin and default diagnostic rules. Generated build and
coverage output is ignored. The TypeScript plugin's `diagnostics: false` setting
prevents duplicate Effect reports from the TypeScript LSP: Oxlint owns those
reports, while the patched compiler still checks TypeScript and the LSP retains
refactors. Build dependent workspace packages before type-aware lint so their
`.d.ts` exports resolve. Editors should use the workspace native TypeScript server
and the Oxlint extension, rather than two competing TypeScript language servers.

Formatting retains this repository's two-space indentation, double quotes,
80-column width, and omitted optional semicolons. The lockfile is owned by Bun.

## Implementation contract

- Compose native operations with `Effect.gen` and named `Effect.fn` boundaries.
  The native API is exported from `near-kit/effect`; the familiar root entrypoint
  remains Promise-based.
- Define explicit `Context.Service` tags and Layers for transport, signing,
  key storage, nonce state, and other replaceable dependencies. Build dependency
  graphs at the boundary; preserve injection hooks and deterministic test fakes.
- Keep pure crypto, encoding, transaction serialization and unit conversions pure.
  Use Effect at real side-effect, resource, failure and concurrency boundaries.
- Decode untrusted data with `Schema.decodeUnknownEffect`. Prefer `Schema.Struct`
  for records and tagged errors for expected failures. Preserve public error
  classes, constructor behavior, fields, messages and `instanceof` through the
  compatibility facade; test rejection identity with the pinned runtime.
- Adapt rejecting third-party Promise APIs with `Effect.tryPromise` and explicit
  error classification. Pass cancellation to transports that support it. Do not
  use `Effect.promise` to turn ordinary operational failures into defects.
- Own resources through scopes and finalizers. Long-lived runtimes and background
  fibers need explicit ownership/disposal; retries must not leak timers, listeners
  or processes.
- Retry only at the narrowest boundary with proven idempotency. Bound backoff
  and use jitter. Transaction submission, signing, nonce refresh and confirmation
  polling are separate policies; never blindly retry the whole transaction.
- Preserve the existing React hooks/provider surface and React 18 compatibility.
  Atom bindings are a separate design decision, not a prerequisite for this rewrite.

## v4 traps

Read the installed source and current migration notes rather than copying v3
examples. `Context.Service` replaces `Context.Tag` and `Effect.Service`;
`Layer.effect` builds explicit layers; `Effect.catch` replaces `catchAll`;
`Effect.callback` replaces the old async constructor; and runtime runners accept
Contexts instead of v3 `Runtime<R>`. Schema optionality and decoding APIs also
changed. In RC.118, imports such as `effect/unstable/http` no longer exist: use
`effect/http`. Stability is documented with API annotations, and removing the
`unstable` path does not make those APIs stable.

## Primary references

- [Effect package versions](https://www.npmjs.com/package/effect?activeTab=versions)
- [Effect v4 release candidate](https://effect.website/blog/releases/effect/40-rc)
- [Official migration map](https://github.com/Effect-TS/effect/blob/main/MIGRATION.md)
- [Services](https://github.com/Effect-TS/effect/blob/main/migration/services.md)
- [Schema migration](https://github.com/Effect-TS/effect/blob/main/migration/schema.md)
- [Runtime migration](https://github.com/Effect-TS/effect/blob/main/migration/runtime.md)
- [Effect-tsgo setup and compatibility](https://github.com/Effect-TS/tsgo/blob/main/README.md)
- [Official Effect/Oxlint integration](https://github.com/Effect-TS/tsgo/blob/main/docs/README.md)
- [Pinned tooling compatibility manifest](https://github.com/Effect-TS/tsgo/blob/%40effect/tsgo%400.47.0/_packages/tsgo/upstream.json)
- [Oxfmt configuration](https://oxc.rs/docs/guide/usage/formatter/config)
- [Oxlint type-aware linting](https://oxc.rs/docs/guide/usage/linter/type-aware)
- [Kit Langton's Effect v4 guide](https://github.com/kitlangton/skills/blob/main/skills/effect/SKILL.md)
- [Kit's services/layers guidance](https://github.com/kitlangton/skills/blob/main/skills/effect/references/SERVICES_LAYERS.md)
- [Kit's schema guidance](https://github.com/kitlangton/skills/blob/main/skills/effect/references/SCHEMA.md)
- [Kit's scheduling guidance](https://github.com/kitlangton/skills/blob/main/skills/effect/references/SCHEDULING.md)

Kit's guide is an opinionated application reference. The installed Effect API and
near-kit's public SDK contracts take precedence over application-specific style
choices such as self-reexporting module namespaces.
