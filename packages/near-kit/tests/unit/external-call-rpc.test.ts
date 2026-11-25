/**
 * External calls (NEP-667) through RpcClient and Near, against responses a
 * 2.15.0-rc.1 sandbox node returned (tests/fixtures/nearcore-2.15).
 */

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { base64 } from "@scure/base"
import { afterEach, describe, expect, test, vi } from "vitest"
import {
  encodeExternalCall,
  externalCallHash,
} from "../../src/core/external-call.js"
import { Near } from "../../src/core/near.js"
import { encodeViewStateInit, RpcClient } from "../../src/core/rpc/rpc.js"
import {
  ChunkTransactionSchema,
  ExternalCallOutcomeSchema,
  ExternalCallOutcomeWithReceiptsSchema,
  FinalExecutionOutcomeSchema,
  ReceiptViewSchema,
  StateChangeCauseSchema,
  TransactionEnvelopeSchema,
} from "../../src/core/rpc/rpc-schemas.js"
import {
  AccountDoesNotExistError,
  ContractNotDeployedError,
  ExternalCallRefusedError,
  ExternalCallTimeoutError,
  InvalidStateInitError,
  NearError,
  NetworkError,
  ReservedMethodNameError,
  ShardUnavailableError,
  TimeoutError,
  UninitializedAccountError,
  UnknownTransactionError,
} from "../../src/errors/index.js"

type Captured = { http: number; body: Record<string, unknown> }

function fixture(name: string): Captured {
  return JSON.parse(
    readFileSync(
      resolve(__dirname, `../fixtures/nearcore-2.15/${name}.json`),
      "utf8",
    ),
  )
}

function result(name: string): Record<string, unknown> {
  return fixture(name).body["result"] as Record<string, unknown>
}

const CONTRACT = "ecc-1795554409281.test.near"
const PAYLOAD = base64.decode(
  "cDE3OTU1NTQ0MTYzNjItMC4xMzY3NTA5MDYxMzA4NjgwNA==",
)
const UNIQUE_ID = "7GACTspx75YEcW25VohrTvf9pmfiQkf1aneZagNvKxAz"

type Request = { method: string; params: Record<string, unknown> }
type Reply = Captured | ((request: Request) => Captured)

/** Mock fetch, answering each JSON-RPC method from a table. */
function mockRpc(routes: Record<string, Reply>) {
  const requests: Request[] = []
  global.fetch = vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
    const request = JSON.parse(String(init?.body)) as Request
    requests.push(request)
    const route = routes[request.method]
    if (!route) throw new Error(`unexpected method ${request.method}`)
    const reply = typeof route === "function" ? route(request) : route
    return new Response(JSON.stringify(reply.body), { status: reply.http })
  }) as unknown as typeof global.fetch
  return requests
}

const ok = (value: unknown): Captured => ({
  http: 200,
  body: { jsonrpc: "2.0", id: 1, result: value },
})

const H = "11111111111111111111111111111111"

/** A block at `height`, enough for BlockViewSchema. */
const block = (height: number) =>
  ok({
    author: "test.near",
    header: {
      height,
      epoch_id: H,
      next_epoch_id: H,
      hash: H,
      prev_hash: H,
      prev_state_root: H,
      chunk_receipts_root: H,
      chunk_headers_root: H,
      chunk_tx_root: H,
      outcome_root: H,
      chunks_included: 1,
      challenges_root: H,
      timestamp: 1,
      timestamp_nanosec: "1",
      random_value: H,
      validator_proposals: [],
      chunk_mask: [true],
      gas_price: "100000000",
      total_supply: "1",
      challenges_result: [],
      last_final_block: H,
      last_ds_final_block: H,
      next_bp_hash: H,
      block_merkle_root: H,
      approvals: [],
      signature: "ed25519:1",
      latest_protocol_version: 89,
    },
    chunks: [],
  })

const originalFetch = global.fetch
afterEach(() => {
  global.fetch = originalFetch
  vi.restoreAllMocks()
})

describe("schemas on 2.15 node output", () => {
  test("send_tx at EXECUTED_OPTIMISTIC", () => {
    const parsed = ExternalCallOutcomeSchema.parse(
      result("send-tx-executed-optimistic"),
    )
    expect(parsed.final_execution_status).toBe("EXECUTED_OPTIMISTIC")
    expect(parsed.transaction).toEqual({
      kind: "external_call",
      contract_id: CONTRACT,
      payload: base64.encode(PAYLOAD),
      state_init: null,
      transaction_id: UNIQUE_ID,
    })
    expect(parsed.transaction_outcome?.id).toBe(UNIQUE_ID)
    expect(parsed.transaction_outcome?.outcome.logs).toEqual(["checked"])
  })

  test("send_tx at INCLUDED, which a fast node answers past INCLUDED", () => {
    const parsed = ExternalCallOutcomeSchema.parse(result("send-tx-included"))
    expect(parsed.final_execution_status).toBe("EXECUTED_OPTIMISTIC")
    expect(parsed.transaction?.kind).toBe("external_call")
  })

  test("send_tx at NONE has no outcome", () => {
    expect(ExternalCallOutcomeSchema.parse(result("send-tx-none"))).toEqual({
      final_execution_status: "NONE",
    })
  })

  test("a resend returns the copy that already landed", () => {
    const parsed = ExternalCallOutcomeSchema.parse(result("send-tx-resend"))
    expect(parsed.final_execution_status).toBe("FINAL")
    expect(parsed.transaction_outcome?.id).toBe(UNIQUE_ID)
  })

  test("EXPERIMENTAL_tx_status by unique id, with ExternalContractCall receipts", () => {
    const parsed = ExternalCallOutcomeWithReceiptsSchema.parse(
      result("tx-status-external-call"),
    )
    expect(parsed.receipts.length).toBeGreaterThan(0)
    for (const receipt of parsed.receipts) {
      const action = (receipt.receipt as { Action: Record<string, unknown> })
        .Action
      expect(action["authorization_context"]).toBe("ExternalContractCall")
      expect(action["creation_protocol_version"]).toBe(89)
      expect(action["signer_public_key"]).toBeUndefined()
    }
  })

  test("signed transaction receipts carry an AccessKey context", () => {
    const receipts = fixture("signed-receipts") as unknown as unknown[]
    for (const raw of receipts) {
      const receipt = ReceiptViewSchema.parse(raw)
      const action = (receipt.receipt as { Action: Record<string, unknown> })
        .Action
      expect(action["authorization_context"]).toEqual({
        AccessKey: action["signer_public_key"],
      })
      expect(action["creation_protocol_version"]).toBe(89)
    }
  })

  test("signed and external call envelopes, with and without kind", () => {
    const signed = {
      signer_id: "alice.near",
      public_key: "ed25519:8nFkHgRePSGD9UsK3Hx6nWKXGQ7Kd7k3k7k3k7k3k7k3",
      nonce: 1,
      receiver_id: "bob.near",
      actions: [],
      signature: "ed25519:1",
      hash: "11111111111111111111111111111111",
    }
    // nearcore < 2.15 sends no kind.
    expect(TransactionEnvelopeSchema.parse(signed)).toMatchObject({
      signer_id: "alice.near",
    })
    expect(
      TransactionEnvelopeSchema.parse({ ...signed, kind: "signed" }),
    ).toMatchObject({ kind: "signed", signer_id: "alice.near" })
    const ecc = TransactionEnvelopeSchema.parse(
      (result("send-tx-executed-optimistic") as { transaction: unknown })
        .transaction,
    )
    expect(ecc).toMatchObject({ kind: "external_call", contract_id: CONTRACT })
  })

  test("an outcome from nearcore < 2.15 still parses", () => {
    const outcome = {
      final_execution_status: "FINAL",
      status: { SuccessValue: "" },
      transaction: {
        signer_id: "alice.near",
        public_key: "ed25519:8nFkHgRePSGD9UsK3Hx6nWKXGQ7Kd7k3k7k3k7k3k7k3",
        nonce: 1,
        receiver_id: "bob.near",
        actions: [{ Transfer: { deposit: "1" } }],
        signature: "ed25519:1",
        hash: "11111111111111111111111111111111",
      },
      transaction_outcome: {
        id: "11111111111111111111111111111111",
        outcome: {
          logs: [],
          receipt_ids: [],
          gas_burnt: 1,
          tokens_burnt: "1",
          executor_id: "alice.near",
          status: { SuccessReceiptId: "11111111111111111111111111111111" },
        },
        block_hash: "11111111111111111111111111111111",
        proof: [],
      },
      receipts_outcome: [],
    }
    expect(FinalExecutionOutcomeSchema.parse(outcome)).toMatchObject({
      final_execution_status: "FINAL",
    })
  })

  test("chunk transactions, with a landed copy and a copy without an id", () => {
    const transactions = fixture("chunk-transactions") as unknown as unknown[]
    const parsed = transactions.map((tx) => ChunkTransactionSchema.parse(tx))
    expect(parsed[0]).toMatchObject({
      kind: "external_call",
      transaction_id: UNIQUE_ID,
    })
    // A producer's copy whose run was refused has no id.
    expect(
      ChunkTransactionSchema.parse({
        ...(transactions[0] as object),
        transaction_id: null,
      }),
    ).toMatchObject({ transaction_id: null })
  })

  test("state change causes", () => {
    const changes = result("changes-external-call-processing")["changes"] as {
      cause: unknown
    }[]
    expect(StateChangeCauseSchema.parse(changes[0]?.cause)).toEqual({
      type: "external_call_processing",
      transaction_id: UNIQUE_ID,
    })
    expect(
      StateChangeCauseSchema.parse({
        type: "contract_compilation_status_update",
      }),
    ).toEqual({ type: "contract_compilation_status_update" })
    expect(
      StateChangeCauseSchema.parse({
        type: "transaction_processing",
        tx_hash: "11111111111111111111111111111111",
      }),
    ).toMatchObject({ type: "transaction_processing" })
  })
})

describe("RpcClient.sendExternalCall", () => {
  const call = { contractId: CONTRACT, payload: PAYLOAD }

  test("sends external_call_base64 and returns the outcome", async () => {
    const requests = mockRpc({
      block: block(12),
      send_tx: fixture("send-tx-executed-optimistic"),
    })
    const rpc = new RpcClient("https://rpc.test")
    const outcome = await rpc.sendExternalCall(call, "EXECUTED_OPTIMISTIC")

    expect(outcome.transaction_outcome.id).toBe(UNIQUE_ID)
    const send = requests.find((r) => r.method === "send_tx")
    expect(send?.params).toEqual({
      external_call_base64: base64.encode(encodeExternalCall(call)),
      wait_until: "EXECUTED_OPTIMISTIC",
    })
  })

  test("NONE skips the head lookup and returns no outcome", async () => {
    const requests = mockRpc({ send_tx: fixture("send-tx-none") })
    const outcome = await new RpcClient("https://rpc.test").sendExternalCall(
      call,
      "NONE",
    )
    expect(outcome).toEqual({ final_execution_status: "NONE" })
    expect(requests.map((r) => r.method)).toEqual(["send_tx"])
  })

  test("a timeout throws ExternalCallTimeoutError once, without retrying", async () => {
    const requests = mockRpc({
      block: block(12),
      send_tx: fixture("send-tx-refused-timeout"),
    })
    const error = await new RpcClient("https://rpc.test")
      .sendExternalCall(call)
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ExternalCallTimeoutError)
    const timeout = error as ExternalCallTimeoutError
    expect(timeout.code).toBe("EXTERNAL_CALL_TIMEOUT")
    expect(timeout.retryable).toBe(true)
    expect(timeout.contractId).toBe(CONTRACT)
    expect(timeout.callHash).toBe(externalCallHash(call))
    expect(timeout.sentAtHeight).toBe(12)
    expect(requests.find((r) => r.method === "block")?.params).toEqual({
      finality: "final",
    })
    expect(requests.filter((r) => r.method === "send_tx")).toHaveLength(1)
  })

  test.each([
    ["a network failure", () => Promise.reject(new TypeError("fetch failed"))],
    [
      "an HTTP 503",
      () => Promise.resolve(new Response("unavailable", { status: 503 })),
    ],
  ])("%s on send is thrown without resending", async (_, fail) => {
    const sends: unknown[] = []
    global.fetch = vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
      const { method } = JSON.parse(String(init?.body)) as Request
      if (method === "block")
        return new Response(JSON.stringify(block(12).body))
      sends.push(method)
      return fail()
    }) as unknown as typeof global.fetch
    const rpc = new RpcClient("https://rpc.test", {}, { initialDelayMs: 1 })
    await expect(rpc.sendExternalCall(call)).rejects.toBeInstanceOf(
      NetworkError,
    )
    expect(sends).toEqual(["send_tx"])
  })

  test("a timeout that names a pending copy carries its unique id", async () => {
    const pending = fixture("send-tx-refused-timeout")
    const error = pending.body["error"] as {
      cause: { info: Record<string, unknown> }
    }
    error.cause.info = {
      cause: "PENDING",
      status: {
        ...result("send-tx-executed-optimistic"),
        final_execution_status: "INCLUDED",
      },
    }
    mockRpc({ block: block(12), send_tx: pending })
    const timeout = (await new RpcClient("https://rpc.test")
      .sendExternalCall(call, "FINAL")
      .catch((e: unknown) => e)) as ExternalCallTimeoutError
    expect(timeout).toBeInstanceOf(ExternalCallTimeoutError)
    expect(timeout.uniqueId).toBe(UNIQUE_ID)
    expect(timeout.message).toContain(UNIQUE_ID)
  })

  test("a call to an account without a contract throws ContractNotDeployedError", async () => {
    mockRpc({
      block: block(12),
      send_tx: fixture("send-tx-contract-not-found"),
    })
    const error = await new RpcClient("https://rpc.test")
      .sendExternalCall({
        contractId: "plain-1795554409281.test.near",
        payload: PAYLOAD,
      })
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ContractNotDeployedError)
    expect((error as ContractNotDeployedError).accountId).toBe(
      "plain-1795554409281.test.near",
    )
  })

  test("DOES_NOT_TRACK_SHARD is not retried", async () => {
    const requests = mockRpc({
      block: block(12),
      send_tx: {
        http: 200,
        body: {
          jsonrpc: "2.0",
          id: 1,
          error: {
            name: "HANDLER_ERROR",
            cause: { name: "DOES_NOT_TRACK_SHARD", info: {} },
            code: -32000,
            message: "Server error",
            data: "Node does not track the shard",
          },
        },
      },
    })
    const error = await new RpcClient("https://rpc.test")
      .sendExternalCall(call)
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ShardUnavailableError)
    expect((error as ShardUnavailableError).retryable).toBe(false)
    expect(requests.filter((r) => r.method === "send_tx")).toHaveLength(1)
  })

  test("a copy refused at execution throws ExternalCallRefusedError", async () => {
    const landed = result("send-tx-executed-optimistic") as {
      transaction_outcome: { outcome: Record<string, unknown> }
    }
    const failure = {
      InvalidTxError: {
        ExternalCallChunkShareReached: {
          share: { Compute: { used: 2, limit: 1 } },
        },
      },
    }
    const refused = {
      ...landed,
      status: { Failure: failure },
      transaction_outcome: {
        ...landed.transaction_outcome,
        outcome: {
          ...landed.transaction_outcome.outcome,
          status: { Failure: failure },
        },
      },
    }
    mockRpc({ block: block(12), send_tx: ok(refused) })
    const error = await new RpcClient("https://rpc.test")
      .sendExternalCall(call)
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ExternalCallRefusedError)
    const refusal = error as ExternalCallRefusedError
    expect(refusal.uniqueId).toBe(UNIQUE_ID)
    expect(refusal.contractId).toBe(CONTRACT)
    expect(refusal.retryable).toBe(true)
    expect(refusal.logs).toEqual(["checked"])
  })
})

describe("RpcClient.viewExternalCall", () => {
  test("returns the accepted run's result and logs, at optimistic finality", async () => {
    const requests = mockRpc({ query: fixture("view-external-call-accepted") })
    const view = await new RpcClient("https://rpc.test").viewExternalCall({
      contractId: CONTRACT,
      payload: PAYLOAD,
    })
    expect(view.logs).toEqual(["checked"])
    expect(requests[0]?.params).toEqual({
      request_type: "call_function",
      finality: "optimistic",
      account_id: CONTRACT,
      method_name: "__external_call",
      args_base64: base64.encode(PAYLOAD),
    })
  })

  test("keeps a block reference it is given", async () => {
    const requests = mockRpc({ query: fixture("view-external-call-accepted") })
    await new RpcClient("https://rpc.test").viewExternalCall(
      { contractId: CONTRACT, payload: PAYLOAD },
      { blockId: 12 },
    )
    expect(requests[0]?.params["block_id"]).toBe(12)
    expect(requests[0]?.params["finality"]).toBeUndefined()
  })

  test.each([
    ["query", "view-external-call-refused"],
    ["EXPERIMENTAL_call_function", "call-function-external-call-refused"],
  ])("a refusal (%s) throws ExternalCallRefusedError with the contract and logs", async (_method, name) => {
    // Both methods answer with the same error; RpcClient views go through query.
    mockRpc({ query: fixture(name) })
    const error = await new RpcClient("https://rpc.test")
      .viewExternalCall({ contractId: CONTRACT, payload: Uint8Array.of(0xff) })
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ExternalCallRefusedError)
    const refusal = error as ExternalCallRefusedError
    expect(refusal.code).toBe("EXTERNAL_CALL_REFUSED")
    expect(refusal.contractId).toBe(CONTRACT)
    expect(refusal.logs).toEqual(["checked"])
    expect(refusal.blockHeight).toBeTypeOf("number")
    expect(refusal.blockHash).toBeTypeOf("string")
    expect(refusal.retryable).toBe(false)
    expect(refusal.details).toMatchObject({
      ActionError: { kind: { FunctionCallError: {} } },
    })
  })

  test("an account without a contract is refused with ContractNotFound", async () => {
    mockRpc({ query: fixture("view-external-call-no-contract") })
    const error = await new RpcClient("https://rpc.test")
      .viewExternalCall({
        contractId: "plain-1795554409281.test.near",
        payload: new Uint8Array(),
      })
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ExternalCallRefusedError)
    expect((error as ExternalCallRefusedError).details).toEqual({
      InvalidTxError: {
        ContractNotFound: { contract_id: "plain-1795554409281.test.near" },
      },
    })
    expect((error as ExternalCallRefusedError).logs).toEqual([])
  })

  test("sends a state init", async () => {
    const requests = mockRpc({ query: fixture("view-external-call-accepted") })
    await new RpcClient("https://rpc.test").viewExternalCall({
      contractId: CONTRACT,
      payload: PAYLOAD,
      stateInit: Uint8Array.of(1, 2, 3),
    })
    expect(requests[0]?.params["state_init"]).toEqual({ universal: "AQID" })
  })
})

describe("encodeViewStateInit", () => {
  test("universal", () => {
    expect(encodeViewStateInit({ universal: new Uint8Array() })).toEqual({
      universal: "",
    })
  })

  test("deterministic by account id, with data sorted by key bytes", () => {
    expect(
      encodeViewStateInit({
        code: { accountId: "wallet.near" },
        data: new Map([
          [Uint8Array.of(2), Uint8Array.of(9)],
          [Uint8Array.of(1, 0), Uint8Array.of(8)],
          [Uint8Array.of(1), Uint8Array.of(7)],
        ]),
      }),
    ).toEqual({
      deterministic: {
        code: { account_id: "wallet.near" },
        data: { "AQ==": "Bw==", "AQA=": "CA==", "Ag==": "CQ==" },
      },
    })
  })

  test("deterministic by code hash", () => {
    const hash = new Uint8Array(32).fill(1)
    expect(encodeViewStateInit({ code: { codeHash: hash } })).toMatchObject({
      deterministic: {
        code: { hash: "4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi" },
        data: {},
      },
    })
  })
})

describe("RpcClient lookups by unique id", () => {
  test("getExternalCallStatus returns the copy with its receipts", async () => {
    const requests = mockRpc({
      EXPERIMENTAL_tx_status: fixture("tx-status-external-call"),
    })
    const status = await new RpcClient(
      "https://rpc.test",
    ).getExternalCallStatus(UNIQUE_ID, CONTRACT, "FINAL")
    expect(status.transaction.transaction_id).toBe(UNIQUE_ID)
    expect(requests[0]?.params).toEqual({
      tx_hash: UNIQUE_ID,
      sender_account_id: CONTRACT,
      wait_until: "FINAL",
    })
  })

  test("an unknown id throws UnknownTransactionError", async () => {
    mockRpc({ EXPERIMENTAL_tx_status: fixture("tx-unknown-transaction") })
    const error = await new RpcClient("https://rpc.test")
      .getExternalCallStatus(UNIQUE_ID, CONTRACT, "NONE")
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(UnknownTransactionError)
    expect((error as UnknownTransactionError).transactionHash).toBe(
      "687zkAF1F9Vk2EUgYzzHxHgG3K7TcvXiMkAEfR6BKTTq",
    )
    expect((error as UnknownTransactionError).retryable).toBe(false)
  })

  test("getExternalCallStatus refuses a signed transaction", async () => {
    mockRpc({
      EXPERIMENTAL_tx_status: ok({
        final_execution_status: "NONE",
        transaction: {
          signer_id: "alice.near",
          public_key: "ed25519:8nFkHgRePSGD9UsK3Hx6nWKXGQ7Kd7k3k7k3k7k3k7k3",
          nonce: 1,
          receiver_id: "bob.near",
          actions: [],
          signature: "ed25519:1",
          hash: H,
        },
        receipts: [],
      }),
    })
    const error = await new RpcClient("https://rpc.test")
      .getExternalCallStatus(H, "alice.near", "NONE")
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(NearError)
    expect((error as NearError).code).toBe("NOT_AN_EXTERNAL_CALL")
  })

  test("getTransactionStatus refuses an external call", async () => {
    mockRpc({ EXPERIMENTAL_tx_status: fixture("tx-status-external-call") })
    const error = await new RpcClient("https://rpc.test")
      .getTransactionStatus(UNIQUE_ID, CONTRACT, "FINAL")
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(NearError)
    expect((error as NearError).code).toBe("NOT_A_SIGNED_TRANSACTION")
  })

  test("view_access_key and view_access_key_list on a missing account", async () => {
    for (const name of [
      "view-access-key-unknown-account",
      "view-access-key-list-unknown-account",
    ]) {
      mockRpc({ query: fixture(name) })
      const rpc = new RpcClient("https://rpc.test")
      const error = await (name.includes("list")
        ? rpc.getAccessKeys("missing.test.near")
        : rpc.getAccessKey(
            "missing.test.near",
            "ed25519:He7QeRuwizNEhzeKNn2CLdCKfzkH6KLSaFKvJLYtnrFa",
          )
      ).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(AccountDoesNotExistError)
    }
  })
})

describe("Near external calls", () => {
  test("externalCall sends a JSON payload as UTF-8 JSON", async () => {
    const requests = mockRpc({
      block: block(12),
      send_tx: fixture("send-tx-executed-optimistic"),
    })
    const near = new Near({
      network: { networkId: "localnet", rpcUrl: "https://rpc.test" },
    })
    await near.externalCall(
      CONTRACT,
      { hello: "world" },
      {
        waitUntil: "EXECUTED_OPTIMISTIC",
      },
    )
    const sent = requests.find((r) => r.method === "send_tx")?.params[
      "external_call_base64"
    ] as string
    expect(sent).toBe(
      base64.encode(
        encodeExternalCall({
          contractId: CONTRACT,
          payload: new TextEncoder().encode('{"hello":"world"}'),
        }),
      ),
    )
  })

  test("viewExternalCall decodes the result", async () => {
    mockRpc({
      query: ok({
        block_hash: "11111111111111111111111111111111",
        block_height: 1,
        logs: [],
        result: [...new TextEncoder().encode('{"ok":true}')],
      }),
    })
    const near = new Near({
      network: { networkId: "localnet", rpcUrl: "https://rpc.test" },
    })
    expect(await near.viewExternalCall(CONTRACT, {})).toEqual({ ok: true })
  })
})

describe("ReservedMethodName on a signed FunctionCall", () => {
  test("throws ReservedMethodNameError", async () => {
    const failure = {
      ActionError: {
        index: 0,
        kind: { ReservedMethodName: { method_name: "__external_call" } },
      },
    }
    const outcome = (status: unknown) => ({
      id: "11111111111111111111111111111111",
      outcome: {
        logs: [],
        receipt_ids: [],
        gas_burnt: 1,
        tokens_burnt: "1",
        executor_id: CONTRACT,
        status,
      },
      block_hash: "11111111111111111111111111111111",
      proof: [],
    })
    mockRpc({
      EXPERIMENTAL_tx_status: ok({
        final_execution_status: "FINAL",
        status: { Failure: failure },
        transaction: {
          signer_id: "alice.near",
          public_key: "ed25519:8nFkHgRePSGD9UsK3Hx6nWKXGQ7Kd7k3k7k3k7k3k7k3",
          nonce: 1,
          receiver_id: CONTRACT,
          actions: [],
          signature: "ed25519:1",
          hash: "11111111111111111111111111111111",
        },
        transaction_outcome: outcome({
          SuccessReceiptId: "11111111111111111111111111111111",
        }),
        receipts_outcome: [outcome({ Failure: failure })],
        receipts: [],
      }),
    })
    const error = await new RpcClient("https://rpc.test")
      .getTransactionStatus(
        "11111111111111111111111111111111",
        "alice.near",
        "FINAL",
      )
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ReservedMethodNameError)
    expect((error as ReservedMethodNameError).methodName).toBe(
      "__external_call",
    )
  })
})

describe("2.15 RPC errors", () => {
  const UNIVERSAL = "0ur4hp47xzeqz730v3a6mnkwrccrq5j8012ekb7635js7fct47kpd0"

  test("UNINITIALIZED_ACCOUNT", async () => {
    mockRpc({ query: fixture("view-uninitialized-account") })
    const error = await new RpcClient("https://rpc.test")
      .viewFunction(UNIVERSAL, "anything")
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(UninitializedAccountError)
    expect((error as UninitializedAccountError).accountId).toBe(UNIVERSAL)
    expect((error as UninitializedAccountError).code).toBe(
      "UNINITIALIZED_ACCOUNT",
    )
  })

  test.each([
    ["view-invalid-universal-state-init", "InvalidUniversalStateInitReceiver"],
    [
      "view-invalid-deterministic-state-init",
      "InvalidDeterministicStateInitReceiver",
    ],
  ])("INVALID_STATE_INIT (%s)", async (name, reason) => {
    mockRpc({ query: fixture(name) })
    const error = await new RpcClient("https://rpc.test")
      .viewFunction(
        UNIVERSAL,
        "anything",
        {},
        {
          stateInit: { universal: new Uint8Array(10) },
        },
      )
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(InvalidStateInitError)
    const invalid = error as InvalidStateInitError
    expect(invalid.details).toHaveProperty(reason)
    expect(invalid.message).toMatch(/^invalid state init: \w+StateInit action/)
  })

  test("a signed send_tx timeout sent with HTTP 408 is a TimeoutError", async () => {
    const requests = mockRpc({ send_tx: fixture("send-tx-refused-timeout") })
    const rpc = new RpcClient(
      "https://rpc.test",
      {},
      {
        maxRetries: 1,
        initialDelayMs: 1,
      },
    )
    await expect(rpc.call("send_tx", {})).rejects.toBeInstanceOf(TimeoutError)
    // TimeoutError stays retryable for signed transactions.
    expect(requests).toHaveLength(2)
  })

  test("a 408 without a JSON-RPC error body stays a NetworkError", async () => {
    global.fetch = vi.fn(
      async () => new Response("Request Timeout", { status: 408 }),
    ) as unknown as typeof global.fetch
    const rpc = new RpcClient(
      "https://rpc.test",
      {},
      {
        maxRetries: 0,
        initialDelayMs: 1,
      },
    )
    await expect(rpc.call("send_tx", {})).rejects.toBeInstanceOf(NetworkError)
  })
})

describe("RpcClient.getProtocolConfig", () => {
  test("types the 2.15 external call limits and keeps the rest", async () => {
    // The values a 2.15.0-rc.1 sandbox reports.
    mockRpc({
      EXPERIMENTAL_protocol_config: ok({
        chain_id: "localnet",
        protocol_version: 89,
        genesis_height: 0,
        runtime_config: {
          storage_amount_per_byte: "10000000000000000000",
          wasm_config: {
            limit_config: {
              max_gas_burnt: 300000000000000,
              max_gas_burnt_external: 20000000000000,
              max_transaction_size: 1572864,
            },
          },
          external_calls_config: {
            max_call_size: 20480,
            max_call_recorded_size: 51200,
            chunk_compute_share: [2, 5],
            chunk_storage_proof_share: [1, 10],
            chunk_transactions_size_share: [1, 40],
            max_calls_per_chunk: 100,
          },
        },
      }),
    })
    const config = await new RpcClient("https://rpc.test").getProtocolConfig()
    expect(config.protocol_version).toBe(89)
    expect(config.runtime_config.external_calls_config).toEqual({
      max_call_size: 20480,
      max_call_recorded_size: 51200,
      chunk_compute_share: [2, 5],
      chunk_storage_proof_share: [1, 10],
      chunk_transactions_size_share: [1, 40],
      max_calls_per_chunk: 100,
    })
    expect(
      config.runtime_config.wasm_config?.limit_config?.max_gas_burnt_external,
    ).toBe(20000000000000)
    expect((config as Record<string, unknown>)["genesis_height"]).toBe(0)
  })

  test("parses a 2.14 config without external calls", async () => {
    mockRpc({
      EXPERIMENTAL_protocol_config: ok({
        chain_id: "localnet",
        protocol_version: 88,
        runtime_config: {
          wasm_config: {
            limit_config: {
              max_gas_burnt: 300000000000000,
              max_transaction_size: 1572864,
            },
          },
        },
      }),
    })
    const config = await new RpcClient("https://rpc.test").getProtocolConfig()
    expect(config.runtime_config.external_calls_config).toBeUndefined()
    expect(
      config.runtime_config.wasm_config?.limit_config?.max_gas_burnt_external,
    ).toBeUndefined()
  })
})
