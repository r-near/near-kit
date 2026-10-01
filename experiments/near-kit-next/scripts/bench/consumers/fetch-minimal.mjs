import {
  four,
  projectAccount,
  projectBytes,
  projectView,
  wireReference,
} from "./common.mjs"
export const supportsCancellation = true
export function make(url) {
  let nextId = 0
  const query = async (params, signal) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: ++nextId,
        method: "query",
        params,
      }),
      signal,
      redirect: "error",
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const envelope = await response.json()
    if (envelope.error) throw new Error("RPC error")
    return envelope.result
  }
  const call = (id, at, signal) =>
    query(
      {
        request_type: "call_function",
        account_id: id,
        method_name: "count",
        args_base64: "e30=",
        ...wireReference(at),
      },
      signal,
    )
  const api = {
    account: async (id, at = "final", signal) =>
      projectAccount(
        await query(
          {
            request_type: "view_account",
            account_id: id,
            ...wireReference(at),
          },
          signal,
        ),
      ),
    view: async (id, at = "final", signal) =>
      projectView(await call(id, at, signal)),
    bytes: async (id, at = "final", signal) =>
      projectBytes(await call(id, at, signal)),
    four: (hash) => four(api, hash),
  }
  return api
}
