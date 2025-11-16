# Integration Test Coverage Analysis & Improvement Plan

**Date:** 2025-11-15
**Baseline Coverage:** 64.41% functions / 69.96% lines → **67.09% functions / 71.99% lines** ✅
**Test Runtime:** ~5.5 minutes (335 seconds) → ~6.1 minutes (366 seconds)
**Tests Passing:** 130 tests across 11 files → **178 tests across 12 files** ✅
**Status:** **Phase 1 COMPLETE** 🎉

**⚠️ Note for Next Run:** Use 15-minute timeout for integration tests: `bun test tests/integration --coverage --timeout 900000`

---

## Executive Summary

Integration tests provide solid coverage of core RPC functionality, transaction signing, and contract interactions. However, **critical gaps exist in error handling, file-based key storage, and several transaction action types**. This document outlines prioritized improvements to increase integration test coverage with a focus on **RPC error scenarios** and **error class testing**.

**UPDATE (Phase 1 Complete):** Error handling coverage has been **dramatically improved** from 25% to 100% for `src/errors/index.ts`. All 28 error classes are now fully tested with comprehensive integration tests that trigger real errors through actual blockchain operations.

---

## Phase 1 Results - RPC Error Handling ✅ COMPLETE

**Goal:** Improve error coverage from 25% to >80%

**Achievement:** **EXCEEDED** - Achieved 100% function and line coverage!

### Coverage Improvements

| Module | Before | After | Improvement |
|--------|--------|-------|-------------|
| `src/errors/index.ts` (Functions) | 25.00% | **100%** | **+75%** 🚀 |
| `src/errors/index.ts` (Lines) | 54.97% | **100%** | **+45.03%** 🚀 |
| Overall Integration (Functions) | 64.41% | **67.09%** | **+2.68%** |
| Overall Integration (Lines) | 69.96% | **71.99%** | **+2.03%** |

### Implementation Summary

**Created:** `tests/integration/rpc-error-scenarios.test.ts` (48 tests)

- ✅ Network Errors (3 tests) - Invalid endpoints, status codes, retryability
- ✅ Account Errors (5 tests) - AccountDoesNotExist, AccessKeyDoesNotExist, InvalidAccount
- ✅ Transaction Errors (6 tests) - InsufficientBalance, InvalidNonce, ShardCongested/Stuck
- ✅ Contract Errors (9 tests) - FunctionCallError, ContractNotDeployed, GasLimitExceeded
- ✅ Block/Chunk/Epoch Errors (6 tests) - UnknownBlock, InvalidShardId, UnknownReceipt
- ✅ Node/Shard Errors (4 tests) - ShardUnavailable, NodeNotSynced
- ✅ Request/Timeout Errors (6 tests) - ParseError, TimeoutError, InternalServerError
- ✅ Signature/Wallet Errors (2 tests) - SignatureError, WalletError
- ✅ RPC Error Handler Edge Cases (3 tests) - Query errors, property verification, inheritance

### All Error Classes Now Tested

All 28 error classes in `src/errors/index.ts` are now instantiated and verified:

✅ NearError, InsufficientBalanceError, FunctionCallError, NetworkError, InvalidKeyError
✅ AccountDoesNotExistError, AccessKeyDoesNotExistError, InvalidAccountIdError
✅ SignatureError, GasLimitExceededError, TransactionTimeoutError, WalletError
✅ UnknownBlockError, InvalidAccountError, ShardUnavailableError, NodeNotSyncedError
✅ ContractNotDeployedError, ContractStateTooLargeError, ContractExecutionError
✅ UnknownChunkError, InvalidShardIdError, UnknownEpochError
✅ InvalidNonceError, InvalidTransactionError, UnknownReceiptError
✅ ParseError, TimeoutError, InternalServerError

### Remaining Work for RPC Error Handler

`src/core/rpc/rpc-error-handler.ts` remains at 90% function / 65.70% line coverage. The uncovered paths represent edge cases that are **difficult to trigger through integration tests**:

- Lines 114, 139: Error message extraction fallbacks
- Lines 165, 177, 179-181: Malformed error response handling
- Lines 214-222: isRetryableStatus edge cases
- Lines 271, 286: Query error parsing edge cases
- Lines 301-303, 307-308, etc.: Unknown error code handling

**Recommendation:** To improve RPC error handler coverage to >85%, implement **unit tests with mocked RPC responses** that can precisely control error response structures. See "Testing Against Real RPC Responses" section below.

---

## Testing Against Real RPC Responses

To achieve higher coverage of `src/core/rpc/rpc-error-handler.ts`, we need to test edge cases with **controlled RPC error responses**. Here are recommended approaches:

### Option 1: Unit Tests with Mocked Fetch (Recommended for Edge Cases)

Create `tests/unit/rpc-error-handler.test.ts`:

```typescript
import { describe, test, expect, mock } from "bun:test"
import { parseRpcError } from "../../src/core/rpc/rpc-error-handler.js"

test("should handle malformed error response", () => {
  const malformedError = {
    name: "UNKNOWN_ERROR",
    code: -32000,
    message: "Unknown error",
    // Missing 'cause' field - tests fallback path
  }

  expect(() => parseRpcError(malformedError)).toThrow(NetworkError)
})

test("should handle unknown error codes", () => {
  const unknownError = {
    name: "WEIRD_ERROR",
    code: -99999,
    message: "Something went wrong",
    cause: {
      name: "TOTALLY_UNKNOWN_CAUSE"
    }
  }

  // Should fall back to NetworkError
  expect(() => parseRpcError(unknownError)).toThrow(NetworkError)
})
```

### Option 2: Integration Tests with Real Archival/Testnet Queries

Test specific RPC error scenarios against live networks:

```typescript
test("UnknownBlockError from archival query", async () => {
  const rpc = new RpcClient("https://archival-rpc.mainnet.near.org")

  try {
    // Query a very old block that's been garbage collected
    await rpc.query({
      request_type: "view_account",
      block_id: 1, // Very old block
      account_id: "near"
    })
  } catch (error) {
    expect(error).toBeInstanceOf(UnknownBlockError)
  }
})
```

### Option 3: Captured RPC Responses (Test Fixtures)

Create `tests/fixtures/rpc-error-responses.json` with real error responses captured from NEAR RPC:

```json
{
  "unknownBlock": {
    "error": {
      "name": "HANDLER_ERROR",
      "cause": {
        "name": "UNKNOWN_BLOCK",
        "info": {
          "block_reference": "12345"
        }
      },
      "code": -32000,
      "message": "DB Not Found Error: BLOCK HEIGHT: 12345 \n Cause: Unknown",
      "data": "BLOCK HEIGHT: 12345"
    }
  }
}
```

Then test with fixtures:

```typescript
import errorFixtures from "../fixtures/rpc-error-responses.json"

test("parseRpcError handles UNKNOWN_BLOCK", () => {
  expect(() => parseRpcError(errorFixtures.unknownBlock.error))
    .toThrow(UnknownBlockError)
})
```

### Option 4: Mock RPC Server for Integration Tests

Create a lightweight mock RPC server that returns specific error responses:

```typescript
import { serve } from "bun"

const mockRpcServer = serve({
  port: 0, // Random port
  fetch(req) {
    const body = await req.json()

    if (body.params.block_id === 999999999) {
      return Response.json({
        jsonrpc: "2.0",
        error: {
          name: "HANDLER_ERROR",
          cause: { name: "UNKNOWN_BLOCK" },
          code: -32000,
          message: "Block not found"
        },
        id: body.id
      })
    }
  }
})

// Use in tests
const rpc = new RpcClient(`http://localhost:${mockRpcServer.port}`)
```

### Recommendation

For the remaining RPC error handler coverage:

1. **Unit tests with mocked responses** (Option 1) - Best for edge cases and malformed responses
2. **Real RPC query tests** (Option 2) - Good for testing actual NEAR RPC behavior
3. **Fixture-based tests** (Option 3) - Balance between real responses and test speed
4. **Mock RPC server** (Option 4) - Most control, but requires more setup

**Next Task:** Implement Option 1 (unit tests) to cover the remaining edge cases in `rpc-error-handler.ts`.

---

## Current Coverage by Module

### ✅ Well-Covered (>85% function coverage)

| Module | Functions | Lines | Status |
|--------|-----------|-------|--------|
| `src/core/rpc/rpc.ts` | 91.30% | 95.39% | ✅ Excellent |
| `src/core/near.ts` | 96.77% | 75.39% | ✅ Good |
| `src/sandbox/sandbox.ts` | 93.55% | 100% | ✅ Excellent |
| `src/core/rpc/rpc-error-handler.ts` | 90.00% | 65.70% | ⚠️ Good functions, poor line coverage |
| `src/contracts/contract.ts` | 87.50% | 86.11% | ✅ Good |
| `src/core/transaction.ts` | 82.14% | 90.23% | ✅ Good |

### ⚠️ Partially Covered (50-85%)

| Module | Functions | Lines | Notes |
|--------|-----------|-------|-------|
| `src/keys/in-memory-keystore.ts` | 62.50% | 45.71% | Missing edge cases |
| `src/utils/amount.ts` | 60% | 34.52% | Missing edge cases & conversions |
| `src/core/schema.ts` | 55.56% | 79.13% | Some schemas untested |

### 🚨 Poorly Covered (<50% - PRIORITY AREAS)

| Module | Functions | Lines | Impact | Status |
|--------|-----------|-------|--------|--------|
| ~~**`src/errors/index.ts`**~~ | ~~**25%**~~ → **100%** ✅ | ~~**54.97%**~~ → **100%** ✅ | **🔴 HIGH** | **COMPLETE** |
| **`src/core/actions.ts`** | **38.46%** | **35.88%** | **🔴 HIGH - Missing AddKey, DeleteKey, Stake, DelegateAction** | **NEXT** |
| `src/utils/key.ts` | 44.44% | 41.54% | 🟡 MEDIUM - Missing Secp256k1, edge cases | Pending |
| `src/keys/in-memory-keystore.ts` | 62.50% | 45.71% | 🟡 MEDIUM - Missing concurrent access | Pending |
| `src/utils/validation.ts` | 33.33% | 80.56% | 🟡 MEDIUM - Missing validation edge cases | Pending |
| `src/core/nonce-manager.ts` | 42.86% | 89.19% | 🟠 LOW - Good line coverage | Pending |

### ❌ Untested (0% function coverage - DEFER FOR NOW)

| Module | Functions | Lines | Decision |
|--------|-----------|-------|----------|
| `src/wallets/adapters.ts` | 0% | 1.56% | ⏸️ **DEFERRED** - Wallet testing on hold |
| `src/keys/file-keystore.ts` | 0% | 3.67% | 📋 **PLAN** - Add with tmp dir strategy |
| `src/utils/nep413.ts` | 0% | 19.72% | 📋 **PLAN** - Add message signing tests |
| `src/utils/gas.ts` | 0% | 20.45% | 🟢 **LOW PRIORITY** - Simple utilities |
| `src/keys/credential-schemas.ts` | 0% | 54.76% | 📋 **PLAN** - Test with file-keystore |

---

## Priority 1: RPC Error Handling & Error Classes 🎯

### Problem

**`src/errors/index.ts` has only 25% function coverage**, meaning most error classes are never instantiated or tested in integration tests. Additionally, **`src/core/rpc/rpc-error-handler.ts` has 90% function coverage but only 65.70% line coverage**, indicating many error code paths are untested.

### Uncovered Error Types

Based on the coverage report (`src/errors/index.ts` lines 28-35, 142-149, 158-160, etc.), these error classes are likely untested:

1. **Network/Connection Errors**
   - Connection timeouts
   - Invalid RPC endpoints
   - Network failures during transaction

2. **Transaction Errors**
   - `InvalidTransactionError` - Comprehensive scenarios
   - `InsufficientBalanceError` - Various balance scenarios
   - Nonce conflicts and retry logic

3. **Access Key Errors**
   - Invalid access keys
   - Expired access keys
   - Permission mismatches

4. **Contract Errors**
   - Various panic types beyond basic deserialization
   - Gas exceeded errors
   - Storage exceeded errors

### Recommended Test Suite

Create: `tests/integration/rpc-error-scenarios.test.ts`

**Test Coverage Areas:**

```typescript
describe("RPC Error Handling", () => {
  // Network & Connection Errors
  describe("Network Errors", () => {
    test("invalid RPC endpoint throws NetworkError")
    test("connection timeout throws NetworkError")
    test("invalid JSON-RPC response handling")
  })

  // Account & Access Key Errors
  describe("Account Errors", () => {
    test("AccountDoesNotExistError - comprehensive properties")
    test("AccessKeyDoesNotExistError - various scenarios")
    test("InvalidAccessKeyError - wrong permissions")
  })

  // Transaction Errors
  describe("Transaction Errors", () => {
    test("InsufficientBalanceError - not enough for transfer")
    test("InsufficientBalanceError - not enough for gas")
    test("InvalidTransactionError - invalid nonce")
    test("InvalidTransactionError - various invalid states")
    test("nonce conflict and retry behavior")
  })

  // Contract Errors
  describe("Contract Errors", () => {
    test("FunctionCallError - method not found")
    test("FunctionCallError - deserialization errors")
    test("FunctionCallError - gas exceeded")
    test("FunctionCallError - storage exceeded")
    test("FunctionCallError - various panic types")
  })

  // RPC Error Handler Edge Cases
  describe("RPC Error Handler", () => {
    test("unknown RPC error codes")
    test("malformed error responses")
    test("error message parsing edge cases")
    test("nested error structures")
  })
})
```

**Implementation Strategy:**

1. Use sandbox for real RPC errors
2. Trigger each error type through actual operations
3. Verify error properties (code, message, context data)
4. Test error serialization/deserialization
5. Ensure all error constructors are called at least once

**Files to reference:**
- Existing: `tests/integration/error-handling.test.ts` (basic errors)
- Source: `src/errors/index.ts` (all error class definitions)
- Source: `src/core/rpc/rpc-error-handler.ts` (error mapping logic)

---

## Priority 2: File-Based Key Storage

### Problem

**`src/keys/file-keystore.ts` has 0% function coverage**. This is critical functionality for CLI and server-side applications.

### Recommended Test Suite

Create: `tests/integration/file-keystore.test.ts`

**Test Coverage Areas:**

```typescript
describe("FileKeyStore Integration", () => {
  let tmpDir: string

  beforeEach(() => {
    // Create isolated tmp directory
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'near-test-'))
  })

  afterEach(() => {
    // Clean up tmp directory
    rmSync(tmpDir, { recursive: true })
  })

  describe("Basic Operations", () => {
    test("add() creates credential file in correct format")
    test("get() reads existing credential file")
    test("has() checks for key existence")
    test("remove() deletes credential file")
    test("list() returns all accounts")
  })

  describe("NEAR CLI Compatibility", () => {
    test("reads NEAR CLI format (account.near.json)")
    test("reads multi-key format (account.near/ed25519_*.json)")
    test("preserves seed phrase fields when present")
    test("writes simple format for new keys")
  })

  describe("Network Subdirectories", () => {
    test("stores keys in network-specific subdirectories")
    test("mainnet keys isolated from testnet")
    test("implicit account support")
  })

  describe("Error Handling", () => {
    test("get() throws KeyNotFoundError for missing key")
    test("handles corrupted JSON files gracefully")
    test("handles missing directories")
    test("handles permission errors")
  })

  describe("Integration with Near Client", () => {
    test("FileKeyStore works with Near client for transactions")
    test("Key rotation scenario")
  })
})
```

**Implementation Notes:**
- Use Node.js `fs` module with temp directories
- Test both read and write operations
- Ensure no files are created in `~/.near-credentials` during tests
- Test cross-compatibility with NEAR CLI format

---

## Priority 3: Advanced Transaction Actions

### Problem

**`src/core/actions.ts` has 38.46% function coverage**, with several action types completely untested:
- Lines 40-52: `DelegateAction` constructor
- Lines 61-62: Signature creation
- Lines 104-106: `AddKey` action
- Lines 131-136: `DeleteKey` action
- Lines 187-191: `Stake` action
- Lines 212-222: Various action builders
- Lines 246-273: More complex actions

### Recommended Test Suite

Create: `tests/integration/advanced-actions.test.ts`

**Test Coverage Areas:**

```typescript
describe("Advanced Transaction Actions", () => {
  describe("Access Key Management", () => {
    test("AddKey - create full access key")
    test("AddKey - create function call access key")
    test("AddKey - function call with receiver and method restrictions")
    test("AddKey - with allowance limits")
    test("DeleteKey - remove access key")
    test("access key lifecycle: add -> use -> delete")
  })

  describe("Account Lifecycle", () => {
    test("DeleteAccount - delete account and transfer remaining balance")
    test("DeleteAccount - beneficiary receives funds")
  })

  describe("Staking Actions", () => {
    test("Stake - validator staking")
    test("Stake - unstaking scenario")
    test("Stake - stake amount validation")
  })

  describe("Delegate Actions (Meta-Transactions)", () => {
    test("DelegateAction - create signed delegate action")
    test("DelegateAction - execute through relayer")
    test("DelegateAction - validate signature")
    test("DelegateAction - nonce and block height validation")
  })

  describe("Batch Actions", () => {
    test("multiple actions in single transaction")
    test("action ordering within transaction")
    test("partial failure handling in batch")
  })
})
```

---

## Priority 4: NEP-413 Message Signing

### Problem

**`src/utils/nep413.ts` has 0% function coverage**. This is important for authentication workflows.

### Recommended Test Suite

Create: `tests/integration/nep413-message-signing.test.ts`

**Test Coverage Areas:**

```typescript
describe("NEP-413 Message Signing", () => {
  describe("Message Serialization", () => {
    test("serialize message with all fields")
    test("serialize with optional callbackUrl")
    test("tag prefix is correct (2147484061)")
  })

  describe("Signature Creation", () => {
    test("sign message with Ed25519 key")
    test("verify signature is valid")
    test("signature verification fails for wrong message")
    test("signature verification fails for wrong signer")
  })

  describe("Nonce Handling", () => {
    test("different nonces produce different signatures")
    test("replay protection - same nonce rejected")
  })

  describe("Recipient Validation", () => {
    test("recipient field is included in signature")
    test("changing recipient invalidates signature")
  })

  describe("Integration Scenarios", () => {
    test("off-chain authentication flow")
    test("ownership verification without gas")
  })
})
```

---

## Priority 5: Edge Cases & Utilities

### Amount Utilities (`src/utils/amount.ts` - 60% / 34.52%)

Create: `tests/integration/amount-edge-cases.test.ts`

```typescript
describe("Amount Edge Cases", () => {
  test("maximum NEAR supply handling")
  test("very small amounts (1 yocto)")
  test("precision with many decimal places")
  test("rounding behavior for decimal NEAR")
  test("format parsing with whitespace")
  test("invalid format error handling")
})
```

### Key Utilities (`src/utils/key.ts` - 44.44% / 41.54%)

Add to existing tests or create: `tests/integration/key-utilities.test.ts`

```typescript
describe("Key Utilities", () => {
  test("Ed25519 key parsing and conversion")
  test("Secp256k1 key support")
  test("invalid key format handling")
  test("public key to account ID derivation")
  test("key serialization formats")
})
```

---

## Implementation Roadmap

### Phase 1: Error Handling (Immediate Priority) 🔴

**Goal:** Improve error coverage from 25% to >80%

**Tasks:**
1. Create `tests/integration/rpc-error-scenarios.test.ts`
2. Systematically trigger each error type listed in `src/errors/index.ts`
3. Verify error properties and context data
4. Test error recovery and retry logic
5. Cover untested lines in `src/core/rpc/rpc-error-handler.ts`

**Success Metrics:**
- `src/errors/index.ts`: >80% function coverage
- `src/core/rpc/rpc-error-handler.ts`: >85% line coverage
- All error classes instantiated at least once

### Phase 2: File Keystore (High Priority) 🟡

**Goal:** Get file-keystore to >80% coverage

**Tasks:**
1. Create `tests/integration/file-keystore.test.ts`
2. Implement tmp directory isolation strategy
3. Test NEAR CLI format compatibility
4. Test all CRUD operations
5. Integration with Near client

**Success Metrics:**
- `src/keys/file-keystore.ts`: >80% coverage
- `src/keys/credential-schemas.ts`: >70% coverage

### Phase 3: Advanced Actions (Medium Priority) 🟢

**Goal:** Improve actions coverage from 38% to >70%

**Tasks:**
1. Create `tests/integration/advanced-actions.test.ts`
2. Test access key lifecycle (add/delete)
3. Test account deletion
4. Test staking actions
5. Test delegate actions

**Success Metrics:**
- `src/core/actions.ts`: >70% coverage

### Phase 4: Utilities & Edge Cases (Lower Priority) ⚪

**Goal:** Round out utility coverage

**Tasks:**
1. NEP-413 message signing tests
2. Amount edge cases
3. Key utilities edge cases
4. Gas utilities

---

## Testing Best Practices

### Sandbox Usage

All tests should use NEAR sandbox for realistic blockchain interaction:

```typescript
import { Sandbox } from "../src/sandbox/index.js"

let sandbox: Sandbox
let near: Near

beforeAll(async () => {
  sandbox = await Sandbox.create()
  near = new Near({
    networkId: "sandbox",
    rpcUrl: sandbox.rpcUrl
  })
})

afterAll(async () => {
  await sandbox.stop()
})
```

### Temporary Directories

For file I/O tests, use isolated tmp directories:

```typescript
import { mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'near-test-'))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})
```

### Error Testing Pattern

```typescript
test("specific error scenario", async () => {
  try {
    await near.operation_that_should_fail()
    throw new Error("Should have thrown")
  } catch (error) {
    expect(error).toBeInstanceOf(SpecificErrorType)
    expect(error.code).toBe("ERROR_CODE")
    expect(error.message).toContain("expected message")
    expect(error.context).toEqual({ /* expected context */ })
  }
})
```

---

## Coverage Goals

| Module | Before | Current | Target | Status |
|--------|--------|---------|--------|--------|
| `src/errors/index.ts` | 25% / 54.97% | **100% / 100%** ✅ | >80% / >80% | **COMPLETE** |
| `src/core/rpc/rpc-error-handler.ts` | 90% / 65.70% | **90% / 65.70%** | 90% / >85% | Unit tests needed |
| `src/keys/file-keystore.ts` | 0% / 3.67% | 0% / 3.67% | >80% / >80% | **Phase 2** |
| `src/core/actions.ts` | 38.46% / 35.88% | 38.46% / 35.88% | >70% / >70% | **Phase 3** |
| `src/utils/nep413.ts` | 0% / 19.72% | 0% / 19.72% | >70% / >70% | Phase 4 |
| **Overall** | **64.41% / 69.96%** | **67.09% / 71.99%** | **>75% / >80%** | **In Progress** |

---

## Deferred Items

### Wallet Integration Testing ⏸️
**Decision:** Hold off on wallet testing for now
- `src/wallets/adapters.ts` remains at 0% coverage
- Requires browser environment or complex mocking
- Revisit when wallet integration is prioritized

### Gas Utilities 🟢
**Decision:** Low priority
- `src/utils/gas.ts` at 0% but simple utility functions
- Can be addressed after higher-priority items

---

## Next Steps for Implementation

1. **Start with Phase 1** - RPC error scenarios test suite
2. **Review** this document and existing test patterns
3. **Reference** well-written tests like `guestbook-comprehensive.test.ts` for patterns
4. **Use sandbox** for all integration tests requiring blockchain interaction
5. **Run coverage** after each new test file: `bun test tests/integration --coverage`
6. **Iterate** until coverage targets are met

---

## Appendix: Existing Test Files

Current integration test files (11 total):

1. `error-handling.test.ts` - Basic error scenarios
2. `near-client.test.ts` - Near client operations
3. `concurrent-transactions.test.ts` - Nonce management, parallel txns
4. `rpc-view-methods.test.ts` - RPC read operations
5. `contract-panics.test.ts` - Contract error scenarios
6. `tx-status.test.ts` - Transaction status queries
7. `contract-interface.test.ts` - Typed contract interactions
8. `guestbook-comprehensive.test.ts` - ⭐ **Excellent example of comprehensive testing**
9. `transaction-signing.test.ts` - Transaction building/signing
10. `sandbox.test.ts` - Sandbox lifecycle
11. `send-transaction.test.ts` - Transaction submission

**Best practices reference:** Study `guestbook-comprehensive.test.ts` for:
- Comprehensive scenario coverage
- Sandbox setup/teardown
- Error testing patterns
- State verification

---

**Document Version:** 1.0
**Last Updated:** 2025-11-15
**Owner:** Integration Test Coverage Improvement Initiative
