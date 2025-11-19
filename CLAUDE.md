# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

**Example:**

```markdown
---
"near-kit": minor
---

Add support for batch transaction operations via near.batch()
```

## Architecture

### Core API Structure

The library is built around a main `Near` class with three interaction patterns:

1. **Simple operations** - Direct methods: `near.view()`, `near.call()`, `near.send()`
2. **Transaction builder** - Fluent API: `near.transaction()` for multi-action transactions
3. **Type-safe contracts** - Typed proxies: `near.contract<T>()` with full IDE autocomplete

### Key Modules

**`src/core/near.ts` - Main Client**

- Central entry point for all operations
- Configuration resolution (networks, keystores, signers, wallets)
- Async keystore initialization support
- Auto-detects sandbox root account keys

**`src/core/transaction.ts` - TransactionBuilder**

- Fluent API for chaining actions: `transfer()`, `functionCall()`, `createAccount()`, etc.
- Signing pipeline: `.build()` → `.sign()` → `.send()`
- Automatic nonce management with retry logic (3x for InvalidNonceError)
- Supports delegate actions (NEP-366) via `.delegate()`

**`src/core/rpc/` - RPC Client**

- Low-level NEAR JSON-RPC interface
- Automatic retries with exponential backoff (default: 4 retries, 1s initial delay)
- Error classification and mapping to typed exceptions
- Zod schema validation for all RPC responses

**`src/core/nonce-manager.ts` - Concurrent Transaction Support**

- Prevents nonce collisions for concurrent transactions
- Local nonce caching with deduplication
- Invalidation support for retry scenarios
- Shared static instance used by TransactionBuilder

**`src/keys/` - Key Management**

- `InMemoryKeyStore` - Ephemeral runtime storage
- `FileKeyStore` - NEAR-CLI compatible file storage (`~/.near-credentials/`)
- `NativeKeyStore` - OS keyring integration (macOS Keychain, Windows Credential Manager)
- `RotatingKeyStore` - High-throughput concurrent transactions (round-robin key rotation)

**`src/contracts/contract.ts` - Type-Safe Contract Interface**

- Dynamic proxy creation for typed contract methods
- Splits methods into `view` (free) and `call` (costs gas)
- Full TypeScript inference and IDE autocomplete

**`src/errors/` - Error Hierarchy**

- All errors extend `NearError` with `code` and optional `data`
- Categories: Blockchain state, transaction failures, contract execution, network issues, validation
- `retryable` flag indicates safe-to-retry operations

**`src/sandbox/` - Local Testing**

- Starts local NEAR node for testing
- Auto-downloads correct binary for platform
- Provides root account with full access key
- Lifecycle management: startup, cleanup, temporary directories

### Design Patterns

**Composition Over Inheritance**

- KeyStore interface enables pluggable storage implementations
- WalletConnection supports multiple wallet adapters
- Signer function allows custom signing (hardware wallets, KMS)

**Type-Driven Configuration**

- Zod schemas provide both runtime validation and TypeScript types
- Template literal types for `PrivateKey` enforce format at compile time
- Explicit units required ("10 NEAR" vs raw yocto)

**Automatic Nonce Management**

- `NonceManager` with local caching prevents unnecessary RPC calls
- Handles concurrent transactions transparently
- Automatic retry with nonce invalidation for edge cases

**Error Recovery**

- Retry loop for network transients (exponential backoff)
- Special handling for `InvalidNonceError` (3x retries with fresh nonce)
- Retryable flag on error classes for application-level retry logic

**Separation of Concerns**

- RPC Client: Low-level JSON-RPC with error mapping
- Transaction Builder: High-level action chaining with signing
- Near Client: Orchestration and simplified API
- Error Handler: RPC error parsing and classification

### Unit Handling

All amounts accept human-readable formats:

- Input: `"10"`, `10`, `"10 NEAR"` (all equivalent)
- Internally converted to yoctoNEAR for RPC
- Gas: `"30 Tgas"` or raw numbers

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

**Package exports** (`package.json`):

- Main: `/` (all public APIs)
- Subpaths: `/keys`, `/sandbox`, `/keys/file`, `/keys/native`
- Node.js-only exports (FileKeyStore, NativeKeyStore) require explicit import paths
- Browser-safe by default (excludes Node.js dependencies)

## Documentation Repository

The documentation for near-kit is maintained in a separate repository at `~/near-kit-docs`.

**IMPORTANT:** When making changes to the library (especially API changes, new features, or configuration changes), check if corresponding documentation updates are needed in `~/near-kit-docs/src`.

Common scenarios requiring doc updates:
- New public APIs or methods
- Changes to configuration options
- New features or capabilities
- Breaking changes
- Updated examples or usage patterns

### Making Documentation PRs

When documentation updates are needed, create a corresponding PR in the docs repository:

1. Navigate to the docs repo: `cd ~/near-kit-docs`
2. Follow the same Git workflow:
   - Create a branch (e.g., `docs/update-config-options`)
   - Make documentation changes in `~/near-kit-docs/src`
   - Commit with semantic commit message
   - Push and create PR using `gh pr create`
3. Link the docs PR to the library PR in the description

**Example:**
```bash
cd ~/near-kit-docs
git checkout -b docs/remove-wallet-helper-urls
# Make changes to src/reference/configuration.md
git add src/reference/configuration.md
git commit -m "docs: remove walletUrl and helperUrl from configuration"
git push -u origin docs/remove-wallet-helper-urls
gh pr create --title "docs: remove walletUrl and helperUrl" --body "Updates docs for r-near/near-kit#67"
```

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
