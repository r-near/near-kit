import { Near } from "near-kit"
import {
  four,
  projectAccount,
  projectBytes,
  projectView,
  reference,
} from "./common.mjs"
export const supportsCancellation = false
export function make(url) {
  const rpc = new Near({
    network: "testnet",
    rpcUrl: url,
    retryConfig: { maxRetries: 0 },
  }).rpc
  const api = {
    account: async (id, at = "final") =>
      projectAccount(await rpc.getAccount(id, reference(at))),
    view: async (id, at = "final") =>
      projectView(await rpc.viewFunction(id, "count", {}, reference(at))),
    bytes: async (id, at = "final") =>
      projectBytes(await rpc.viewFunction(id, "count", {}, reference(at))),
    four: (hash) => four(api, hash),
  }
  return api
}
