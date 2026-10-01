// Single-process, loopback receipt example. The application owns all sessions,
// challenges and timers. Deployments need their own shared store and HTTPS.

import { randomBytes } from "node:crypto"
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import * as Near from "@near-kit/next"
import { parseAccountId } from "@near-kit/next/data"
import {
  Nep413InputError,
  type Nep413Payload,
  Nep413UnsupportedKeyError,
  verifyNep413Signature,
} from "@near-kit/next/nep413"
import * as Effect from "effect/Effect"

const ORIGIN = "http://127.0.0.1:8787"
type Source = {
  readonly id: string
  readonly chain: string
  readonly policy: number
  readonly client: Near.Client
}
const defaultSource: Source = Object.freeze({
  id: "demo-testnet-v1",
  chain: "testnet",
  policy: 1,
  client: Near.make({ url: "https://rpc.testnet.near.org" }),
})
// Application test seam only; no SDK clock/store/entropy abstraction is added.
export function createReceiptServer(
  options: {
    now?: () => number
    nonce?: () => Uint8Array
    token?: () => string
    source?: Source
  } = {},
) {
  const now = options.now ?? Date.now
  const newNonce = options.nonce ?? (() => new Uint8Array(randomBytes(32)))
  const randomId =
    options.token ?? (() => randomBytes(32).toString("base64url"))
  // Capture configuration once. Replacing network/policy means creating a new
  // server instance; caller mutation must not rebind a pending challenge.
  const selectedSource = options.source ?? defaultSource
  const source: Source = Object.freeze({
    id: selectedSource.id,
    chain: selectedSource.chain,
    policy: selectedSource.policy,
    client: selectedSource.client,
  })
  const challenges = new Map<
    string,
    {
      id: string
      binding: string
      accountId: string
      expires: number
      source: Source
      payload: Nep413Payload
    }
  >()
  const currentChallenge = new Map<string, string>() // browser binding -> challenge ID
  const sessions = new Map<
    string,
    {
      accountId: string
      publicKey: string
      sourceId: string
      blockHash: string
      blockHeight: string
      expires: number
    }
  >()
  class Reject extends Error {
    constructor(readonly status: number) {
      super("Request rejected")
    }
  }
  function cookie(req: IncomingMessage, name: string) {
    const matches = (req.headers.cookie ?? "")
      .split(";")
      .map((x) => x.trim())
      .filter((x) => x.startsWith(`${name}=`))
    if (matches.length !== 1) return ""
    const value = matches[0]!.slice(name.length + 1)
    return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : ""
  }
  function json(res: ServerResponse, status: number, value: unknown) {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    })
    res.end(JSON.stringify(value))
  }
  async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
    if (req.headers["content-type"]?.split(";")[0] !== "application/json")
      throw new Reject(400)
    const chunks: Buffer[] = []
    let length = 0
    for await (const chunk of req.iterator({ destroyOnReturn: false })) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      length += bytes.length
      if (length > 16_384) {
        req.resume()
        throw new Reject(400)
      }
      chunks.push(bytes)
    }
    let value: unknown
    try {
      value = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
      )
    } catch {
      throw new Reject(400)
    }
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Reject(400)
    return value as Record<string, unknown>
  }
  function text(body: Record<string, unknown>, field: string) {
    const value = body[field]
    if (typeof value !== "string") throw new Reject(400)
    return value
  }
  function reap(time: number) {
    for (const [id, item] of challenges)
      if (item.expires <= time) {
        challenges.delete(id)
        if (currentChallenge.get(item.binding) === id)
          currentChallenge.delete(item.binding)
      }
    for (const [id, item] of sessions)
      if (item.expires <= time) sessions.delete(id)
  }

  const server = createServer((req, res) => {
    const abort = new AbortController()
    let clientGone = false,
      deadlineHit = false,
      receiptDeadline = Infinity
    let timer: ReturnType<typeof setTimeout> | undefined
    const stop = () => {
      if (!res.writableEnded) {
        clientGone = true
        abort.abort()
      }
    }
    const check = () => {
      if (performance.now() >= receiptDeadline) {
        deadlineHit = true
        abort.abort()
      }
      abort.signal.throwIfAborted()
    }
    req.once("aborted", stop)
    res.once("close", stop)
    void (async () => {
      const route = req.url
      reap(now())
      if (req.method === "GET" && route === "/me") {
        const session = sessions.get(cookie(req, "session"))
        if (!session) throw new Reject(401)
        return json(res, 200, session)
      }
      if (
        req.method !== "POST" ||
        (route !== "/challenge" && route !== "/receipt")
      )
        throw new Reject(404)
      if (req.headers.origin !== ORIGIN) throw new Reject(401)
      const input = await body(req)
      check()
      if (route === "/challenge") {
        let accountId: string
        try {
          accountId = parseAccountId(text(input, "accountId"))
        } catch {
          throw new Reject(400)
        }
        if (challenges.size >= 1000 || sessions.size >= 1000)
          throw new Reject(503)
        const oldBinding = cookie(req, "challenge")
        const binding = currentChallenge.has(oldBinding)
          ? oldBinding
          : randomId()
        const id = randomId(),
          expires = now() + 300_000
        const payload = {
          message: [
            "NEAR demo login v1",
            `Origin: ${ORIGIN}`,
            `Source: ${source.id}`,
            `Chain: ${source.chain}`,
            `Account: ${accountId}`,
            `Policy: ${source.policy}`,
            `Challenge: ${id}`,
            `Expires: ${new Date(expires).toISOString()}`,
          ].join("\n"),
          recipient: ORIGIN,
          nonce: new Uint8Array(newNonce()),
        }
        const previous = currentChallenge.get(binding)
        if (previous !== undefined) challenges.delete(previous)
        challenges.set(id, { id, binding, accountId, expires, source, payload })
        currentChallenge.set(binding, id)
        res.setHeader(
          "Set-Cookie",
          `challenge=${binding}; HttpOnly; SameSite=Strict; Path=/; Max-Age=300`,
        )
        return json(res, 200, {
          challengeId: id,
          accountId,
          expires,
          payload: {
            ...payload,
            nonce: Buffer.from(payload.nonce).toString("base64"),
          },
        })
      }
      // This bounds receipt verification after the body, not just request upload.
      receiptDeadline = performance.now() + 5_000
      timer = setTimeout(() => {
        deadlineHit = true
        abort.abort()
      }, 5_000)
      const id = text(input, "challengeId"),
        accountId = text(input, "accountId")
      const publicKey = text(input, "publicKey"),
        signature = text(input, "signature")
      const challenge = challenges.get(id),
        binding = cookie(req, "challenge")
      if (
        !challenge ||
        challenge.binding !== binding ||
        challenge.expires <= now() ||
        currentChallenge.get(binding) !== id ||
        challenge.accountId !== accountId ||
        challenge.source !== source
      )
        throw new Reject(401)
      if (!verifyNep413Signature(challenge.payload, { publicKey, signature }))
        throw new Reject(401)
      check()
      const result = await Effect.runPromise(
        Near.accessKey(source.client, challenge.accountId, publicKey, {
          at: "final",
        }).pipe(
          Effect.match({
            onSuccess: (key) => ({ ok: true as const, key }),
            onFailure: (error) => ({ ok: false as const, error }),
          }),
          Effect.provide(Near.fetchLayer),
        ),
        { signal: abort.signal },
      )
      if (!result.ok) {
        const tag = result.error._tag
        if (tag === "AccountNotFound" || tag === "AccessKeyNotFound")
          throw new Reject(401)
        if (tag === "RequestError" || tag === "UnsupportedError")
          throw new Reject(500)
        throw new Reject(503)
      }
      const key = result.key
      if (
        key.permission.kind !== "FullAccess" &&
        key.permission.kind !== "GasKeyFullAccess"
      )
        throw new Reject(401)
      check()
      // Atomic only in this single process: no await from recheck through commit.
      if (
        challenges.get(id) !== challenge ||
        challenge.expires <= now() ||
        currentChallenge.get(binding) !== id ||
        challenge.binding !== binding ||
        challenge.source !== source
      )
        throw new Reject(401)
      if (sessions.size >= 1000) throw new Reject(503)
      const sessionId = randomId()
      sessions.set(sessionId, {
        accountId: challenge.accountId,
        publicKey,
        sourceId: source.id,
        blockHash: key.blockHash,
        blockHeight: key.blockHeight.toString(),
        expires: now() + 3_600_000,
      })
      challenges.delete(id)
      currentChallenge.delete(binding)
      res.setHeader("Set-Cookie", [
        `session=${sessionId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600`,
        "challenge=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
      ])
      json(res, 200, {
        accountId: challenge.accountId,
        sourceId: source.id,
        blockHash: key.blockHash,
        blockHeight: key.blockHeight.toString(),
      })
    })()
      .catch((error) => {
        if (clientGone || res.destroyed) return
        const status = deadlineHit
          ? 503
          : error instanceof Reject
            ? error.status
            : error instanceof Nep413InputError
              ? 400
              : error instanceof Nep413UnsupportedKeyError
                ? 422
                : 500
        if (!res.headersSent)
          json(res, status, {
            error:
              status === 503 ? "Verification unavailable" : "Request rejected",
          })
        else res.destroy()
      })
      .finally(() => {
        if (timer !== undefined) clearTimeout(timer)
        req.off("aborted", stop)
        res.off("close", stop)
      })
  })
  server.requestTimeout = 10_000
  server.headersTimeout = 5_000
  return server
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  createReceiptServer().listen(8787, "127.0.0.1")
}
