/**
 * Unit tests for RpcClient.getTransactionStatus (EXPERIMENTAL_tx_status).
 *
 * These use a mocked transport so we can force a response whose
 * `final_execution_status` is a genuine early wait level (NONE/INCLUDED) while
 * still carrying receipt data — a state that is awkward to observe against a
 * fast local sandbox but common on mainnet as a transaction partially executes.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { RpcClient } from "../../src/core/rpc/rpc.js"
import {
  InvalidTransactionError,
  TransferToUniversalAccountNotAllowedError,
} from "../../src/errors/index.js"

const outcomeWithId = (executorId: string, failure = false) => ({
  id: "11111111111111111111111111111111",
  outcome: {
    logs: [],
    receipt_ids: ["22222222222222222222222222222222"],
    gas_burnt: 424555062500,
    tokens_burnt: "42455506250000000000",
    executor_id: executorId,
    status: failure
      ? { Failure: { error_message: "boom", error_type: "ActionError" } }
      : { SuccessValue: "" },
  },
  block_hash: "33333333333333333333333333333333",
  proof: [],
})

const receipt = (receiverId: string) => ({
  predecessor_id: "alice.near",
  receiver_id: receiverId,
  receipt_id: "44444444444444444444444444444444",
  receipt: {
    Action: {
      signer_id: "alice.near",
      signer_public_key: "ed25519:8nFkHgRePSGD9UsK3Hx6nWKXGQ7Kd7k3k7k3k7k3k7k3",
      gas_price: "1000000000",
      output_data_receivers: [],
      input_data_ids: [],
      actions: [{ Transfer: { deposit: "1" } }],
    },
  },
})

const minimalTransaction = {
  hash: "55555555555555555555555555555555",
  signer_id: "alice.near",
  receiver_id: "bob.near",
  nonce: 42,
}

function mockResult(result: unknown) {
  return vi.fn(
    async () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
        status: 200,
      }),
  )
}

describe("RpcClient.getTransactionStatus - early wait levels", () => {
  let originalFetch: typeof global.fetch

  beforeEach(() => {
    originalFetch = global.fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  test("surfaces receipts and receipts_outcome when final_execution_status is INCLUDED", async () => {
    global.fetch = mockResult({
      final_execution_status: "INCLUDED",
      status: { SuccessValue: "" },
      transaction: minimalTransaction,
      transaction_outcome: outcomeWithId("alice.near"),
      receipts_outcome: [outcomeWithId("bob.near")],
      receipts: [receipt("bob.near")],
    }) as unknown as typeof global.fetch

    const rpc = new RpcClient("https://test.rpc.near.org")
    const status = await rpc.getTransactionStatus(
      "55555555555555555555555555555555",
      "alice.near",
      "INCLUDED",
    )

    expect(status.final_execution_status).toBe("INCLUDED")
    // The data the schema used to strip at early levels is now preserved.
    expect(status.receipts_outcome).toBeDefined()
    expect(status.receipts_outcome).toHaveLength(1)
    expect(status.receipts).toHaveLength(1)
    expect(status.receipts[0]?.receiver_id).toBe("bob.near")
  })

  test("throws InvalidTransactionError on a terminal Failure at an early level", async () => {
    global.fetch = mockResult({
      final_execution_status: "NONE",
      status: { Failure: { error_message: "boom", error_type: "ActionError" } },
      transaction: minimalTransaction,
      transaction_outcome: outcomeWithId("alice.near", true),
      receipts_outcome: [outcomeWithId("bob.near", true)],
      receipts: [receipt("bob.near")],
    }) as unknown as typeof global.fetch

    const rpc = new RpcClient("https://test.rpc.near.org")

    await expect(
      rpc.getTransactionStatus(
        "55555555555555555555555555555555",
        "alice.near",
        "NONE",
      ),
    ).rejects.toBeInstanceOf(InvalidTransactionError)
  })

  test("does not throw for a pending early-level response without a failure", async () => {
    global.fetch = mockResult({
      final_execution_status: "NONE",
      transaction: minimalTransaction,
      status: "Pending",
      receipts: [],
    }) as unknown as typeof global.fetch

    const rpc = new RpcClient("https://test.rpc.near.org")
    const status = await rpc.getTransactionStatus(
      "55555555555555555555555555555555",
      "alice.near",
      "NONE",
    )

    expect(status.final_execution_status).toBe("NONE")
    expect(status.receipts).toEqual([])
  })
})

describe("RpcClient - transfers to universal accounts", () => {
  const universalAccountId =
    "0u0c51260z4rpk8et29585eqk5dhsqn0c8hyb9v95bpaww1hyetqe0"
  const actionsValidation = {
    ActionsValidation: {
      TransferToUniversalAccountNotAllowed: { account_id: universalAccountId },
    },
  }

  // A contract on bob.near creates a receipt transferring to a 0u account.
  const receiptFailure = {
    ActionError: {
      index: 0,
      kind: { NewReceiptValidationError: actionsValidation },
    },
  }

  const fullTransaction = {
    ...minimalTransaction,
    public_key: "ed25519:8nFkHgRePSGD9UsK3Hx6nWKXGQ7Kd7k3k7k3k7k3k7k3",
    actions: [
      {
        FunctionCall: {
          method_name: "pay",
          args: "",
          gas: 30000000000000,
          deposit: "0",
        },
      },
    ],
    signature:
      "ed25519:2222222222222222222222222222222222222222222222222222222222222222",
  }

  const failedOutcome = (executorId: string, failure: unknown) => ({
    ...outcomeWithId(executorId),
    outcome: {
      ...outcomeWithId(executorId).outcome,
      status: { Failure: failure },
    },
  })

  const receiptFailureResult = {
    final_execution_status: "EXECUTED_OPTIMISTIC",
    status: { Failure: receiptFailure },
    transaction: fullTransaction,
    transaction_outcome: outcomeWithId("alice.near"),
    receipts_outcome: [failedOutcome("bob.near", receiptFailure)],
    receipts: [receipt("bob.near")],
  }

  let originalFetch: typeof global.fetch

  beforeEach(() => {
    originalFetch = global.fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  test("sendTransaction throws the typed error for a failed receipt", async () => {
    global.fetch = mockResult(
      receiptFailureResult,
    ) as unknown as typeof global.fetch

    const rpc = new RpcClient("https://test.rpc.near.org")
    const error = await rpc
      .sendTransaction(new Uint8Array([1, 2, 3]))
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(TransferToUniversalAccountNotAllowedError)
    expect((error as TransferToUniversalAccountNotAllowedError).accountId).toBe(
      universalAccountId,
    )
  })

  test("getTransactionStatus throws the typed error for a failed receipt", async () => {
    global.fetch = mockResult(
      receiptFailureResult,
    ) as unknown as typeof global.fetch

    const rpc = new RpcClient("https://test.rpc.near.org")

    await expect(
      rpc.getTransactionStatus(
        "55555555555555555555555555555555",
        "alice.near",
      ),
    ).rejects.toBeInstanceOf(TransferToUniversalAccountNotAllowedError)
  })

  test("getTransactionStatus throws the typed error for a transaction failing InvalidTxError", async () => {
    const failure = { InvalidTxError: actionsValidation }
    global.fetch = mockResult({
      final_execution_status: "EXECUTED_OPTIMISTIC",
      status: { Failure: failure },
      transaction: fullTransaction,
      transaction_outcome: failedOutcome("alice.near", failure),
      receipts_outcome: [],
      receipts: [],
    }) as unknown as typeof global.fetch

    const rpc = new RpcClient("https://test.rpc.near.org")

    await expect(
      rpc.getTransactionStatus(
        "55555555555555555555555555555555",
        "alice.near",
      ),
    ).rejects.toMatchObject({
      code: "TRANSFER_TO_UNIVERSAL_ACCOUNT_NOT_ALLOWED",
      accountId: universalAccountId,
    })
  })

  // An unrelated failed receipt ahead of the one carrying the ban must not
  // hide it, whichever failure the final status reports.
  const unrelatedFailure = {
    ActionError: {
      index: 0,
      kind: { AccountDoesNotExist: { account_id: "carol.near" } },
    },
  }
  const multiFailureResult = {
    ...receiptFailureResult,
    status: { Failure: unrelatedFailure },
    receipts_outcome: [
      failedOutcome("carol.near", unrelatedFailure),
      failedOutcome("bob.near", receiptFailure),
    ],
  }

  test("sendTransaction finds the ban behind an unrelated failed receipt", async () => {
    global.fetch = mockResult(
      multiFailureResult,
    ) as unknown as typeof global.fetch

    const rpc = new RpcClient("https://test.rpc.near.org")

    await expect(
      rpc.sendTransaction(new Uint8Array([1, 2, 3])),
    ).rejects.toBeInstanceOf(TransferToUniversalAccountNotAllowedError)
  })

  test("getTransactionStatus finds the ban behind an unrelated failed receipt", async () => {
    global.fetch = mockResult(
      multiFailureResult,
    ) as unknown as typeof global.fetch

    const rpc = new RpcClient("https://test.rpc.near.org")

    await expect(
      rpc.getTransactionStatus(
        "55555555555555555555555555555555",
        "alice.near",
      ),
    ).rejects.toBeInstanceOf(TransferToUniversalAccountNotAllowedError)
  })

  test("sendTransaction surfaces the send_tx validation error as the typed error", async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            error: {
              name: "HANDLER_ERROR",
              code: -32000,
              message: "Server error",
              cause: { name: "INVALID_TRANSACTION", info: {} },
              data: { TxExecutionError: { InvalidTxError: actionsValidation } },
            },
          }),
          { status: 200 },
        ),
    ) as unknown as typeof global.fetch

    const rpc = new RpcClient("https://test.rpc.near.org")

    await expect(
      rpc.sendTransaction(new Uint8Array([1, 2, 3])),
    ).rejects.toBeInstanceOf(TransferToUniversalAccountNotAllowedError)
  })
})
