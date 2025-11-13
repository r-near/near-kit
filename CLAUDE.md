# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Version Control: Jujutsu

This repository uses [Jujutsu](https://github.com/martinvonz/jj) for version control. Jujutsu uses Git as a backend (in `.jj/` directory), so git commands still work, but prefer jj commands for a better experience.

### Mental Model

Understanding jj's mental model is critical:

1. **Working copy (`@`)**: Your current revision where file edits automatically appear
2. **Revisions, not commits**: jj tracks mutable "changes" (with stable IDs) that map to Git commits (with changing hashes)
3. **No staging area**: All file edits immediately become part of `@`
4. **Empty revisions auto-abandon**: If you create an empty revision and move away without describing it, jj automatically removes it
5. **Bookmarks, not branches**: Bookmarks are manual pointers to revisions (like Git tags) - they don't auto-advance

### Essential Commands

```bash
# View state
jj status                 # Show working copy changes (like git status)
jj diff                   # Show diff of current changes
jj log                    # Show revision history graph

# Most important commands
jj commit -m "message"    # Describe current changes + create new empty revision on top
jj new <revision>         # Create new empty revision on top of <revision>
jj describe -m "message"  # Add/update description of current revision (without moving)

# Navigation
jj edit <revision>        # Move working copy to edit an existing revision

# Undo anything
jj undo                   # Undo last operation
jj op log                 # View all operations
jj op restore <id>        # Restore to specific operation

# Sync with remote
jj git fetch              # Fetch from remote
jj git push               # Push bookmarks to remote
```

### Semantic Commit Format (REQUIRED)

**ALWAYS use semantic commits** following Conventional Commits:

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style/formatting changes
- `refactor`: Code refactoring (no behavior change)
- `perf`: Performance improvements
- `test`: Test changes
- `build`: Build system or dependency changes
- `ci`: CI configuration changes
- `chore`: Other changes (tooling, etc.)

### Claude's Primary Workflow: Commit As You Go

**This is the recommended workflow for 90% of cases.** It's simple, predictable, and works like `git commit`:

```bash
# 1. Check where you are
jj log

# 2. Make file edits (they automatically go into @)
<edit files>

# 3. Review changes
jj status
jj diff

# 4. Commit with semantic message (describes current + creates new empty revision)
jj commit -m "feat(client): add Near.view() method

Implement read-only contract view calls with automatic
type inference and zero gas cost."

# 5. Continue working - you're now in a new empty revision
<edit more files>

# 6. Commit again
jj commit -m "test(client): add tests for Near.view()"

# 7. Repeat as needed
```

**Key insight:** `jj commit` = `jj describe` + `jj new` combined. It's your main command.

### Advanced: Squash Workflow

Use this when you want to **plan work before implementing it**:

```bash
# 1. Describe what you're going to do (current revision is empty)
jj describe -m "feat(keys): implement encrypted keystore"

# 2. Create new empty revision on top to work in
jj new

# 3. Make changes (they go into @, which is now above your described revision)
<edit files>

# 4. Move changes down into the described revision
jj squash                 # Moves ALL changes from @ into parent
# OR
jj squash src/keys.ts     # Moves specific file(s) into parent

# 5. You're back to empty revision, can continue working
<edit more files>
jj squash

# 6. When done, move to next unit of work
jj commit -m "next change"
```

**Important limitations in AI environment:**
- **No interactive commands**: `-i` flag (interactive mode) doesn't work
- `jj squash` without arguments moves ALL changes, or use `jj squash <files>` for specific files
- Cannot interactively select hunks within files
- If you need fine-grained control, use the commit workflow instead

### Working with Bookmarks (Branches)

Bookmarks are manual pointers - they don't auto-advance like Git branches:

```bash
# Create bookmark pointing to current revision
jj bookmark create feature-name

# Move bookmark to different revision
jj bookmark move feature-name --to <revision>

# Push bookmark to remote
jj git push -b feature-name

# Track remote bookmarks
jj bookmark track main@origin

# List bookmarks
jj bookmark list
```

### Common Operations

**Start new feature from main:**
```bash
jj git fetch
jj new main              # Create new revision on top of main
<edit files>
jj commit -m "feat: new feature"
jj bookmark create my-feature
jj git push -b my-feature --allow-new
```

**Amend current revision (no need for --amend flag):**
```bash
<edit files>
jj diff                  # Changes are automatically in @
jj commit -m "updated message"  # Describe and move on
```

**Create revision in the middle of history:**
```bash
jj new <base-revision>   # Create new revision on top of base
<edit files>
jj commit -m "new change"
# All descendants automatically rebased!
```

**Navigate history:**
```bash
jj log                   # See full history
jj new <revision-id>     # Jump to any revision
jj edit <revision-id>    # Edit existing revision (be careful!)
```

### Critical Rules for AI Agents

1. **Always check `jj log` before starting work** - Know where you are
2. **Use `jj commit` as your primary command** - It's the simplest workflow
3. **File edits always go into `@`** - There's no staging area
4. **Empty revisions auto-abandon** - Don't worry about them littering history
5. **You can always `jj undo`** - Operations are safe and reversible
6. **Bookmarks must be manually moved** - Use `jj bookmark move` after updates
7. **Interactive commands don't work** - No `-i`, `-p`, or TUI prompts
8. **Semantic commits are mandatory** - Use conventional commit format always

### Quick Decision Guide

**When to use `jj commit`:**
- ✅ You've made changes and want to move on (95% of the time)
- ✅ You're working linearly and know what you're building
- ✅ You want the simplest workflow

**When to use squash workflow:**
- ✅ You want to describe intent before implementing
- ✅ You're building up a complex change in pieces
- ✅ You want to separate "what" from "how"

**When to use `jj edit`:**
- ⚠️  You need to modify an existing revision in history
- ⚠️  Be careful - this can create conflicts in descendants

## Project Overview

This is a TypeScript library for interacting with NEAR Protocol, designed to be simple and intuitive - like a modern fetch library.

### Core Principles

- **Simple things should be simple** - One-line commands for common operations
- **Type safety everywhere** - Full TypeScript support with IDE autocomplete
- **Human-readable** - Use "10 NEAR" not "10000000000000000000000000" (yoctoNEAR)
- **Progressive complexity** - Basic API for simple needs, advanced features when required
- **Fetch-like** - Familiar patterns for JavaScript developers

## Development

### Setup

```bash
bun install
```

### Running

```bash
bun run index.ts
```

### Testing

```bash
bun test                  # Run all tests
bun test <file>          # Run specific test file
```

## Architecture

### Core API Structure

The library is built around a main `Near` class with three interaction patterns:

1. **Simple operations** - Direct methods like `near.view()`, `near.call()`, `near.send()`
2. **Transaction builder** - Fluent API via `near.transaction()` for complex multi-action transactions
3. **Type-safe contracts** - `near.contract<T>()` for typed contract interfaces

### Key Components

**Client Initialization** (`new Near()`)
- Handles network configuration (mainnet/testnet/localnet/custom)
- Manages key storage (file-based, in-memory, encrypted)
- Wallet integration (browser)
- Auto-gas estimation (enabled by default)

**Transaction Builder** (`near.transaction()`)
- Fluent API for chaining actions: transfer, createAccount, deployContract, functionCall, etc.
- Returns builder with `.send()`, `.build()`, `.simulate()` methods
- Handles gas estimation and signing

**Contract Interface** (`near.contract<T>()`)
- Splits contract methods into `view` (read-only) and `call` (write)
- Full TypeScript inference for method parameters and return types
- Optional ABI-based type generation

**Key Management**
- `FileKeyStore` - File-based storage (Node.js)
- `InMemoryKeyStore` - Runtime storage
- `EncryptedKeyStore` - Encrypted storage with password
- Custom signers via `signer` option

**Error Handling**
- Typed errors: `InsufficientBalanceError`, `FunctionCallError`, `NetworkError`, etc.
- Each error includes relevant context (required amounts, method names, retry capability)

### Unit Handling Philosophy

All amounts accept human-readable formats:
- Input: `"10"`, `10`, `"10 NEAR"` (all equivalent)
- Internally converted to yoctoNEAR for RPC
- Return values in human-readable format by default

Gas accepts: `"30 Tgas"` or raw numbers

### Type Safety Strategy

Three approaches for contract typing:

1. **Manual interfaces** - Define TypeScript interface with `view` and `call` methods
2. **ABI generation** - Generate types from contract ABI
3. **Runtime validation** - Optional validation in development mode

## Testing Utilities

Provide mock implementations via `Near.mock()`:
- Mock accounts with balances
- Mock contract methods
- No network calls in tests
