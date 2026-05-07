---
name: error-handling
description: Catch and handle typed error classes with instanceof checks — FunctionCallError with panic messages and logs, InsufficientBalanceError with required/available amounts, NetworkError with retryable flag, InvalidNonceError with auto-retry, and 20+ other NearError subclasses.
type: core
library: near-kit
library_version: "0.14.0"
sources:
  - r-near/near-kit:docs/in-depth/error-handling.mdx
  - r-near/near-kit:packages/near-kit/src/errors/index.ts
requires: client-setup
---

# Error Handling

All near-kit errors extend `NearError` with a stable `code` string, optional `data` field, and in many cases a `retryable` flag. Use `instanceof` checks to handle specific failure modes.

## Setup

### Try/catch with instanceof checks

```typescript
import {
  NearError,
  FunctionCallError,
  AccountDoesNotExistError,
  NetworkError,
  InsufficientBalanceError,
} from "near-kit"

try {
  await near.call("contract.near", "method", {})
} catch (e) {
  if (e instanceof FunctionCallError) {
    console.log("Contract panicked:", e.panic)
    console.log("Logs:", e.logs)
  } else if (e instanceof AccountDoesNotExistError) {
    console.log("Account not found:", e.accountId)
  } else if (e instanceof NetworkError) {
    if (e.retryable) {
      console.log("Network error, safe to retry")
    }
  } else if (e instanceof NearError) {
    console.log("NEAR error:", e.code, e.message)
  }
}
```

## Core Patterns

### 1. Catching specific error types

Each error subclass carries structured properties beyond the message string. Use these for programmatic decisions, not string matching.

```typescript
import {
  FunctionCallError,
  InsufficientBalanceError,
  AccountDoesNotExistError,
  AccessKeyDoesNotExistError,
  InvalidAccountIdError,
  GasLimitExceededError,
  InvalidNonceError,
  InvalidTransactionError,
  TransactionTimeoutError,
  ContractNotDeployedError,
  WalletError,
  InvalidKeyError,
  SignatureError,
} from "near-kit"

try {
  await near.transaction("alice.near").functionCall("contract.near", "method", {}).send()
} catch (e) {
  if (e instanceof FunctionCallError) {
    console.log("Contract:", e.contractId)
    console.log("Method:", e.methodName)
    console.log("Panic:", e.panic)
    console.log("Logs:", e.logs)
  } else if (e instanceof InsufficientBalanceError) {
    console.log("Required:", e.required, "Available:", e.available)
  } else if (e instanceof AccountDoesNotExistError) {
    console.log("Missing account:", e.accountId)
  } else if (e instanceof GasLimitExceededError) {
    console.log("Used:", e.gasUsed, "Limit:", e.gasLimit)
  } else if (e instanceof InvalidNonceError) {
    console.log("Tx nonce:", e.txNonce, "Key nonce:", e.akNonce)
  } else if (e instanceof TransactionTimeoutError) {
    console.log("Tx hash:", e.transactionHash)
  } else if (e instanceof ContractNotDeployedError) {
    console.log("No contract on:", e.accountId)
  }
}
```

### 2. Using retryable flag for retry logic

Several error classes carry a `retryable` boolean indicating whether the operation is safe to retry with identical parameters.

**Always retryable** (hard-coded `retryable = true`):

| Error | Code | Reason |
|---|---|---|
| `InvalidNonceError` | `INVALID_NONCE` | Nonce collision — auto-retry with fresh nonce |
| `ShardUnavailableError` | `UNAVAILABLE_SHARD` | Try a different node |
| `NodeNotSyncedError` | `NOT_SYNCED` | Wait for sync or try different node |
| `TimeoutError` | `TIMEOUT_ERROR` | Resubmit identical transaction |
| `InternalServerError` | `INTERNAL_ERROR` | Node overloaded, try again |

**Conditionally retryable**:

| Error | Condition |
|---|---|
| `NetworkError` | `e.retryable` (set by constructor, default `true`) |
| `InvalidTransactionError` | `e.retryable` when `e.shardCongested` or `e.shardStuck` |

```typescript
import { NetworkError, InvalidTransactionError } from "near-kit"

async function sendWithRetry(fn: () => Promise<any>, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (e) {
      if (
        (e instanceof NetworkError && e.retryable) ||
        (e instanceof InvalidTransactionError && e.retryable)
      ) {
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)))
          continue
        }
      }
      throw e
    }
  }
}
```

Note: near-kit's RPC client already retries network transients with exponential backoff (4 retries, 1s initial delay). The `TransactionBuilder` also auto-retries `InvalidNonceError` up to 3 times. You only need application-level retry for errors that escape those built-in mechanisms.

### 3. Extracting contract panic messages

When a smart contract call fails, `FunctionCallError.panic` contains the contract's panic message. This is the single most useful field for debugging and user-facing error messages.

```typescript
import { FunctionCallError } from "near-kit"

try {
  await near.call("market.near", "buy", { item_id: "sword-1" })
} catch (e) {
  if (e instanceof FunctionCallError) {
    switch (e.panic) {
      case "ERR_NOT_ENOUGH_FUNDS":
        console.log("You don't have enough NEAR to buy this item")
        break
      case "ERR_ITEM_SOLD":
        console.log("This item has already been sold")
        break
      case "ERR_INVALID_ARGUMENT":
        console.log("Invalid item ID")
        break
      default:
        console.log("Transaction failed:", e.panic ?? e.message)
    }

    if (e.logs.length > 0) {
      console.log("Contract logs:", e.logs)
    }
  }
}
```

The `logs` array contains any log lines the contract emitted before the failure. These are often more detailed than the panic message.

## Common Mistakes

### HIGH: Catching generic Error instead of NearError subclasses

Catching `Error` loses all structured context (code, retryable, accountId, panic, etc.). You end up parsing message strings, which is fragile and error-prone.

```typescript
// WRONG — loses structured error context
try {
  await near.call("contract.near", "method", {})
} catch (e) {
  if ((e as Error).message.includes("Insufficient")) {
    // Fragile — message format may change between versions
  }
}

// CORRECT — instanceof checks with typed properties
try {
  await near.call("contract.near", "method", {})
} catch (e) {
  if (e instanceof InsufficientBalanceError) {
    console.log(e.required, e.available)
  }
}
```

### MEDIUM: Not checking retryable flag before retrying network errors

Not all `NetworkError` instances are safe to retry. A 400 Bad Request or 401 Unauthorized should NOT be retried — the same parameters will produce the same failure.

```typescript
// WRONG — retries all network errors unconditionally
try {
  await near.call("contract.near", "method", {})
} catch (e) {
  if (e instanceof NetworkError) {
    await retry() // May retry a 400 that will never succeed
  }
}

// CORRECT — check retryable flag
try {
  await near.call("contract.near", "method", {})
} catch (e) {
  if (e instanceof NetworkError && e.retryable) {
    await retry()
  }
}
```

`NetworkError.retryable` defaults to `true` but can be set to `false` for non-transient HTTP errors (4xx client errors). Always check the flag.

---

See also: [client-setup]
