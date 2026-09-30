# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

near-kit is a TypeScript monorepo for interacting with NEAR Protocol, designed to be simple and intuitive - like a modern fetch library.

**Packages:**

- `near-kit` - Core TypeScript library for NEAR Protocol interactions
- `@near-kit/react` - React bindings with hooks and providers

**Core Principles:**

- **Simple things should be simple** - One-line commands for common operations
- **Type safety everywhere** - Full TypeScript support with IDE autocomplete
- **Human-readable** - Use "10 NEAR" not "10000000000000000000000000" (yoctoNEAR)
- **Progressive complexity** - Basic API for simple needs, advanced features when required

## Monorepo Structure

```
near-kit/
├── packages/
│   ├── near-kit/          # Core library
│   │   ├── src/
│   │   ├── tests/
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── react/             # React bindings
├── package.json           # Root workspace config
├── tsconfig.json          # Shared TypeScript config
├── .oxlintrc.json          # Oxlint + Effect type-aware diagnostics
└── .oxfmtrc.json           # Shared formatting config
```

## Development Commands

### Setup

```bash
bun install --frozen-lockfile
```

### Testing

Tests use [Vitest](https://vitest.dev/) (not Bun's test runner) which runs tests in parallel per-file for faster integration test execution.

```bash
# Run all tests across all packages
bun run test

# Run built-package browser E2E (install official Playwright browsers first)
bun run test:browser

# Run tests for a specific package
bun run --filter near-kit test

# Run specific test types (from packages/near-kit)
cd packages/near-kit
bun run test:unit               # Unit tests only
bun run test:integration        # Integration tests only
```

### Building & Type Checking

```bash
bun run build              # Build all packages
bun run typecheck          # Type check all packages
bun run lint               # Oxlint + Effect type-aware diagnostics (read-only)
bun run format             # Format all packages with Oxfmt
bun run format:check       # Check formatting without writing
bun run check              # Build, source/consumer/example types, lint, and formatting check
```

### Package-specific commands

```bash
bun run --filter near-kit build      # Build specific package
bun run --filter near-kit typecheck  # Typecheck specific package
```

## Changesets

This project uses [changesets](https://github.com/changesets/changesets) for version management across packages.

**IMPORTANT:** When making changes that should be included in the next release, you MUST create a changeset file manually. The interactive CLI (`bun changeset`) does not work in AI environments.

### Creating a Changeset

Create a new markdown file in `.changeset/` directory:

```bash
# File: .changeset/descriptive-name.md
---
"near-kit": patch  # or "minor" or "major"
---

Brief description of the change
```

For changes affecting multiple packages:

```markdown
---
"near-kit": minor
"@near-kit/react": minor
---

Add new feature across core and react packages
```

**Change types:**

- `patch` - Bug fixes, minor improvements (0.0.X)
- `minor` - New features, backwards-compatible (0.X.0)
- `major` - Breaking changes (X.0.0)

## Architecture

### Core API Structure

The library is built around a main `Near` class with three interaction patterns:

1. **Simple operations** - Direct methods: `near.view()`, `near.call()`, `near.send()`
2. **Transaction builder** - Fluent API: `near.transaction()` for multi-action transactions
3. **Type-safe contracts** - Typed proxies: `near.contract<T>()` with full IDE autocomplete

### Key Modules (packages/near-kit/src/)

**`core/near.ts` - Main Client**

- Public Promise projection of the native service in `effect/near.ts`
- Native acquisition owns configuration, RPC, keys, wallet and readiness once
- Eager public key initialization; lazy native acquisition
- Explicit service/transport injection, not built-in method interception

**`core/transaction.ts` - TransactionBuilder**

- Fluent API for chaining actions: `transfer()`, `functionCall()`, `createAccount()`, etc.
- Edits one transaction plan; Promise terminals project the native transaction engine
- Signed cache belongs to the captured plan, never to aliased mutable action data
- Public `.build()` retains its legacy unsigned shape; `.sign()` and `.send()` prepare their own snapshots
- Supports delegate actions (NEP-366) via `.delegate()`

**`effect/transaction.ts` - Transaction Values and Execution**

- Native data plans and module operations, without a second fluent builder
- Captures canonical unsigned bytes before invoking external signers
- Owns signing, versioned unsigned snapshots, submission and delegate preparation
- Signs once per intent; never authorizes a fresh nonce from a submission rejection
- Ambiguous submission reconciles the original hash; unknown status never authorizes fresh signing
- Immutable signed values and the public signed cache support safe same-byte replay

**`core/rpc/` - RPC Client**

- Low-level NEAR JSON-RPC interface
- Bounded schedules with exponential backoff (default: 4 retries, 1s initial delay)
- Submission retries retain exact bytes and sticky uncertainty; read retries stay independent
- Optional Effect HttpClient integration is isolated from ordinary fetch clients
- Error classification and mapping to typed exceptions
- One Effect Schema protocol owner; response types are inferred from it
- Named operations are module-scoped; construction binds dependencies once

**`effect/nonce.ts` - Concurrent Transaction Support**

- Ref-owned nonce reservation service with per-key serialization
- Generation guards protect invalidation against stale in-flight reads
- Reservation state is not a TTL cache: eviction can reuse an in-flight nonce
- Native dependencies are injected; public clients share the default allocator

**`keys/` - Key Management**

- `InMemoryKeyStore` - Ephemeral runtime storage
- `FileKeyStore` - NEAR-CLI compatible file storage (`~/.near-credentials/`)
- `NativeKeyStore` - OS keyring integration (macOS Keychain, Windows Credential Manager)
- `RotatingKeyStore` - High-throughput concurrent transactions (round-robin key rotation)

**`contracts/contract.ts` - Type-Safe Contract Interface**

- Dynamic proxy creation for typed contract methods
- Splits methods into `view` (free) and `call` (costs gas)
- Full TypeScript inference and IDE autocomplete

**`errors/` - Error Hierarchy**

- Public domain errors extend `NearError`; native decoding uses `SchemaError`
- Promise-only extension errors are tagged and unwrapped only at the public boundary
- Categories: Blockchain state, transaction failures, contract execution, network issues, validation
- `retryable` flag indicates safe-to-retry operations

**`sandbox/` - Local Testing**

- Starts local NEAR node for testing
- Auto-downloads correct binary for platform
- Provides root account with full access key
- Lifecycle management: startup, cleanup, temporary directories
- State manipulation: `patchState()`, `fastForward()`, `dumpState()`, `restoreState()`
- File-based snapshots: `saveSnapshot()`, `loadSnapshot()`
- Full restart with optional genesis snapshot: `restart()`
- Exports `StateRecord`, `StateSnapshot` types and `EMPTY_CODE_HASH` constant

### Design Patterns

**Composition Over Inheritance**

- KeyStore interface enables pluggable storage implementations
- WalletConnection supports multiple wallet adapters
- Signer function allows custom signing (hardware wallets, KMS)

**Type-Driven Configuration**

- Effect Schema owns internal config/protocol validation; ConfigProvider owns environment input
- Documented Zod composition schemas remain in their public schema/credential entrypoints
- Template literal types for `PrivateKey` enforce format at compile time
- Explicit units required ("10 NEAR" vs raw yocto)

**Automatic Nonce Management**

- `NonceReservation` coordinates native transaction dependencies
- Reserves unique nonces for concurrent preparation within one shared allocation domain
- Submitted commitments are never automatically rebuilt with a fresh nonce

**Error Recovery**

- Bounded Effect schedules for retryable network transients
- Retry only identical signed bytes; reconcile all nonce rejections by exact hash
- High-level uncertainty is nonretryable; generic Effect.retry(send(plan)) creates new commitments and is unsafe after submission

**Separation of Concerns**

- RPC Client: Low-level JSON-RPC with error mapping
- Transaction Builder: High-level action chaining with signing
- Near Client: Orchestration and simplified API
- Error Handler: RPC error parsing and classification

### Unit Handling

All amounts accept human-readable formats:

- Use explicit units such as `"10 NEAR"`; raw bigint amounts mean yoctoNEAR
- Internally converted to yoctoNEAR for RPC
- Gas: use explicit units such as `"30 Tgas"` or the typed Gas helpers

### Testing Structure

**Integration tests** use Sandbox for blockchain interaction:

```typescript
describe("Feature", () => {
  let sandbox: Sandbox
  let near: Near

  beforeAll(async () => {
    sandbox = await Sandbox.start()
    near = new Near({ network: sandbox })
  }, 60000) // Sandbox startup can take time

  test("should do X", async () => {
    const account = `test-${Date.now()}.${sandbox.rootAccount.id}`

    await near
      .transaction(sandbox.rootAccount.id)
      .createAccount(account)
      .transfer(account, "1 NEAR")
      .send()

    // Assertions...
  })

  afterAll(async () => {
    await sandbox.stop()
  })
})
```

**Key patterns:**

- Generate unique account names using timestamp
- Use root account for setup operations
- Test isolation via separate accounts per test

## Distribution

**Package exports** (`packages/near-kit/package.json`):

- Main: `/` (all public APIs)
- Subpaths: `/keys`, `/sandbox`, `/keys/file`, `/keys/native`
- Node.js-only exports (FileKeyStore, NativeKeyStore) require explicit import paths
- Browser-safe by default (excludes Node.js dependencies)

## Documentation

Documentation lives in the `docs/` folder. When making changes to the library (especially API changes, new features, or configuration changes), update the corresponding docs in the same PR.

Common scenarios requiring doc updates:

- New public APIs or methods
- Changes to configuration options
- New features or capabilities
- Breaking changes
- Updated examples or usage patterns

## For Coding Agents (Copilot, etc.)

If you are an AI coding agent working independently (e.g., GitHub Copilot coding agent), you **MUST** complete these verification steps before creating or updating a pull request:

```bash
bun run lint       # Lint and auto-fix code style issues
bun run typecheck  # Ensure no TypeScript type errors
```

**CRITICAL:** Do not create a PR or push code with lint or type errors. These checks are enforced by CI and will cause the PR to fail. If checks fail, run the commands locally, fix the reported issues, and commit the fixes.

## Git Workflow & Pull Requests

When asked to "make a PR" or "create a pull request", follow this workflow:

### 1. Create a branch

```bash
git checkout -b <type>/<descriptive-name>
# Examples:
# git checkout -b feat/add-batch-operations
# git checkout -b fix/nonce-race-condition
# git checkout -b refactor/remove-unused-fields
```

### 2. Commit changes with semantic commits

```bash
git add <files>
git commit -m "<type>(<scope>): <subject>

<body>"
```

### 3. Verify lint and type checks pass

```bash
bun run lint       # Fix any linting issues
bun run typecheck  # Ensure no type errors
```

**IMPORTANT:** Always run these before pushing. Do not push code with lint or type errors.

### 4. Push the branch

```bash
git push -u origin <branch-name>
```

### 5. Create PR using GitHub CLI

```bash
gh pr create --title "<type>(<scope>): <subject>" --body "$(cat <<'EOF'
## Summary

- Brief bullet points of what changed
- Keep it simple and direct

## Test plan

- [ ] Tests pass
EOF
)"
```

**IMPORTANT:**

- Keep PR descriptions simple and direct - avoid verbosity
- Use concise bullet points
- Don't explain obvious things or repeat information from the title

## Semantic Commits

**ALWAYS use semantic commits** following Conventional Commits:

```
<type>(<scope>): <subject>

<body>
```

**Types:**

- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation changes
- `refactor` - Code refactoring (no behavior change)
- `test` - Test changes
- `perf` - Performance improvements
- `build` - Build system or dependency changes
- `ci` - CI configuration changes
- `chore` - Other changes (tooling, etc.)

**Examples:**

```
feat(client): add batch() method for parallel operations
fix(nonce): handle concurrent nonce fetch requests
docs(readme): update wallet integration examples
refactor(config): remove unused network fields
test(transaction): add delegate action tests
```
