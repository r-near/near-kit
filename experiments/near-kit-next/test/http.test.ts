import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http"
import { Effect } from "effect"
import { expect, it } from "vitest"
import * as Near from "../src/index.js"
import { accountWire } from "./fixtures.js"

const latch = () => {
  let resolve: () => void = () => {
    throw new Error("Latch not initialized")
  }
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
async function withServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
  run: (url: string) => Promise<void>,
) {
  const server = createServer(handler)
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  if (address === null || typeof address === "string")
    throw new Error("Expected TCP address")
  try {
    await run(`http://127.0.0.1:${address.port}`)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
}
it("reads a complete JSON-RPC response over actual HTTP", async () => {
  await withServer(
    (request, response) => {
      const chunks: Buffer[] = []
      request.on("data", (chunk: Buffer) => chunks.push(chunk))
      request.on("end", () => {
        const body = JSON.parse(Buffer.concat(chunks).toString()) as {
          id: unknown
        }
        response.writeHead(200, { "content-type": "application/json" })
        response.end(
          JSON.stringify({ jsonrpc: "2.0", id: body.id, result: accountWire }),
        )
      })
    },
    async (url) => {
      const result = await Effect.runPromise(
        Near.account(Near.make({ url }), "alice.testnet").pipe(
          Effect.provide(Near.fetchLayer),
        ),
      )
      expect(result.amount).toBe(1234567890123456789012345n)
    },
  )
})
it("aborts the actual connection when interrupted after headers", async () => {
  const headers = latch()
  const closed = latch()
  await withServer(
    (_request, response) => {
      response.on("close", closed.resolve)
      response.writeHead(200, { "content-type": "application/json" })
      response.flushHeaders()
      response.write('{"jsonrpc":"2.0",')
      headers.resolve()
    },
    async (url) => {
      const controller = new AbortController()
      const running = Effect.runPromise(
        Near.account(Near.make({ url }), "alice.testnet").pipe(
          Effect.provide(Near.fetchLayer),
        ),
        { signal: controller.signal },
      )
      // Register rejection handling before aborting to prevent unhandled rejection races.
      const rejected = expect(running).rejects.toBeDefined()
      await headers.promise
      controller.abort()
      await rejected
      await closed.promise
    },
  )
})
it("stops an oversized real chunked response and closes its connection", async () => {
  const closed = latch()
  await withServer(
    (_request, response) => {
      response.on("close", closed.resolve)
      response.writeHead(200, { "content-type": "application/json" })
      response.write("x".repeat(1024))
    },
    async (url) => {
      const error = await Effect.runPromise(
        Near.account(
          Near.make({ url, maxResponseBytes: 64 }),
          "alice.testnet",
        ).pipe(Effect.flip, Effect.provide(Near.fetchLayer)),
      )
      expect(error._tag).toBe("DecodeError")
      await closed.promise
    },
  )
})
it("reports an HTTP failure without reading an endless error body", async () => {
  const closed = latch()
  await withServer(
    (_request, response) => {
      response.on("close", closed.resolve)
      response.writeHead(503)
      response.flushHeaders()
    },
    async (url) => {
      const error = await Effect.runPromise(
        Near.account(Near.make({ url }), "alice.testnet").pipe(
          Effect.flip,
          Effect.provide(Near.fetchLayer),
        ),
      )
      expect(error).toMatchObject({ _tag: "HttpError", status: 503 })
      await closed.promise
    },
  )
})
it("does not follow redirects with the supplied default fetch layer", async () => {
  let redirected = false
  await withServer(
    (request, response) => {
      if (request.url === "/target") {
        redirected = true
        response.writeHead(500)
        response.end()
        return
      }
      response.writeHead(302, { location: "/target" })
      response.end()
    },
    async (url) => {
      const error = await Effect.runPromise(
        Near.account(Near.make({ url }), "alice.testnet").pipe(
          Effect.flip,
          Effect.provide(Near.fetchLayer),
        ),
      )
      expect(error._tag).toBe("TransportError")
      expect(redirected).toBe(false)
    },
  )
})
it("cancels an in-flight sibling body when a composed read fails", async () => {
  const goodHeaders = latch()
  const goodClosed = latch()
  await withServer(
    (request, response) => {
      const chunks: Buffer[] = []
      request.on("data", (chunk: Buffer) => chunks.push(chunk))
      request.on("end", () => {
        const body = JSON.parse(Buffer.concat(chunks).toString()) as {
          params: {
            account_id: string
          }
        }
        if (body.params.account_id === "good.testnet") {
          response.on("close", goodClosed.resolve)
          response.writeHead(200, { "content-type": "application/json" })
          response.flushHeaders()
          response.write('{"jsonrpc":"2.0",')
          goodHeaders.resolve()
        } else {
          void goodHeaders.promise.then(() => {
            response.writeHead(503)
            response.end()
          })
        }
      })
    },
    async (url) => {
      const near = Near.make({ url })
      const error = await Effect.runPromise(
        Effect.all(
          [
            Near.account(near, "good.testnet"),
            Near.account(near, "bad.testnet"),
          ],
          { concurrency: 2 },
        ).pipe(Effect.flip, Effect.provide(Near.fetchLayer)),
      )
      expect(error._tag).toBe("HttpError")
      await goodClosed.promise
    },
  )
})
