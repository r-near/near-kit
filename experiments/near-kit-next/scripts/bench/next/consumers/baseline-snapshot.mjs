import { Near } from "near-kit"
import {
  collectSnapshot,
  projectAccount,
  projectBlock,
  projectCode,
  projectKeys,
  projectPage,
} from "./common.mjs"
export function make(url) {
  const rpc = new Near({
    network: "testnet",
    rpcUrl: url,
    retryConfig: { maxRetries: 0 },
  }).rpc
  const api = {
    block: async () => projectBlock(await rpc.getBlock({ finality: "final" })),
    account: async (id, blockId) =>
      projectAccount(await rpc.getAccount(id, { blockId })),
    keys: async (id, blockId) =>
      projectKeys(await rpc.getAccessKeys(id, { blockId })),
    code: async (id, blockId) =>
      projectCode(await rpc.viewCode(id, { blockId })),
    gas: async (hash) => BigInt((await rpc.getGasPrice(hash)).gas_price),
    page: async (id, blockId, afterKey) =>
      projectPage(
        await rpc.viewState(id, {
          blockId,
          prefix: "",
          limit: 100,
          ...(afterKey === undefined ? {} : { afterKey }),
        }),
      ),
  }
  return (id) => collectSnapshot(api, id)
}
