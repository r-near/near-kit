import { spawn } from "node:child_process"
import { once } from "node:events"
import { createServer, type ServerResponse } from "node:http"
import { afterEach, beforeEach, expect, it } from "vitest"
import { HASH } from "./fixtures.js"

let respond: (response: ServerResponse) => void
let requests: Array<{ method: string; params: unknown }>
let endpoint: string
const children = new Set<ReturnType<typeof spawn>>()
const server = createServer(async (request, response) => {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk)
  requests.push(JSON.parse(Buffer.concat(chunks).toString()))
  respond(response)
})
beforeEach(async () => {
  requests = []
  respond = (response) =>
    response.end('{"result":{"height":18446744073709551615}}')
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  if (address === null || typeof address === "string")
    throw new Error("No test listener")
  endpoint = `http://127.0.0.1:${address.port}`
})
afterEach(async () => {
  const exits = [...children].map((child) => {
    const closed = once(child, "close")
    child.kill("SIGTERM")
    child.stdout?.destroy()
    child.stderr?.destroy()
    return closed
  })
  await Promise.all(exits)
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})
const start = (...args: string[]) => {
  const child = spawn("sh", ["examples/raw-inspection.sh", ...args], {
    stdio: ["ignore", "pipe", "pipe"],
  })
  children.add(child)
  child.once("close", () => children.delete(child))
  return child
}
async function run(...args: string[]) {
  const child = start(...args)
  let stdout = "",
    stderr = ""
  child.stdout.on("data", (chunk) => {
    stdout += chunk
  })
  child.stderr.on("data", (chunk) => {
    stderr += chunk
  })
  const [code, signal] = await once(child, "close")
  return { code, signal, stdout, stderr }
}
it("executes only named commands and preserves raw integer and RPC error bytes", async () => {
  for (const [command, hash, method, params] of [
    ["block", HASH, "block", { block_id: HASH }],
    ["chunk", HASH, "chunk", { chunk_id: HASH }],
    ["genesis", undefined, "genesis_config", []],
    [
      "config",
      undefined,
      "EXPERIMENTAL_protocol_config",
      { finality: "final" },
    ],
  ] as const) {
    const result = await run(
      endpoint,
      command,
      ...(hash === undefined ? [] : [hash]),
    )
    expect(result.code).toBe(0)
    expect(result.stdout).toBe('{"result":{"height":18446744073709551615}}')
    expect(requests.at(-1)).toMatchObject({ method, params })
  }
  respond = (response) =>
    response.end('{"error":{"code":-32000,"message":"fixture"}}')
  const error = await run(endpoint, "genesis")
  expect(error.code).toBe(0) // Raw inspection deliberately does not classify RPC envelopes.
  expect(error.stdout).toContain('"error"')
})
it("rejects unrelated commands, malformed hash input and non-HTTP protocols before requests", async () => {
  for (const args of [
    [endpoint, "unknown"],
    [endpoint, "block", 'bad"hash'],
    [endpoint, "config", HASH],
    ["file:///ignored", "genesis"],
  ])
    expect((await run(...args)).code).not.toBe(0)
  expect(requests).toHaveLength(0)
})
it("delegates HTTP failures without following a redirect", async () => {
  respond = (response) => {
    response.writeHead(503)
    response.end("unavailable")
  }
  expect((await run(endpoint, "genesis")).code).not.toBe(0)
  respond = (response) => {
    response.writeHead(302, { location: `${endpoint}/elsewhere` })
    response.end("redirect response")
  }
  const redirected = await run(endpoint, "genesis")
  expect(redirected.stdout).toBe("redirect response")
  expect(requests).toHaveLength(2)
})
it("enforces the unknown-length cap and closes an interrupted stalled stdout transfer", async () => {
  respond = (response) => {
    const chunk = Buffer.alloc(65536, 120)
    let written = 0
    const pump = () => {
      while (!response.destroyed && written < 18 * 1024 * 1024) {
        written += chunk.length
        if (!response.write(chunk)) {
          response.once("drain", pump)
          return
        }
      }
      if (!response.destroyed) response.end()
    }
    pump()
  }
  const capped = await run(endpoint, "genesis")
  expect(capped.code).toBe(63)
  expect(Buffer.byteLength(capped.stdout)).toBeLessThanOrEqual(16777216)
  const child = start(endpoint, "genesis")
  child.stderr.resume()
  await expect.poll(() => child.stdout.readableLength).toBeGreaterThan(0)
  const closed = once(child, "close")
  child.kill("SIGINT")
  // Drain after cancellation so Node can emit close; no data is interpreted.
  child.stdout.resume()
  const [code, signal] = await closed
  expect(signal === "SIGINT" || code === 130).toBe(true)
})
it("handles a broken stdout pipe as a curl failure instead of a Node stack", async () => {
  respond = (response) => response.end(Buffer.alloc(1024 * 1024, 120))
  const child = start(endpoint, "genesis")
  let stderr = ""
  child.stderr.on("data", (chunk) => {
    stderr += chunk
  })
  child.stdout.destroy()
  const [code, signal] = await once(child, "close")
  expect(code !== 0 || signal !== null).toBe(true)
  expect(stderr).not.toContain("uncaught")
})
