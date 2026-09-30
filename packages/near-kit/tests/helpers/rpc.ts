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
