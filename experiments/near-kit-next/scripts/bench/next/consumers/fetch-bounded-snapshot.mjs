import { transport } from "./fetch-transport.mjs"
import { collectSnapshot, projectAccount, projectBlock, projectKeys, projectCode, projectPage } from "./common.mjs"
export function make(url) {
  const rpc = transport(url, true)
  const query = (request_type, account_id, block_id, more, signal) => rpc("query", { request_type, account_id, block_id, ...more }, signal)
  const api = {
    block: async signal => projectBlock(await rpc("block", { finality: "final" }, signal)),
    account: async (id, hash, signal) => projectAccount(await query("view_account", id, hash, {}, signal)),
    keys: async (id, hash, signal) => projectKeys(await query("view_access_key_list", id, hash, {}, signal)),
    code: async (id, hash, signal) => projectCode(await query("view_code", id, hash, {}, signal)),
    gas: async (hash, signal) => BigInt((await rpc("gas_price", [hash], signal)).gas_price),
    page: async (id, hash, cursor, signal) => projectPage(await query("view_state", id, hash, { prefix_base64: "", limit: 100, ...(cursor === undefined ? {} : { after_key_base64: cursor }) }, signal)),
  }
  return (id, signal) => collectSnapshot(api, id, signal)
}
