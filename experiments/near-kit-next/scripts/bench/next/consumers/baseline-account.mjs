import { Near } from "near-kit"
import { projectAccount, reference } from "./account-common.mjs"
export const supportsCancellation = false
export function make(url) {
  const rpc = new Near({ network: "testnet", rpcUrl: url, retryConfig: { maxRetries: 0 } }).rpc
  return async (id, at = "final") => projectAccount(await rpc.getAccount(id, reference(at)))
}
