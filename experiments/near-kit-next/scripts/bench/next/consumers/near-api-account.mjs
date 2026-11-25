import { JsonRpcProvider } from "near-api-js"
import { projectAccount, reference } from "./account-common.mjs"
export const supportsCancellation = false
export function make(url) {
  const rpc = new JsonRpcProvider({ url }, { retries: 1, wait: 0, backoff: 1 })
  return async (id, at = "final") =>
    projectAccount(
      await rpc.viewAccount({ accountId: id, blockQuery: reference(at) }),
    )
}
