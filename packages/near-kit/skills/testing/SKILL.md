---
name: testing
description: Set up and use Sandbox for local integration testing — start/stop lifecycle, patch blockchain state with patchState(), fast-forward blocks with fastForward(), save/restore snapshots, and handle test isolation with unique account names using timestamps. Covers Sandbox as a network config target.
type: lifecycle
library: near-kit
library_version: "0.14.0"
sources:
  - r-near/near-kit:docs/dapp-workflow/testing.mdx
  - r-near/near-kit:packages/near-kit/src/sandbox/sandbox.ts
requires:
  - client-setup
see_also:
  - client-setup
---

# Setup

Start a Sandbox instance and connect the Near client to it. Sandbox downloads a local NEAR binary, starts a node, and provides a root account with a massive balance for creating sub-accounts.

```typescript
import { Near } from "near-kit"
import { Sandbox, EMPTY_CODE_HASH } from "near-kit/sandbox"
import type { StateRecord, StateSnapshot } from "near-kit/sandbox"
import { beforeAll, afterAll, test, expect } from "vitest"

let sandbox: Sandbox
let near: Near

beforeAll(async () => {
  sandbox = await Sandbox.start()
  near = new Near({ network: sandbox })
}, 60000)

afterAll(async () => {
  if (sandbox) await sandbox.stop()
})
```

Sandbox exposes three properties used to configure the Near client and create test accounts:

```typescript
sandbox.rpcUrl
sandbox.networkId
sandbox.rootAccount
```

`rootAccount` contains the pre-funded root account (`test.near`):

```typescript
const root = sandbox.rootAccount
root.id
root.secretKey
```

When `network: sandbox` is passed to `Near`, the constructor auto-detects the sandbox root account key and adds it to the internal keystore. You do not need to pass `privateKey` or `defaultSignerId` separately.

# Core Patterns

## 1) Basic test setup with root account

Create sub-accounts under the root account for test isolation. Always use `Date.now()` to generate unique names.

```typescript
import { Near } from "near-kit"
import { Sandbox } from "near-kit/sandbox"
import { beforeAll, afterAll, test, expect } from "vitest"

let sandbox: Sandbox
let near: Near

beforeAll(async () => {
  sandbox = await Sandbox.start()
  near = new Near({ network: sandbox })
}, 60000)

afterAll(async () => {
  if (sandbox) await sandbox.stop()
})

test("can create and fund a sub-account", async () => {
  const account = `test-${Date.now()}.${sandbox.rootAccount.id}`

  await near
    .transaction(sandbox.rootAccount.id)
    .createAccount(account)
    .transfer(account, "1 NEAR")
    .send()

  const exists = await near.accountExists(account)
  expect(exists).toBe(true)
})
```

## 2) Patching state without transactions

Use `patchState()` to directly modify blockchain state — account balances, access keys, contract code, and contract storage — without sending transactions. Amounts in `StateRecord` use yoctoNEAR (raw string of digits).

```typescript
import { EMPTY_CODE_HASH } from "near-kit/sandbox"
import type { StateRecord } from "near-kit/sandbox"

test("can patch account balance", async () => {
  const accountId = `alice.${sandbox.rootAccount.id}`

  const records: StateRecord[] = [
    {
      Account: {
        account_id: accountId,
        account: {
          amount: "5000000000000000000000000",
          locked: "0",
          code_hash: EMPTY_CODE_HASH,
          storage_usage: 100,
        },
      },
    },
    {
      AccessKey: {
        account_id: accountId,
        public_key: "ed25519:...",
        access_key: {
          nonce: 0,
          permission: "FullAccess",
        },
      },
    },
  ]

  await sandbox.patchState(records)

  const balance = await near.getBalance(accountId)
  expect(parseFloat(balance)).toBeGreaterThan(0)
})
```

StateRecord variants:

| Record type  | Fields                                                |
| ------------ | ----------------------------------------------------- |
| `Account`    | `account_id`, `account.amount`, `account.locked`, `account.code_hash`, `account.storage_usage` |
| `AccessKey`  | `account_id`, `public_key`, `access_key.nonce`, `access_key.permission` |
| `Contract`   | `account_id`, `code` (base64 WASM)                    |
| `Data`       | `account_id`, `data_key` (base64), `value` (base64)   |

`patchState()` waits for the next block to be produced before returning, so subsequent reads see the patched state immediately.

## 3) Fast-forwarding blocks for time-dependent logic

Use `fastForward()` to advance the blockchain by producing empty blocks. Useful for testing lockups, vesting schedules, or any time-dependent contract logic without waiting.

```typescript
test("time-dependent contract state", async () => {
  await sandbox.fastForward(100)

  const result = await near.view("lockup.test.near", "is_unlocked")
  expect(result).toBe(true)
})
```

`fastForward()` accepts a positive integer and polls until the block height reaches the target. Timeout scales with the number of blocks (minimum 30s).

## 4) Snapshot save/restore between tests

Use `dumpState()` to capture the full blockchain state, then `restoreState()` to reset between test scenarios. Great for running multiple tests against the same initial state.

```typescript
let snapshot: StateSnapshot

beforeAll(async () => {
  sandbox = await Sandbox.start()
  near = new Near({ network: sandbox })

  await near
    .transaction(sandbox.rootAccount.id)
    .createAccount(`setup.${sandbox.rootAccount.id}`)
    .transfer(`setup.${sandbox.rootAccount.id}`, "5 NEAR")
    .send()

  snapshot = await sandbox.dumpState()
}, 60000)

test("scenario A", async () => {
  await sandbox.restoreState(snapshot)
})

test("scenario B", async () => {
  await sandbox.restoreState(snapshot)
})
```

For persisting snapshots across test runs, use file-based snapshots:

```typescript
const snapshotPath = await sandbox.saveSnapshot()

const snapshot = await sandbox.loadSnapshot(snapshotPath)
await sandbox.restoreState(snapshot)
```

For a complete state reset (block height returns to 0), use `restart()`:

```typescript
await sandbox.restart()

const snapshot = await sandbox.dumpState()
await sandbox.restart(snapshot)
```

`restart()` with a snapshot merges records into the genesis file, making those accounts exist from block 0. This is more reliable than `restoreState()` which patches on top of existing state.

# Common Mistakes

## HIGH: Not increasing test timeout for Sandbox startup

Sandbox downloads a binary (first run), initializes a temporary directory, and starts a local node. This can take 30–60 seconds. Without an explicit timeout, the test runner will time out at its default (often 5–10 seconds).

```typescript
// WRONG — default timeout too short
beforeAll(async () => {
  sandbox = await Sandbox.start()
  near = new Near({ network: sandbox })
})

// CORRECT — set timeout to 60000ms
beforeAll(async () => {
  sandbox = await Sandbox.start()
  near = new Near({ network: sandbox })
}, 60000)
```

Also applies to individual tests that perform expensive setup (deploying contracts, large state patches).

## MEDIUM: Using duplicate account names across tests

Sub-accounts are persisted across tests within the same Sandbox instance. If two tests create `test.test.near`, the second test will fail because the account already exists.

```typescript
// WRONG — same name every time
test("first", async () => {
  const account = `test.${sandbox.rootAccount.id}`
  await near.transaction(sandbox.rootAccount.id).createAccount(account).send()
})

test("second", async () => {
  const account = `test.${sandbox.rootAccount.id}`
  await near.transaction(sandbox.rootAccount.id).createAccount(account).send()
})

// CORRECT — unique name per test
test("first", async () => {
  const account = `test-${Date.now()}.${sandbox.rootAccount.id}`
  await near.transaction(sandbox.rootAccount.id).createAccount(account).send()
})

test("second", async () => {
  const account = `test-${Date.now()}.${sandbox.rootAccount.id}`
  await near.transaction(sandbox.rootAccount.id).createAccount(account).send()
})
```

Alternatively, use `restoreState()` or `restart()` between tests to reset to a known clean state.
