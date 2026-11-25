import { JsonRpcProvider } from "near-api-js"
import {
  four,
  projectAccount,
  projectBytes,
  projectView,
  reference,
} from "./common.mjs"
export const supportsCancellation = false
export function make(url) {
  // In 7.3.1 this option feeds numOfAttempts, despite the name "retries".
  const rpc = new JsonRpcProvider({ url }, { retries: 1, wait: 0, backoff: 1 })
  const call = (id, at) =>
    rpc.callFunctionRaw({
      contractId: id,
      method: "count",
      args: {},
      blockQuery: reference(at),
    })
  const api = {
    account: async (id, at = "final") =>
      projectAccount(
        await rpc.viewAccount({ accountId: id, blockQuery: reference(at) }),
      ),
    view: async (id, at = "final") => projectView(await call(id, at)),
    bytes: async (id, at = "final") => projectBytes(await call(id, at)),
    four: (hash) => four(api, hash),
  }
  return api
}
