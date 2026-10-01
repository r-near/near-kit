import { JsonRpcProvider } from "near-api-js"
import { collectSnapshot, projectAccount, projectBlock, projectKeys, projectCode, projectPage } from "./common.mjs"
// 7.3.1's named key-list API cannot pin a hash; named state API has no page cursor.
// Use its public read-only query API for these two operations, labelled in results.
export function make(url) {
  const rpc = new JsonRpcProvider({ url }, { retries: 1, wait: 0, backoff: 1 })
  const api = {
    block: async () => projectBlock(await rpc.viewBlock({ finality: "final" })),
    account: async (id, blockId) => projectAccount(await rpc.viewAccount({ accountId: id, blockQuery: { blockId } })),
    keys: async (id, block_id) => projectKeys(await rpc.query({ request_type: "view_access_key_list", account_id: id, block_id })),
    code: async (id, blockId) => projectCode(await rpc.viewContractCode({ contractId: id, blockQuery: { blockId } })),
    gas: async hash => BigInt((await rpc.viewGasPrice(hash)).gas_price),
    page: async (id, block_id, after_key_base64) => projectPage(await rpc.query({ request_type: "view_state", account_id: id, block_id, prefix_base64: "", limit: 100, ...(after_key_base64 === undefined ? {} : { after_key_base64 }) })),
  }
  return id => collectSnapshot(api, id)
}
