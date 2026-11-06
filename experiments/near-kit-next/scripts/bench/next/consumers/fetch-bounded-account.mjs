import { projectAccount, wireReference } from "./account-common.mjs"
import { transport } from "./fetch-transport.mjs"
export const supportsCancellation = true
export function make(url) {
  const rpc = transport(url, true)
  return async (id, at = "final", signal) =>
    projectAccount(
      await rpc(
        "query",
        { request_type: "view_account", account_id: id, ...wireReference(at) },
        signal,
      ),
    )
}
