import { once } from "node:events"
import { readFileSync } from "node:fs"
import {
  createServer,
  request as httpRequest,
  type Server,
  type ServerResponse,
} from "node:http"
import * as Near from "@near-kit/next"
import { afterEach, expect, it } from "vitest"
import { createReceiptServer } from "../examples/authentication-server.js"
import { formatPublicKey } from "../src/data.js"
import { HASH, type WireRequest } from "./fixtures.js"

const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/nep413/vectors.json", import.meta.url),
    "utf8",
  ),
) as {
  app: {
    accountId: string
    sourceId: string
    chain: string
    policy: number
    origin: string
    issuedAtMs: number
    expiresAtMs: number
    challengeId: string
    browserId: string
    sessionId: string
    tokenSequence: string[]
  }
  vectors: {
    id: string
    payload: { message: string; recipient: string; nonceHex: string }
    proof: { publicKey: string; signature: string }
  }[]
}
const ed = fixture.vectors.find((vector) => vector.id === "ed25519-receipt")!
const secp = fixture.vectors.find(
  (vector) => vector.id === "secp256k1-receipt",
)!
const servers = new Set<Server>()
afterEach(async () => {
  await Promise.all(
    [...servers].map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()))
          server.closeAllConnections()
        }),
    ),
  )
  servers.clear()
})
async function listen(server: Server) {
  servers.add(server)
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  if (!address || typeof address === "string")
    throw new Error("No local test address")
  return `http://127.0.0.1:${address.port}`
}
const cookie = (response: Response, name: string) =>
  response.headers
    .getSetCookie()
    .find((value) => value.startsWith(`${name}=`))
    ?.split(";")[0] ?? ""

type Reply = { request: WireRequest; response: ServerResponse }
type Behavior = (reply: Reply) => void
const keyReply = (
  { request, response }: Reply,
  permission: unknown = "FullAccess",
) => {
  response.setHeader("content-type", "application/json")
  response.end(
    JSON.stringify({
      jsonrpc: "2.0",
      id: request.id,
      result: { block_hash: HASH, block_height: 123, nonce: 0, permission },
    }),
  )
}
async function setup(
  initial: Behavior = keyReply,
  sourceId = fixture.app.sourceId,
) {
  const requests: Reply[] = []
  let behavior = initial
  const rpcUrl = await listen(
    createServer((request, response) => {
      void (async () => {
        const chunks: Buffer[] = []
        for await (const chunk of request) chunks.push(Buffer.from(chunk))
        const reply = {
          request: JSON.parse(Buffer.concat(chunks).toString()) as WireRequest,
          response,
        }
        requests.push(reply)
        behavior(reply)
      })().catch(() => response.destroy())
    }),
  )
  let time = fixture.app.issuedAtMs
  const tokens = [
    ...fixture.app.tokenSequence,
    ...["D", "E", "F", "G"].map((value) => value.repeat(43)),
  ]
  const source = {
    id: sourceId,
    chain: fixture.app.chain,
    policy: fixture.app.policy,
    client: Near.make({ url: rpcUrl }),
  }
  const server = createReceiptServer({
    now: () => time,
    nonce: () => new Uint8Array(Buffer.from(ed.payload.nonceHex, "hex")),
    token: () => {
      const value = tokens.shift()
      if (!value) throw new Error("Test token sequence exhausted")
      return value
    },
    source,
  })
  const url = await listen(server)
  const post = (
    path: string,
    value: unknown,
    browserCookie = "",
    signal?: AbortSignal,
  ) =>
    fetch(`${url}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: fixture.app.origin,
        cookie: browserCookie,
      },
      body: JSON.stringify(value),
      ...(signal ? { signal } : {}),
    })
  const issue = async (
    browserCookie = "",
    accountId = fixture.app.accountId,
  ) => {
    const response = await post("/challenge", { accountId }, browserCookie)
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      challengeId: string
      payload: { message: string; recipient: string; nonce: string }
    }
    return { ...body, cookie: cookie(response, "challenge") }
  }
  const receipt = (
    browserCookie: string,
    vector = ed,
    patch: Record<string, unknown> = {},
    signal?: AbortSignal,
  ) =>
    post(
      "/receipt",
      {
        challengeId: fixture.app.challengeId,
        accountId: fixture.app.accountId,
        ...vector.proof,
        ...patch,
      },
      browserCookie,
      signal,
    )
  const me = (session = "") =>
    fetch(`${url}/me`, { headers: { cookie: session } })
  return {
    server,
    source,
    url,
    requests,
    post,
    issue,
    receipt,
    me,
    respond: (next: Behavior) => {
      behavior = next
    },
    time: (next: number) => {
      time = next
    },
  }
}

it("captures source configuration so caller mutation cannot rebind a challenge", async () => {
  const app = await setup(() => {})
  const challenge = await app.issue()
  app.source.id = "different-source"
  app.source.chain = "different-chain"
  app.source.policy = 2
  app.source.client = Near.make({ url: "http://127.0.0.1:1" })
  const pending = app.receipt(challenge.cookie)
  await expect.poll(() => app.requests.length).toBe(1)
  app.source.id = "changed-again-during-read"
  app.source.chain = "changed-again-during-read"
  app.source.policy = 3
  app.source.client = Near.make({ url: "http://127.0.0.1:2" })
  keyReply(app.requests[0]!)
  const receipt = await pending
  expect(receipt.status).toBe(200)
  expect(app.requests).toHaveLength(1)
  expect(await receipt.json()).toMatchObject({ sourceId: fixture.app.sourceId })
  const session = await app.me(cookie(receipt, "session"))
  expect(await session.json()).toMatchObject({ sourceId: fixture.app.sourceId })
})

it("captures named structural Source getters once without reading unrelated config", async () => {
  const reads: string[] = []
  const client = Near.make({ url: "http://127.0.0.1:1" })
  class StructuralSource {
    get id() {
      reads.push("id")
      return fixture.app.sourceId
    }
    get chain() {
      reads.push("chain")
      return fixture.app.chain
    }
    get policy() {
      reads.push("policy")
      return fixture.app.policy
    }
    get client() {
      reads.push("client")
      return client
    }
  }
  const source = new StructuralSource()
  Object.defineProperty(source, "unrelated", {
    enumerable: true,
    get() {
      throw new Error("Unrelated configuration must not be retained")
    },
  })
  const url = await listen(createReceiptServer({ source }))
  const response = await fetch(`${url}/challenge`, {
    method: "POST",
    headers: { origin: fixture.app.origin, "content-type": "application/json" },
    body: JSON.stringify({ accountId: fixture.app.accountId }),
  })
  expect(response.status).toBe(200)
  const result = (await response.json()) as { payload: { message: string } }
  expect(result.payload.message).toContain(`Source: ${fixture.app.sourceId}`)
  expect(reads).toEqual(["id", "chain", "policy", "client"])
})

for (const vector of [ed, secp])
  it(`receives the exact independently signed ${vector.id} proof and issues a session`, async () => {
    const app = await setup()
    const challenge = await app.issue()
    expect(challenge.challengeId).toBe(fixture.app.challengeId)
    expect(challenge.payload).toEqual({
      message: vector.payload.message,
      recipient: vector.payload.recipient,
      nonce: Buffer.from(vector.payload.nonceHex, "hex").toString("base64"),
    })
    expect(challenge.cookie).toBe(`challenge=${fixture.app.browserId}`)
    const response = await app.receipt(challenge.cookie, vector)
    expect(response.status).toBe(200)
    expect(app.requests[0]!.request).toMatchObject({
      method: "query",
      params: {
        request_type: "view_access_key",
        account_id: fixture.app.accountId,
        public_key: vector.proof.publicKey,
        finality: "final",
      },
    })
    const session = cookie(response, "session")
    expect(session).toBe(`session=${fixture.app.sessionId}`)
    const authenticated = await app.me(session)
    expect(authenticated.status).toBe(200)
    expect(await authenticated.json()).toMatchObject({
      accountId: fixture.app.accountId,
      publicKey: vector.proof.publicKey,
      sourceId: fixture.app.sourceId,
      blockHash: HASH,
      blockHeight: "123",
    })
    expect((await app.receipt(challenge.cookie, vector)).status).toBe(401)
    expect(app.requests).toHaveLength(1)
    app.time(fixture.app.issuedAtMs + 3_600_000)
    expect((await app.me(session)).status).toBe(401)
  })

for (const [permission, expected] of [
  [{ GasKeyFullAccess: { balance: "0", num_nonces: 1 } }, 200],
  [
    {
      FunctionCall: {
        allowance: null,
        receiver_id: "app.testnet",
        method_names: [],
      },
    },
    401,
  ],
  [
    {
      GasKeyFunctionCall: {
        balance: "0",
        num_nonces: 1,
        allowance: null,
        receiver_id: "app.testnet",
        method_names: [],
      },
    },
    401,
  ],
] as const)
  it(`makes the ${Object.keys(permission)[0]} authority policy explicit`, async () => {
    const app = await setup((reply) => keyReply(reply, permission))
    const challenge = await app.issue()
    expect((await app.receipt(challenge.cookie)).status).toBe(expected)
  })

it("distinguishes malformed/unsupported/invalid proofs without consuming the challenge", async () => {
  const app = await setup()
  const challenge = await app.issue()
  expect(
    (await app.receipt(challenge.cookie, ed, { signature: "bad" })).status,
  ).toBe(400)
  expect(
    (
      await app.receipt(challenge.cookie, ed, {
        publicKey: formatPublicKey({
          kind: "ml-dsa-65-hash",
          data: new Uint8Array(32),
        }),
      })
    ).status,
  ).toBe(422)
  const changed = Buffer.from(ed.proof.signature, "base64")
  changed[0] = changed[0]! ^ 1
  expect(
    (
      await app.receipt(challenge.cookie, ed, {
        signature: changed.toString("base64"),
      })
    ).status,
  ).toBe(401)
  expect(app.requests).toHaveLength(0)
  expect((await app.receipt(challenge.cookie)).status).toBe(200)
})

it("uses stored account/source/recipient/message instead of submitted payload fields", async () => {
  const app = await setup()
  const challenge = await app.issue()
  expect(
    (await app.receipt(challenge.cookie, ed, { accountId: "other.sandbox" }))
      .status,
  ).toBe(401)
  expect((await app.receipt("challenge=" + "Z".repeat(43))).status).toBe(401)
  expect(
    (await app.receipt(`${challenge.cookie}; ${challenge.cookie}`)).status,
  ).toBe(401)
  const crossOrigin = await fetch(`${app.url}/receipt`, {
    method: "POST",
    headers: {
      origin: "https://attacker.invalid",
      "content-type": "application/json",
      cookie: challenge.cookie,
    },
    body: JSON.stringify({
      challengeId: fixture.app.challengeId,
      accountId: fixture.app.accountId,
      ...ed.proof,
    }),
  })
  expect(crossOrigin.status).toBe(401)
  expect(app.requests).toHaveLength(0)
  expect(
    (
      await app.receipt(challenge.cookie, ed, {
        message: "untrusted",
        recipient: "untrusted",
        nonce: "untrusted",
      })
    ).status,
  ).toBe(200)
  const otherSource = await setup(keyReply, "other-source")
  const changed = await otherSource.issue()
  expect((await otherSource.receipt(changed.cookie)).status).toBe(401)
  expect(otherSource.requests).toHaveLength(0)
})

it("denies a missing key but leaves transport and invalid upstream data retryable", async () => {
  const app = await setup(({ request, response }) =>
    response.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          block_hash: HASH,
          block_height: 123,
          logs: [],
          error: `access key ${request.params.public_key} does not exist while viewing`,
        },
      }),
    ),
  )
  const challenge = await app.issue()
  expect((await app.receipt(challenge.cookie)).status).toBe(401)
  app.respond(({ response }) => {
    response.statusCode = 429
    response.end("busy")
  })
  expect((await app.receipt(challenge.cookie)).status).toBe(503)
  app.respond(({ response }) => {
    response.end("not JSON")
  })
  expect((await app.receipt(challenge.cookie)).status).toBe(503)
  app.respond(({ response }) => {
    response.destroy()
  })
  expect((await app.receipt(challenge.cookie)).status).toBe(503)
  app.respond(keyReply)
  expect((await app.receipt(challenge.cookie)).status).toBe(200)
})

it("waits for actual authority, then commits at most one of two concurrent receipts", async () => {
  const app = await setup(() => {})
  const challenge = await app.issue()
  const responses = [
    app.receipt(challenge.cookie),
    app.receipt(challenge.cookie),
  ]
  await expect.poll(() => app.requests.length).toBe(2)
  expect((await app.me(`session=${fixture.app.sessionId}`)).status).toBe(401)
  for (const reply of app.requests) keyReply(reply)
  const finished = await Promise.all(responses)
  expect(finished.map((response) => response.status).sort()).toEqual([200, 401])
  expect(
    finished.filter((response) => cookie(response, "session")),
  ).toHaveLength(1)
})

it("rechecks expiry after a held authority read", async () => {
  const app = await setup(() => {})
  const challenge = await app.issue()
  const pending = app.receipt(challenge.cookie)
  await expect.poll(() => app.requests.length).toBe(1)
  app.time(fixture.app.expiresAtMs)
  keyReply(app.requests[0]!)
  expect((await pending).status).toBe(401)
  expect((await app.me(`session=${fixture.app.sessionId}`)).status).toBe(401)
})

it("a new challenge invalidates an older in-flight receipt at commit", async () => {
  const app = await setup(() => {})
  const challenge = await app.issue()
  const pending = app.receipt(challenge.cookie)
  await expect.poll(() => app.requests.length).toBe(1)
  const newer = await app.issue(challenge.cookie)
  expect(newer.cookie).toBe(challenge.cookie)
  expect(newer.challengeId).not.toBe(challenge.challengeId)
  keyReply(app.requests[0]!)
  expect((await pending).status).toBe(401)
  expect((await app.me(`session=${fixture.app.sessionId}`)).status).toBe(401)
})

it("a real receipt deadline aborts the held RPC, returns503 and preserves retry", async () => {
  let closed = false
  const app = await setup(({ response }) =>
    response.once("close", () => {
      closed = true
    }),
  )
  const challenge = await app.issue()
  const started = performance.now()
  expect((await app.receipt(challenge.cookie)).status).toBe(503)
  expect(performance.now() - started).toBeGreaterThanOrEqual(4_900)
  expect(performance.now() - started).toBeLessThan(7_000)
  await expect.poll(() => closed).toBe(true)
  app.respond(keyReply)
  expect((await app.receipt(challenge.cookie)).status).toBe(200)
})

it("client interruption aborts RPC without consuming, then the same challenge can retry", async () => {
  let closed = false
  const app = await setup(({ response }) =>
    response.once("close", () => {
      closed = true
    }),
  )
  const challenge = await app.issue()
  const controller = new AbortController()
  const pending = app.receipt(challenge.cookie, ed, {}, controller.signal)
  await expect.poll(() => app.requests.length).toBe(1)
  controller.abort()
  await expect(pending).rejects.toThrow()
  await expect.poll(() => closed).toBe(true)
  app.respond(keyReply)
  expect((await app.receipt(challenge.cookie)).status).toBe(200)
})

it("bounds and validates incoming bodies with generic errors", async () => {
  const app = await setup()
  for (const body of [
    "[1]",
    "not-json",
    JSON.stringify({ accountId: "x".repeat(17_000) }),
  ]) {
    const response = await fetch(`${app.url}/challenge`, {
      method: "POST",
      body,
      headers: {
        origin: fixture.app.origin,
        "content-type": "application/json",
      },
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "Request rejected" })
  }
})

it("rejects a genuinely chunked oversized upload before its terminating chunk", async () => {
  const app = await setup()
  const incoming = once(app.server, "request")
  let finishUpload = () => {}
  const response = new Promise<{ status: number | undefined; body: string }>(
    (resolve, reject) => {
      const request = httpRequest(
        `${app.url}/challenge`,
        {
          method: "POST",
          headers: {
            origin: fixture.app.origin,
            "content-type": "application/json",
          },
        },
        (response) => {
          let body = ""
          response.on("data", (chunk) => {
            body += String(chunk)
          })
          response.once("end", () =>
            resolve({ status: response.statusCode, body }),
          )
          response.once("error", reject)
        },
      )
      request.once("error", reject)
      finishUpload = () => {
        request.end()
        request.destroy()
      }
      request.write('{"accountId":"')
      request.write("x".repeat(17_000))
      // Intentionally no request.end(): the server must enforce its stream bound.
    },
  )
  try {
    const [request] = await incoming
    expect(request.headers["transfer-encoding"]).toBe("chunked")
    expect(request.headers["content-length"]).toBeUndefined()
    const result = await response
    expect(result.status).toBe(400)
    expect(JSON.parse(result.body)).toEqual({ error: "Request rejected" })
    expect(app.requests).toHaveLength(0)
  } finally {
    finishUpload()
  }
})

it("cleans up an interrupted incomplete body without creating a challenge", async () => {
  const app = await setup()
  const incoming = once(app.server, "request")
  const request = httpRequest(`${app.url}/challenge`, {
    method: "POST",
    headers: {
      origin: fixture.app.origin,
      "content-type": "application/json",
    },
  })
  request.on("error", () => {}) // Expected local client abort.
  request.write('{"accountId":"auth-fixture')
  const [received] = await incoming
  const closed = once(received, "close").catch(() => [])
  request.destroy()
  await closed
  expect(app.requests).toHaveLength(0)
  // Unused fixture tokens prove no abandoned challenge was issued.
  const challenge = await app.issue()
  expect(challenge.challengeId).toBe(fixture.app.challengeId)
  expect(challenge.cookie).toBe(`challenge=${fixture.app.browserId}`)
  expect((await app.receipt(challenge.cookie)).status).toBe(200)
})

it("does not reopen a committed challenge when the client discards its response", async () => {
  const app = await setup()
  const challenge = await app.issue()
  await new Promise<void>((resolve, reject) => {
    const request = httpRequest(
      `${app.url}/receipt`,
      {
        method: "POST",
        headers: {
          origin: fixture.app.origin,
          "content-type": "application/json",
          cookie: challenge.cookie,
        },
      },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume()
          reject(
            new Error(`Expected committed receipt, got ${response.statusCode}`),
          )
          return
        }
        // Observe only status headers, discard body/cookies and close the stream.
        response.on("error", () => {})
        response.destroy()
        resolve()
      },
    )
    request.once("error", reject)
    request.end(
      JSON.stringify({
        challengeId: fixture.app.challengeId,
        accountId: fixture.app.accountId,
        ...ed.proof,
      }),
    )
  })
  expect((await app.me(`session=${fixture.app.sessionId}`)).status).toBe(200)
  expect((await app.receipt(challenge.cookie)).status).toBe(401)
  expect(app.requests).toHaveLength(1)
})
