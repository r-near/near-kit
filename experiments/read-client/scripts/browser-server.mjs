import { readFile } from "node:fs/promises"
import { createServer } from "node:http"
import { build } from "esbuild"

await build({
  entryPoints: ["test/browser/app.tsx"],
  outfile: "artifacts/browser/app.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  jsx: "automatic",
})
const hash = "56xEo2LorUFVNbkFhCncFSWNiobdp1kzm14nZ47b5JVW"
let sequence = 0
let hold = false
let observations = []
const pending = new Map()
const json = (response, body) => {
  if (!response.headersSent)
    response.setHeader("content-type", "application/json")
  response.end(JSON.stringify(body))
}
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://127.0.0.1")
    if (url.pathname === "/") {
      response.setHeader("content-type", "text/html")
      response.end(
        '<!doctype html><html><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>',
      )
      return
    }
    if (url.pathname === "/app.js") {
      response.setHeader("content-type", "text/javascript")
      response.end(await readFile("artifacts/browser/app.js"))
      return
    }
    if (url.pathname === "/control/reset") {
      for (const value of pending.values()) value.response.destroy()
      pending.clear()
      observations = []
      sequence = 0
      hold = false
      json(response, { ok: true })
      return
    }
    if (url.pathname === "/control/hold") {
      hold = true
      json(response, { ok: true })
      return
    }
    if (url.pathname === "/control/state") {
      json(response, observations)
      return
    }
    if (url.pathname === "/control/release") {
      const value = pending.get(Number(url.searchParams.get("id")))
      if (value) {
        value.observation.released = true
        json(value.response, value.envelope)
        pending.delete(value.observation.id)
      }
      json(response, { released: Boolean(value) })
      return
    }
    if (url.pathname.startsWith("/rpc/") || url.pathname === "/immediate") {
      const chunks = []
      for await (const chunk of request) chunks.push(chunk)
      const rpc = JSON.parse(Buffer.concat(chunks).toString())
      if (url.pathname === "/immediate") {
        const bytes =
          rpc.params.method_name === "binary"
            ? [0, 255, 1]
            : Array.from(new TextEncoder().encode('{"count":7}'))
        json(response, {
          jsonrpc: "2.0",
          id: rpc.id,
          result: {
            result: bytes,
            logs: [],
            block_hash: hash,
            block_height: 123,
          },
        })
        return
      }
      const id = ++sequence
      const observation = {
        id,
        accountId: rpc.params.account_id,
        network: url.pathname,
        amount: String(id),
        aborted: false,
        released: false,
      }
      observations.push(observation)
      response.on("close", () => {
        if (!response.writableEnded) observation.aborted = true
        pending.delete(id)
      })
      if (url.pathname === "/rpc/failure") {
        response.writeHead(503)
        response.end()
        return
      }
      const result = {
        amount: String(id),
        locked: "0",
        storage_usage: 10,
        code_hash: "11111111111111111111111111111111",
        block_hash: hash,
        block_height: 123,
      }
      const envelope = { jsonrpc: "2.0", id: rpc.id, result }
      if (hold) {
        response.setHeader("content-type", "application/json")
        response.flushHeaders()
        pending.set(id, { response, observation, envelope })
      } else {
        observation.released = true
        json(response, envelope)
      }
      return
    }
    response.writeHead(404)
    response.end()
  } catch {
    response.writeHead(500)
    response.end()
  }
})
server.listen(
  Number(process.env.BROWSER_TEST_PORT ?? 4177),
  "127.0.0.1",
  () => {
    console.log(JSON.stringify({ ready: true, port: server.address().port }))
  },
)
process.once("SIGTERM", () => {
  server.closeAllConnections()
  server.close(() => process.exit(0))
})
