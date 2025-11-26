import { describe, expect, test, vi } from "vitest"

import { RpcClient } from "../../src/core/rpc/rpc.js"
import { InvalidTransactionError } from "../../src/errors/index.js"

const baseTransaction = {
  signer_id: "alice.near",
  public_key: "ed25519:pub",
  nonce: 1,
  receiver_id: "bob.near",
  actions: [],
  signature: "ed25519:sig",
  hash: "hash",
}

const successOutcome = {
  logs: [],
  receipt_ids: [],
  gas_burnt: 0,
  tokens_burnt: "0",
  executor_id: "alice.near",
  status: { SuccessValue: "" },
}

describe("RpcClient failure handling", () => {
  test("sendTransaction surfaces transaction outcome failures", async () => {
    const client = new RpcClient("http://example.com")

    const failureOutcome = {
      final_execution_status: "FINAL",
      status: { Failure: { error_message: "boom" } },
      transaction: baseTransaction,
      transaction_outcome: {
        id: "txid",
        outcome: {
          ...successOutcome,
          status: { Failure: { error_message: "boom" } },
        },
        block_hash: "block",
        proof: [],
      },
      receipts_outcome: [],
    }

    vi.spyOn(client as any, "call").mockResolvedValue(failureOutcome)

    await expect(
      client.sendTransaction(new Uint8Array([1, 2, 3]), "FINAL"),
    ).rejects.toBeInstanceOf(InvalidTransactionError)
  })

  test("getTransactionStatus inspects receipt failures", async () => {
    const client = new RpcClient("http://example.com")

    const failureReceipt = {
      id: "rcpt1",
      outcome: {
        ...successOutcome,
        status: { Failure: { error_message: "receipt boom" } },
      },
      block_hash: "block",
      proof: [],
    }

    const receiptFailure = {
      final_execution_status: "FINAL",
      status: { Failure: { error_message: "receipt boom" } },
      transaction: baseTransaction,
      transaction_outcome: {
        id: "txid",
        outcome: successOutcome,
        block_hash: "block",
        proof: [],
      },
      receipts_outcome: [failureReceipt],
      receipts: [],
    }

    vi.spyOn(client as any, "call").mockResolvedValue(receiptFailure)

    await expect(
      client.getTransactionStatus("hash", "alice.near", "FINAL"),
    ).rejects.toBeInstanceOf(InvalidTransactionError)
  })
})
