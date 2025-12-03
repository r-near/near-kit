# Copilot Instructions

This file provides guidance to GitHub Copilot when working with code in this repository.

## Project Overview

near-kit is a TypeScript library for interacting with NEAR Protocol, designed to be simple and intuitive - like a modern fetch library.

**Core Principles:**

- **Simple things should be simple** - One-line commands for common operations
- **Type safety everywhere** - Full TypeScript support with IDE autocomplete
- **Human-readable** - Use "10 NEAR" not "10000000000000000000000000" (yoctoNEAR)
- **Progressive complexity** - Basic API for simple needs, advanced features when required

## Development Commands

### Setup

```bash
bun install
```

### Testing

```bash
bun test                    # Run all tests
bun test <file>             # Run specific test file
bun test tests/unit/        # Run unit tests only
bun test tests/integration/ # Run integration tests only
```

### Building & Type Checking

```bash
bun run build              # Build TypeScript to dist/
bun run dev                # Watch mode (tsc --watch)
bun run typecheck          # Strict type checking
bun run lint               # Lint and format with Biome
```

## Changesets

This project uses [changesets](https://github.com/changesets/changesets) for version management.

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

### Key Modules

- **`src/core/near.ts`** - Main client and entry point
- **`src/core/transaction.ts`** - TransactionBuilder with fluent API
- **`src/core/rpc/`** - Low-level NEAR JSON-RPC interface
- **`src/core/nonce-manager.ts`** - Concurrent transaction support
- **`src/keys/`** - Key management (InMemoryKeyStore, FileKeyStore, NativeKeyStore, RotatingKeyStore)
- **`src/contracts/contract.ts`** - Type-safe contract interface
- **`src/errors/`** - Error hierarchy extending `NearError`
- **`src/sandbox/`** - Local testing with NEAR sandbox

### Design Patterns

- **Composition Over Inheritance** - Pluggable interfaces for keystores, wallets, signers
- **Type-Driven Configuration** - Zod schemas for runtime validation and TypeScript types
- **Automatic Nonce Management** - `NonceManager` with local caching
- **Error Recovery** - Retry logic with exponential backoff

### Unit Handling

All amounts accept human-readable formats:

- Input: `"10"`, `10`, `"10 NEAR"` (all equivalent)
- Internally converted to yoctoNEAR for RPC
- Gas: `"30 Tgas"` or raw numbers

## Testing Structure

**Integration tests** use Sandbox for blockchain interaction:

```typescript
describe("Feature", () => {
  let sandbox: Sandbox
  let near: Near

  beforeAll(async () => {
    sandbox = await Sandbox.start()
    near = new Near({ network: sandbox })
  }, 60000) // 60 second timeout - Sandbox startup can take time

  test("should do X", async () => {
    const account = `test-${Date.now()}.${sandbox.rootAccount.id}`
    // Test implementation...
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

**Package exports** (`package.json`):

- Main: `/` (all public APIs)
- Subpaths: `/keys`, `/sandbox`, `/keys/file`, `/keys/native`
- Node.js-only exports (FileKeyStore, NativeKeyStore) require explicit import paths
- Browser-safe by default (excludes Node.js dependencies)

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
```

## Code Style

- Use Biome for linting and formatting
- Follow existing patterns in the codebase
- Always run `bun run lint` and `bun run typecheck` before committing
