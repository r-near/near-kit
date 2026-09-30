/** Local HTTP fixture. It models node admission and transport faults, never SDK retries. */
import type { IncomingMessage, ServerResponse } from "node:http"
import type { Plugin } from "vite"
import {
  inspectSignedTransaction,
  type WireTransaction,
} from "./wire-oracle.js"

const hash = "11111111111111111111111111111111"
const block = {
  author: "validator.near",
  chunks: [],
  header: {
    height: 100,
    epoch_id: hash,
    next_epoch_id: hash,
    hash,
    prev_hash: hash,
    prev_state_root: hash,
    chunk_receipts_root: hash,
    chunk_headers_root: hash,
    chunk_tx_root: hash,
    outcome_root: hash,
    chunks_included: 0,
    challenges_root: hash,
    timestamp: 1,
    timestamp_nanosec: "1",
    random_value: hash,
    validator_proposals: [],
    chunk_mask: [],
    gas_price: "1",
    total_supply: "1",
    challenges_result: [],
    last_final_block: hash,
    last_ds_final_block: hash,
    next_bp_hash: hash,
    block_merkle_root: hash,
    approvals: [],
    signature: "fixture",
    latest_protocol_version: 85,
  },
}
export interface Submission extends WireTransaction {
  bytes: string
  accepted: boolean
}
export interface RpcSnapshot {
  scenario: string
  methods: string[]
  reads: { id: string; aborted: boolean }[]
  submissions: Submission[]
  statusHashes: string[]
  accepted: number
  headers: (string | undefined)[]
}
interface State extends RpcSnapshot {
  nonces: Map<string, number>
  ledger: Map<string, WireTransaction>
  held: Map<string, () => void>
}
function outcome(tx: WireTransaction) {
  const value =
    tx.actions.find((a) => a.kind === "functionCall")?.args?.["id"] ?? null
  const status = {
    SuccessValue: Buffer.from(JSON.stringify(value)).toString("base64"),
  }
  return {
    final_execution_status: "EXECUTED_OPTIMISTIC",
    status,
    transaction: {
      signer_id: tx.signerId,
      receiver_id: tx.receiverId,
      public_key: tx.publicKey,
      nonce: tx.nonce,
      hash: tx.hash,
      actions: [],
      signature: "fixture",
    },
    transaction_outcome: {
      id: tx.hash,
      block_hash: hash,
      proof: [],
      outcome: {
        logs: [],
        receipt_ids: [],
        gas_burnt: 0,
        tokens_burnt: "0",
        executor_id: tx.receiverId,
        status,
      },
    },
    receipts_outcome: [],
    receipts: [],
  }
}
async function body(
  request: IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString())
}
function json(response: ServerResponse, value: unknown) {
  response.setHeader("content-type", "application/json")
  response.end(JSON.stringify(value))
}
export function rpcFixturePlugin(): Plugin {
  const states = new Map<string, State>()
  return {
    name: "local-near-rpc-fixture",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const match = /^\/(rpc|__test)\/([^/]+)(?:\/(release))?$/.exec(
          request.url ?? "",
        )
        if (!match) {
          next()
          return
        }
        const id = match[2] ?? ""
        void (async () => {
          if (match[1] === "__test") {
            if (request.method === "POST" && !match[3]) {
              const config = await body(request)
              states.set(id, {
                scenario:
                  typeof config["scenario"] === "string"
                    ? config["scenario"]
                    : "default",
                methods: [],
                reads: [],
                submissions: [],
                statusHashes: [],
                accepted: 0,
                headers: [],
                nonces: new Map(),
                ledger: new Map(),
                held: new Map(),
              })
            }
            const state = states.get(id)
            if (!state) {
              response.statusCode = 404
              json(response, { error: "Missing fixture" })
              return
            }
            if (request.method === "DELETE") {
              for (const release of state.held.values()) release()
              states.delete(id)
            }
            if (match[3]) {
              const command = await body(request)
              state.held.get(String(command["id"]))?.()
            }
            const {
              nonces: _nonces,
              ledger: _ledger,
              held: _held,
              ...snapshot
            } = state
            json(response, snapshot)
            return
          }
          const state = states.get(id)
          if (!state) throw new Error(`Missing fixture ${id}`)
          const rpc = await body(request)
          const method = String(rpc["method"])
          const params = (rpc["params"] ?? {}) as Record<string, unknown>
          state.methods.push(method)
          state.headers.push(
            typeof request.headers["x-fixture-service"] === "string"
              ? request.headers["x-fixture-service"]
              : undefined,
          )
          const result = (value: unknown) =>
            json(response, { jsonrpc: "2.0", id: rpc["id"], result: value })
          const nonceError = (
            nonce: number,
            chain: number,
            responseId = rpc["id"],
          ) =>
            json(response, {
              jsonrpc: "2.0",
              id: responseId,
              error: {
                name: "HANDLER_ERROR",
                code: -32000,
                message: "Nonce rejected",
                cause: { name: "INVALID_TRANSACTION", info: {} },
                data: {
                  TxExecutionError: {
                    InvalidTxError: {
                      InvalidNonce: { tx_nonce: nonce, ak_nonce: chain },
                    },
                  },
                },
              },
            })
          if (method === "EXPERIMENTAL_view_gas_key_nonces") {
            result({ nonces: [10, 20, 30] })
            return
          }
          if (method === "block") {
            result(block)
            return
          }
          if (method === "query") {
            const kind = params["request_type"]
            if (kind === "view_account") {
              result({
                amount: "2000000000000000000000000",
                locked: "0",
                code_hash: hash,
                storage_usage: 0,
                storage_paid_at: 0,
                block_height: 100,
                block_hash: hash,
              })
              return
            }
            if (kind === "view_access_key") {
              result({
                nonce: state.nonces.get(String(params["public_key"])) ?? 1,
                permission: "FullAccess",
                block_height: 100,
                block_hash: hash,
              })
              return
            }
            if (kind === "view_gas_key_nonces") {
              result({
                nonces: [10, 20, 30],
                block_height: 100,
                block_hash: hash,
              })
              return
            }
            if (kind !== "call_function")
              throw new Error(`Unexpected query ${String(kind)}`)
            const args: Record<string, unknown> = JSON.parse(
              Buffer.from(String(params["args_base64"]), "base64").toString(),
            )
            const readId = typeof args["id"] === "string" ? args["id"] : "7"
            const read = { id: readId, aborted: false }
            state.reads.push(read)
            response.on("close", () => {
              if (!response.writableEnded) read.aborted = true
            })
            const value = {
              result: [...Buffer.from(JSON.stringify(args["id"] ?? 7))],
              logs: [],
              block_height: 100,
              block_hash: hash,
            }
            if (state.scenario === "malformed") {
              result({ ...value, result: "not-byte-array" })
              return
            }
            if (state.scenario === "stream-read" && readId !== "fast") {
              response.writeHead(200, { "content-type": "application/json" })
              const encoded = JSON.stringify({
                jsonrpc: "2.0",
                id: rpc["id"],
                result: value,
              })
              response.write(encoded.slice(0, 12))
              state.held.set(readId, () => {
                response.end(encoded.slice(12))
                state.held.delete(readId)
              })
              return
            }
            if (state.scenario === "held-reads" && readId !== "fast") {
              state.held.set(readId, () => {
                result(value)
                state.held.delete(readId)
              })
              return
            }
            result(value)
            return
          }
          if (method === "send_tx") {
            const bytes = String(params["signed_tx_base64"])
            const tx = inspectSignedTransaction(bytes)
            if (!tx.signatureValid)
              throw new Error("Invalid browser transaction signature")
            const chain = state.nonces.get(tx.publicKey) ?? 1
            const record = { ...tx, bytes, accepted: false }
            state.submissions.push(record)
            if (
              state.scenario === "nonce-rejected" &&
              state.submissions.length === 1
            ) {
              state.nonces.set(tx.publicKey, 10)
              nonceError(tx.nonce, 10)
              return
            }
            if (tx.nonce <= chain) {
              nonceError(tx.nonce, chain)
              return
            }
            state.nonces.set(tx.publicKey, tx.nonce)
            state.ledger.set(tx.hash, tx)
            record.accepted = true
            state.accepted++
            if (state.accepted === 1 && state.scenario.startsWith("lost-")) {
              response.destroy()
              return
            }
            if (
              state.accepted === 1 &&
              ["stale-id", "stale-nonce", "contradictory-nonce"].includes(
                state.scenario,
              )
            ) {
              nonceError(
                state.scenario === "stale-nonce" ? tx.nonce - 1 : tx.nonce,
                state.scenario === "contradictory-nonce"
                  ? tx.nonce - 1
                  : tx.nonce,
                state.scenario === "stale-id"
                  ? `${String(rpc["id"])}-other`
                  : rpc["id"],
              )
              return
            }
            if (state.scenario === "mutation-hold") {
              const mutationId = String(tx.actions[0]?.args?.["id"])
              state.held.set(mutationId, () => {
                result(outcome(tx))
                state.held.delete(mutationId)
              })
              return
            }
            result(outcome(tx))
            return
          }
          if (method === "EXPERIMENTAL_tx_status" || method === "tx") {
            const requested = String(params["tx_hash"])
            state.statusHashes.push(requested)
            const tx = state.ledger.get(requested)
            if (
              ["lost-known", "accepted-known"].includes(state.scenario) &&
              tx
            ) {
              result(outcome(tx))
              return
            }
            json(response, {
              jsonrpc: "2.0",
              id: rpc["id"],
              error: {
                name: "HANDLER_ERROR",
                code: -32000,
                message: "Transaction not yet visible on this node",
                cause: {
                  name: "UNKNOWN_TRANSACTION",
                  info: { requested_transaction_hash: requested },
                },
              },
            })
            return
          }
          throw new Error(`Unexpected RPC ${method}`)
        })().catch((error) => {
          response.statusCode = 500
          json(response, { fixtureError: String(error) })
        })
      })
    },
  }
}
