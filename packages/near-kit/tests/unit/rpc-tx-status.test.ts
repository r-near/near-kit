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
import { InvalidTransactionError } from "../../src/errors/index.js"

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
