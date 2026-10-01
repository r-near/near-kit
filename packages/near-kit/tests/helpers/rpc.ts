import { runSync } from "../../src/effect/runtime.js"
import type { RpcRetryConfigInput } from "../../src/core/config-schemas.js"
import { type RpcFetch, rpcToPromises } from "../../src/core/rpc/rpc.js"
import {
  fetchTransport,
  makeRpcPrograms,
} from "../../src/core/rpc/rpc-program.js"

export function testRpcPrograms(
  url: string,
  transport: RpcFetch = (url, init) => globalThis.fetch(url, init),
  headers?: Record<string, string>,
  retry?: RpcRetryConfigInput,
) {
  return runSync(
    makeRpcPrograms(
      { url, ...(headers ? { headers } : {}), ...(retry ? { retry } : {}) },
      fetchTransport(transport),
    ),
  )
}

export function testRpcClient(
  url: string,
  headers?: Record<string, string>,
  retry?: RpcRetryConfigInput,
) {
  return rpcToPromises(testRpcPrograms(url, undefined, headers, retry))
}

// Complete wire fixture for transaction tests that intentionally cross RPC decoding.
export const testBlockHash = "11111111111111111111111111111111"
export const testBlock = {
  author: "validator.near",
  chunks: [],
  header: {
    height: 100,
    epoch_id: testBlockHash,
    next_epoch_id: testBlockHash,
    hash: testBlockHash,
    prev_hash: testBlockHash,
    prev_state_root: testBlockHash,
    chunk_receipts_root: testBlockHash,
    chunk_headers_root: testBlockHash,
    chunk_tx_root: testBlockHash,
    outcome_root: testBlockHash,
    chunks_included: 0,
    challenges_root: testBlockHash,
    timestamp: 1,
    timestamp_nanosec: "1",
    random_value: testBlockHash,
    validator_proposals: [],
    chunk_mask: [],
    gas_price: "1",
    total_supply: "1",
    challenges_result: [],
    last_final_block: testBlockHash,
    last_ds_final_block: testBlockHash,
    next_bp_hash: testBlockHash,
    block_merkle_root: testBlockHash,
    approvals: [],
    signature: "fixture",
    latest_protocol_version: 85,
  },
}
