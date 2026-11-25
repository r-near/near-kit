import { spawn } from "node:child_process"
import { once } from "node:events"
import { expect, it } from "vitest"

it("the browser fixture can release a response after its headers were flushed", async () => {
  const child = spawn(process.execPath, ["scripts/browser-server.mjs"], {
    env: { ...process.env, BROWSER_TEST_PORT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  })
  try {
    const port = await new Promise<number>((resolve, reject) => {
      let output = ""
      child.once("error", reject)
      child.once("exit", () =>
        reject(new Error("Fixture exited before readiness")),
      )
      child.stdout.on("data", (data: Buffer) => {
        output += data.toString()
        const match = /\{"ready":true,"port":(\d+)\}/.exec(output)
        if (match) resolve(Number(match[1]))
      })
    })
    const url = `http://127.0.0.1:${port}`
    await fetch(`${url}/control/hold`, { method: "POST" })
    const held = await fetch(`${url}/rpc/one`, {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "fixture",
        method: "query",
        params: { account_id: "a.testnet" },
      }),
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(3000),
    })
    const release = await fetch(`${url}/control/release?id=1`, {
      method: "POST",
    })
    expect(release.status).toBe(200)
    expect(await release.json()).toEqual({ released: true })
    expect(await held.json()).toMatchObject({
      jsonrpc: "2.0",
      id: "fixture",
      result: { amount: "1" },
    })
  } finally {
    if (child.exitCode === null) {
      const exited = once(child, "exit")
      child.kill("SIGTERM")
      await exited
    }
  }
})
