/**
 * Near.findExternalCall against a simulated chain: which copies landed at
 * which heights, what the head is, and how send_tx answers a resend.
 */

import { base64 } from "@scure/base"
import { afterEach, describe, expect, test, vi } from "vitest"
import { externalCallUniqueId } from "../../src/core/external-call.js"
import { Near } from "../../src/core/near.js"
import {
  ContractNotDeployedError,
  ExternalCallRefusedError,
  FunctionCallError,
  NetworkError,
  ShardUnavailableError,
} from "../../src/errors/index.js"

const CONTRACT = "wallet.near"
const PAYLOAD = Uint8Array.of(1, 2, 3)
const CALL = { contractId: CONTRACT, payload: PAYLOAD }
const H = "11111111111111111111111111111111"
const idAt = (height: number) => externalCallUniqueId(CALL, height)

type Copy = "accepted" | "refused" | "failed-receipt"
type SendReply =
  | { landedAt: number }
  | "timeout"
  | { pendingAt: number }
  | "not-tracked"
  | "no-contract"

type Request = { method: string; params: Record<string, unknown> }

const rpcError = (name: string, info: unknown, http = 200, data?: unknown) => ({
  http,
  body: {
    jsonrpc: "2.0",
    id: 1,
    error: {
      name: "HANDLER_ERROR",
      cause: { name, info },
      code: -32000,
      message: "Server error",
      data,
    },
  },
})

const outcome = (id: string, status: unknown, executor = CONTRACT) => ({
  id,
  outcome: {
    logs: ["checked"],
    receipt_ids: [],
    gas_burnt: 1,
    tokens_burnt: "0",
    executor_id: executor,
    status,
  },
  block_hash: H,
  proof: [],
})

const REFUSAL = {
  InvalidTxError: {
    ExternalCallChunkShareReached: {
      share: { Compute: { used: 2, limit: 1 } },
    },
  },
}
const RECEIPT_FAILURE = {
  ActionError: {
    index: 0,
    kind: { FunctionCallError: { MethodResolveError: "MethodNotFound" } },
  },
}

/** The view of the copy that landed at `height`. */
function copyView(height: number, copy: Copy, waitUntil = "FINAL") {
  const id = idAt(height)
  const failed = copy === "refused" || copy === "failed-receipt"
  return {
    final_execution_status: waitUntil,
    status: failed
      ? { Failure: copy === "refused" ? REFUSAL : RECEIPT_FAILURE }
      : { SuccessValue: "" },
    transaction: {
      kind: "external_call",
      contract_id: CONTRACT,
      payload: base64.encode(PAYLOAD),
      state_init: null,
      transaction_id: id,
    },
    transaction_outcome: outcome(
      id,
      copy === "refused" ? { Failure: REFUSAL } : { SuccessReceiptId: H },
    ),
    receipts_outcome:
      copy === "failed-receipt"
        ? [outcome(H, { Failure: RECEIPT_FAILURE })]
        : [],
    receipts: [],
  }
}

function block(height: number) {
  return {
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
      gas_price: "1",
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
  }
}

/**
 * Mock the RPC as a chain whose copies of CALL landed at the given heights.
 * `head` is read on every `block` request, so a test can move it.
 */
function chain(options: {
  copies?: Record<number, Copy>
  head: number | (() => number)
  send?: SendReply
  probeError?: ReturnType<typeof rpcError>
}) {
  const requests: Request[] = []
  const copies = options.copies ?? {}
  const heightOf = (id: unknown) =>
    Object.keys(copies)
      .map(Number)
      .find((h) => idAt(h) === id)
  const ok = (result: unknown) => ({
    http: 200,
    body: { jsonrpc: "2.0", id: 1, result },
  })

  global.fetch = vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
    const request = JSON.parse(String(init?.body)) as Request
    requests.push(request)
    const reply = (() => {
      switch (request.method) {
        case "block":
          return ok(
            block(
              typeof options.head === "function"
                ? options.head()
                : options.head,
            ),
          )
        case "tx":
        case "EXPERIMENTAL_tx_status": {
          if (options.probeError) return options.probeError
          const height = heightOf(request.params["tx_hash"])
          if (height === undefined) {
            return rpcError("UNKNOWN_TRANSACTION", {
              requested_transaction_hash: request.params["tx_hash"],
            })
          }
          return ok(
            copyView(
              height,
              copies[height] as Copy,
              request.params["wait_until"] as string,
            ),
          )
        }
        case "send_tx": {
          const send = options.send
          if (send === "timeout") {
            return rpcError("TIMEOUT_ERROR", { cause: "NOT_OBSERVED" }, 408)
          }
          if (send === "not-tracked") {
            return rpcError("DOES_NOT_TRACK_SHARD", {})
          }
          if (send === "no-contract") {
            return rpcError("INVALID_TRANSACTION", {}, 200, {
              TxExecutionError: {
                InvalidTxError: { ContractNotFound: { contract_id: CONTRACT } },
              },
            })
          }
          if (send && "pendingAt" in send) {
            return rpcError(
              "TIMEOUT_ERROR",
              {
                cause: "PENDING",
                status: copyView(send.pendingAt, "accepted", "INCLUDED"),
              },
              408,
            )
          }
          if (send && "landedAt" in send) {
            const copy = copies[send.landedAt] ?? "accepted"
            const { receipts: _, ...view } = copyView(send.landedAt, copy)
            return ok({
              ...view,
              final_execution_status: request.params["wait_until"],
            })
          }
          throw new Error("send_tx not expected")
        }
        default:
          throw new Error(`unexpected method ${request.method}`)
      }
    })()
    return new Response(JSON.stringify(reply.body), { status: reply.http })
  }) as unknown as typeof global.fetch

  return {
    requests,
    probed: () =>
      requests
        .filter((r) => r.method === "tx")
        .map((r) => r.params["tx_hash"] as string),
    looked: () =>
      requests
        .filter((r) => r.method === "EXPERIMENTAL_tx_status")
        .map((r) => r.params["tx_hash"] as string),
    sends: () => requests.filter((r) => r.method === "send_tx"),
  }
}

const near = () =>
  new Near({
    network: { networkId: "localnet", rpcUrl: "https://rpc.test" },
    retryConfig: { maxRetries: 0, initialDelayMs: 1 },
  })

const originalFetch = global.fetch
afterEach(() => {
  global.fetch = originalFetch
  vi.useRealTimers()
})

describe("search", () => {
  test("returns the copy at the lowest height, looked up at the wait level", async () => {
    const rpc = chain({ head: 30, copies: { 14: "accepted", 17: "accepted" } })
    const found = await near().findExternalCall(CONTRACT, PAYLOAD, {
      fromHeight: 10,
      waitUntil: "FINAL",
    })
    expect(found?.transaction.transaction_id).toBe(idAt(14))
    expect(found?.final_execution_status).toBe("FINAL")
    expect(rpc.looked()).toEqual([idAt(14)])
    expect(
      rpc.requests.find((r) => r.method === "EXPERIMENTAL_tx_status")?.params,
    ).toEqual({
      tx_hash: idAt(14),
      sender_account_id: CONTRACT,
      wait_until: "FINAL",
    })
  })

  test("tries heights in order, eight at a time, and stops at the first batch with a hit", async () => {
    const rpc = chain({ head: 100, copies: { 57: "accepted" } })
    await near().findExternalCall(CONTRACT, PAYLOAD, { fromHeight: 0 })
    // Heights 0..63: eight batches of eight, the last holding 57.
    expect(rpc.probed()).toEqual(Array.from({ length: 64 }, (_, h) => idAt(h)))
  })

  test("probes with wait_until NONE and the contract as sender", async () => {
    const rpc = chain({ head: 3, copies: { 3: "accepted" } })
    await near().findExternalCall(CONTRACT, PAYLOAD, { fromHeight: 3 })
    expect(rpc.requests.find((r) => r.method === "tx")?.params).toEqual({
      tx_hash: idAt(3),
      sender_account_id: CONTRACT,
      wait_until: "NONE",
    })
  })

  test("returns undefined when no height up to the head holds a copy", async () => {
    const rpc = chain({ head: 20 })
    expect(
      await near().findExternalCall(CONTRACT, PAYLOAD, { fromHeight: 10 }),
    ).toBeUndefined()
    expect(rpc.probed()).toHaveLength(11)
  })

  test("returns undefined at once when fromHeight is past the head", async () => {
    const rpc = chain({ head: 5 })
    expect(
      await near().findExternalCall(CONTRACT, PAYLOAD, { fromHeight: 9 }),
    ).toBeUndefined()
    expect(rpc.probed()).toEqual([])
  })

  test("stops at toHeight below the head", async () => {
    const rpc = chain({ head: 50, copies: { 30: "accepted" } })
    expect(
      await near().findExternalCall(CONTRACT, PAYLOAD, {
        fromHeight: 10,
        toHeight: 20,
      }),
    ).toBeUndefined()
    expect(rpc.probed()).toEqual(
      Array.from({ length: 11 }, (_, i) => idAt(10 + i)),
    )
  })

  test("waits for the head to pass toHeight", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] })
    let head = 12
    const rpc = chain({ head: () => head, copies: { 16: "accepted" } })
    const search = near().findExternalCall(CONTRACT, PAYLOAD, {
      fromHeight: 10,
      toHeight: 20,
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(rpc.probed()).toHaveLength(3)
    head = 15
    await vi.advanceTimersByTimeAsync(1000)
    expect(rpc.probed()).toHaveLength(6)
    head = 18
    await vi.advanceTimersByTimeAsync(1000)
    const found = await search
    expect(found?.transaction.transaction_id).toBe(idAt(16))
    // Each height is tried once.
    expect(new Set(rpc.probed()).size).toBe(rpc.probed().length)
  })

  test("gives up once the head passes toHeight with nothing found", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] })
    let head = 12
    chain({ head: () => head })
    let settled = false
    const search = near()
      .findExternalCall(CONTRACT, PAYLOAD, { fromHeight: 10, toHeight: 14 })
      .finally(() => {
        settled = true
      })
    await vi.advanceTimersByTimeAsync(1000)
    expect(settled).toBe(false)
    head = 30
    await vi.advanceTimersByTimeAsync(1000)
    expect(await search).toBeUndefined()
  })

  test("skips a copy refused when it ran and returns a later accepted one", async () => {
    const rpc = chain({ head: 30, copies: { 12: "refused", 21: "accepted" } })
    const found = await near().findExternalCall(CONTRACT, PAYLOAD, {
      fromHeight: 10,
    })
    expect(found?.transaction.transaction_id).toBe(idAt(21))
    expect(rpc.looked()).toEqual([idAt(21)])
  })

  test("throws the refusal when every copy in the range was refused", async () => {
    chain({ head: 30, copies: { 12: "refused", 21: "refused" } })
    const error = await near()
      .findExternalCall(CONTRACT, PAYLOAD, { fromHeight: 10 })
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ExternalCallRefusedError)
    const refusal = error as ExternalCallRefusedError
    expect(refusal.uniqueId).toBe(idAt(21))
    expect(refusal.details).toEqual(REFUSAL)
    expect(refusal.retryable).toBe(true)
    expect(refusal.logs).toEqual(["checked"])
  })

  test("an accepted copy whose receipt failed is found, and its failure reported", async () => {
    chain({ head: 30, copies: { 12: "failed-receipt" } })
    await expect(
      near().findExternalCall(CONTRACT, PAYLOAD, { fromHeight: 10 }),
    ).rejects.toBeInstanceOf(FunctionCallError)
  })

  test("a node that doesn't track the shard fails the search", async () => {
    chain({ head: 30, probeError: rpcError("DOES_NOT_TRACK_SHARD", {}) })
    await expect(
      near().findExternalCall(CONTRACT, PAYLOAD, { fromHeight: 10 }),
    ).rejects.toBeInstanceOf(ShardUnavailableError)
  })

  test("a network error fails the search", async () => {
    chain({ head: 30, probeError: rpcError("SOMETHING_NEW", {}, 503) })
    await expect(
      near().findExternalCall(CONTRACT, PAYLOAD, { fromHeight: 10 }),
    ).rejects.toBeInstanceOf(NetworkError)
  })

  test("the state init doesn't change the ids searched", async () => {
    const rpc = chain({ head: 12, copies: { 12: "accepted" } })
    const found = await near().findExternalCall(CONTRACT, PAYLOAD, {
      fromHeight: 12,
      stateInit: Uint8Array.of(9),
    })
    expect(found?.transaction.transaction_id).toBe(idAt(12))
    expect(rpc.probed()).toEqual([idAt(12)])
  })

  test("a JSON payload is searched as its UTF-8 JSON bytes", async () => {
    const json = { hello: "world" }
    const bytes = new TextEncoder().encode(JSON.stringify(json))
    const id = externalCallUniqueId({ contractId: CONTRACT, payload: bytes }, 4)
    const rpc = chain({ head: 4 })
    await near().findExternalCall(CONTRACT, json, { fromHeight: 4 })
    expect(rpc.probed()).toEqual([id])
  })
})

describe("resend", () => {
  test("follows the copy send_tx returns, without searching", async () => {
    const rpc = chain({
      head: 30,
      copies: { 14: "accepted" },
      send: { landedAt: 14 },
    })
    const found = await near().findExternalCall(CONTRACT, PAYLOAD, {
      fromHeight: 10,
      resend: true,
      waitUntil: "FINAL",
    })
    expect(found?.transaction.transaction_id).toBe(idAt(14))
    expect(rpc.probed()).toEqual([])
    expect(rpc.sends()[0]?.params["wait_until"]).toBe("FINAL")
  })

  test("resends with its state init", async () => {
    const rpc = chain({
      head: 30,
      copies: { 14: "accepted" },
      send: { landedAt: 14 },
    })
    await near().findExternalCall(CONTRACT, PAYLOAD, {
      fromHeight: 10,
      resend: true,
      stateInit: Uint8Array.of(9),
    })
    const sent = base64.decode(
      rpc.sends()[0]?.params["external_call_base64"] as string,
    )
    expect(sent.at(-1)).toBe(9)
  })

  test("waits for inclusion when asked for NONE", async () => {
    const rpc = chain({
      head: 30,
      copies: { 14: "accepted" },
      send: { landedAt: 14 },
    })
    await near().findExternalCall(CONTRACT, PAYLOAD, {
      fromHeight: 10,
      resend: true,
      waitUntil: "NONE",
    })
    expect(rpc.sends()[0]?.params["wait_until"]).toBe("INCLUDED")
  })

  test("follows the copy a pending timeout names", async () => {
    const rpc = chain({
      head: 30,
      copies: { 14: "accepted" },
      send: { pendingAt: 14 },
    })
    const found = await near().findExternalCall(CONTRACT, PAYLOAD, {
      fromHeight: 10,
      resend: true,
    })
    expect(found?.transaction.transaction_id).toBe(idAt(14))
    expect(rpc.probed()).toEqual([])
    expect(rpc.sends()).toHaveLength(1)
  })

  test("searches after a plain timeout", async () => {
    const rpc = chain({ head: 20, copies: { 14: "accepted" }, send: "timeout" })
    const found = await near().findExternalCall(CONTRACT, PAYLOAD, {
      fromHeight: 10,
      resend: true,
    })
    expect(found?.transaction.transaction_id).toBe(idAt(14))
    expect(rpc.sends()).toHaveLength(1)
    expect(rpc.probed().length).toBeGreaterThan(0)
  })

  test("searches when the node doesn't track the shard", async () => {
    chain({ head: 20, copies: { 14: "accepted" }, send: "not-tracked" })
    const found = await near().findExternalCall(CONTRACT, PAYLOAD, {
      fromHeight: 10,
      resend: true,
    })
    expect(found?.transaction.transaction_id).toBe(idAt(14))
  })

  test("searches past a refused copy send_tx returns", async () => {
    const rpc = chain({
      head: 30,
      copies: { 14: "refused", 22: "accepted" },
      send: { landedAt: 14 },
    })
    const found = await near().findExternalCall(CONTRACT, PAYLOAD, {
      fromHeight: 10,
      resend: true,
    })
    expect(found?.transaction.transaction_id).toBe(idAt(22))
    expect(rpc.looked()).toEqual([idAt(22)])
  })

  test("throws send_tx's refusal when the search finds nothing better", async () => {
    chain({ head: 30, copies: { 14: "refused" }, send: { landedAt: 14 } })
    const error = await near()
      .findExternalCall(CONTRACT, PAYLOAD, { fromHeight: 20, resend: true })
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ExternalCallRefusedError)
    expect((error as ExternalCallRefusedError).uniqueId).toBe(idAt(14))
  })

  test("rethrows other send errors", async () => {
    chain({ head: 30, send: "no-contract" })
    await expect(
      near().findExternalCall(CONTRACT, PAYLOAD, {
        fromHeight: 10,
        resend: true,
      }),
    ).rejects.toBeInstanceOf(ContractNotDeployedError)
  })
})
