import { once } from "node:events"
import { createServer } from "node:http"

export const hash = "56xEo2LorUFVNbkFhCncFSWNiobdp1kzm14nZ47b5JVW"
export const account = {
  amount: "1234567890123456789012345",
  locked: "0",
  storage_usage: 410,
  storage_paid_at: 0,
  code_hash: "11111111111111111111111111111111",
  block_height: 123,
  block_hash: hash,
}
export const view = {
  result: Array.from(new TextEncoder().encode('{"count":7}')),
  logs: ["fixture log"],
  block_height: 123,
  block_hash: hash,
}

export async function fixture() {
  const counts = {}
  const violations = []
  const server = createServer(async (request, response) => {
    const key = request.url
    counts[key] ??= {
      requests: 0,
      interruptedBodies: 0,
      selections: {},
      types: {},
    }
    const count = counts[key]
    count.requests++
    response.on("close", () => {
      if (!response.writableEnded) count.interruptedBodies++
    })
    const bytes = []
    for await (const chunk of request) bytes.push(chunk)
    let body
    try {
      body = JSON.parse(Buffer.concat(bytes).toString("utf8"))
    } catch {
      response.writeHead(400).end()
      return
    }
    const params = body.params
    if (
      request.method !== "POST" ||
      body.method !== "query" ||
      !["view_account", "call_function"].includes(params?.request_type)
    ) {
      violations.push({ key, method: body.method, type: params?.request_type })
      response.writeHead(400).end("Read fixture rejects unsupported methods")
      return
    }
    const selection =
      params.finality === "final" && !Object.hasOwn(params, "block_id")
        ? "final"
        : params.block_id === hash && !Object.hasOwn(params, "finality")
          ? "hash"
          : "invalid"
    count.selections[selection] = (count.selections[selection] ?? 0) + 1
    count.types[params.request_type] =
      (count.types[params.request_type] ?? 0) + 1
    if (selection === "invalid") violations.push({ key, selection: params })
    if (
      params.request_type === "call_function" &&
      (params.method_name !== "count" || params.args_base64 !== "e30=")
    )
      violations.push({ key, viewArguments: params })
    if (key.endsWith("/http503") || key.endsWith("/retry3")) {
      response
        .writeHead(503, { "content-type": "application/json" })
        .end('{"unavailable":true}')
      return
    }
    if (key.endsWith("/cancel")) {
      response.writeHead(200, { "content-type": "application/json" })
      response.flushHeaders()
      response.write('{"jsonrpc":"2.0",')
      return
    }
    const envelope =
      params.account_id === "missing.testnet"
        ? {
            jsonrpc: "2.0",
            id: body.id,
            error: {
              code: -32000,
              message: "Server error",
              name: "HANDLER_ERROR",
              data: "account does not exist",
              cause: {
                name: "UNKNOWN_ACCOUNT",
                info: {
                  requested_account_id: params.account_id,
                  block_hash: hash,
                  block_height: 123,
                },
              },
            },
          }
        : {
            jsonrpc: "2.0",
            id: body.id,
            result: params.request_type === "view_account" ? account : view,
          }
    response
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify(envelope))
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    counts,
    violations,
    close: async () => {
      server.closeAllConnections()
      server.close()
      await once(server, "close")
    },
  }
}
