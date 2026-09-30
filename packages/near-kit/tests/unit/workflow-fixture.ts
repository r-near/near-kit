import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import type * as Tracer from "effect/Tracer"
import { InMemoryKeyStore, type KeyPair } from "near-kit"
import {
  Client,
  KeyStore,
  NonceReservation,
  Rpc,
  RpcTransport,
  Signer,
  keyStoreService,
} from "near-kit/effect"
import {
  inspectSignedTransaction,
  type WireTransaction,
} from "../../../../tests/browser/wire-oracle.js"

import { testBlock as block, testBlockHash as hash } from "../helpers/rpc.js"

export class WorkflowIdentity extends Context.Service<
  WorkflowIdentity,
  string
>()("test/WorkflowIdentity") {}

/** Models node admission, Response bodies and a lost acknowledgement. */
export async function workflowFixture(
  keys: readonly KeyPair[],
  options: { failRead?: boolean; trace?: boolean } = {},
) {
  const accounts = keys.map((_, index) => `key${index}.fixture.testnet`)
  const acquired: string[] = []
  const released: string[] = []
  const submissions: WireTransaction[] = []
  const statusHashes: string[] = []
  const observations: {
    kind: "rpc" | "signer"
    span: Tracer.Span
    identity: string | undefined
  }[] = []
  const ledger = new Map<string, WireTransaction>()
  const nonces = new Map<string, number>()
  let signatures = 0
  let active = 0
  let maximum = 0
  let dropped = false
  let calls = 0
  const store = new InMemoryKeyStore()
  for (const [index, key] of keys.entries()) {
    await store.add(accounts[index] ?? "", {
      publicKey: key.publicKey,
      secretKey: key.secretKey,
      sign: (digest) => {
        signatures++
        return key.sign(digest)
      },
    })
  }
  const track = (name: string) =>
    Layer.effectDiscard(
      Effect.acquireRelease(
        Effect.sync(() => acquired.push(name)),
        () => Effect.sync(() => released.push(name)),
      ),
    )
  const record = (kind: "rpc" | "signer") =>
    Effect.gen(function* () {
      const span = yield* Effect.currentSpan.pipe(Effect.orDie)
      const identity = yield* Effect.serviceOption(WorkflowIdentity)
      observations.push({
        kind,
        span,
        identity: Option.getOrUndefined(identity),
      })
    })
  const outcome = (tx: WireTransaction) => ({
    final_execution_status: "NONE",
    transaction: {
      hash: tx.hash,
      signer_id: tx.signerId,
      receiver_id: tx.receiverId,
      nonce: tx.nonce,
    },
    receipts: [],
  })
  const fetch: Parameters<typeof RpcTransport.layer>[0] = async (url, init) => {
    if (url !== "https://fixture.invalid") throw new Error("Unexpected RPC URL")
    if (++calls > 100) throw new Error("Fixture request bound exceeded")
    active++
    maximum = Math.max(maximum, active)
    let completed = false
    const complete = () => {
      if (!completed) active--
      completed = true
      init.signal.removeEventListener("abort", complete)
    }
    init.signal.addEventListener("abort", complete, { once: true })
    await new Promise<void>((resolve) => setImmediate(resolve))
    if (init.signal.aborted) throw new DOMException("Aborted", "AbortError")
    if (typeof init.body !== "string") throw new Error("Expected JSON RPC body")
    const request = JSON.parse(init.body) as {
      id: number
      method: string
      params: Record<string, string>
    }
    const params = request.params
    let result: unknown
    let status = 200
    if (request.method === "query" && params["request_type"] === "view_state") {
      const page = Number(params["after_key_base64"] ?? 0)
      result = {
        values: Array.from({ length: 8 }, (_, index) => ({
          key: `${params["account_id"]}:${page * 8 + index}`,
          value: String(page * 8 + index),
        })),
        ...(page < 3 ? { last_key: String(page + 1) } : {}),
        block_height: 100,
        block_hash: hash,
      }
    } else if (
      request.method === "query" &&
      params["request_type"] === "call_function"
    ) {
      const args = JSON.parse(
        Buffer.from(params["args_base64"] ?? "", "base64").toString(),
      ) as { index: number }
      if (options.failRead) status = 400
      result = {
        result: [
          ...Buffer.from(
            JSON.stringify({
              accountId: params["account_id"],
              index: args.index,
            }),
          ),
        ],
        logs: [],
        block_height: 100,
        block_hash: hash,
      }
    } else if (
      request.method === "query" &&
      params["request_type"] === "view_access_key"
    ) {
      result = {
        nonce:
          nonces.get(`${params["account_id"]}:${params["public_key"]}`) ?? 100,
        permission: "FullAccess",
        block_height: 100,
        block_hash: hash,
      }
    } else if (request.method === "block") {
      result = block
    } else if (request.method === "send_tx") {
      const tx = inspectSignedTransaction(params["signed_tx_base64"] ?? "")
      if (!tx.signatureValid) throw new Error("Invalid Ed25519 signature")
      const id = `${tx.signerId}:${tx.publicKey}`
      if (tx.nonce <= (nonces.get(id) ?? 100)) {
        throw new Error("A committed nonce was reused")
      }
      nonces.set(id, tx.nonce)
      ledger.set(tx.hash, tx)
      submissions.push(tx)
      if (!dropped) {
        dropped = true
        complete()
        throw new TypeError("Node accepted the bytes; response was lost")
      }
      result = outcome(tx)
    } else if (request.method === "EXPERIMENTAL_tx_status") {
      const txHash = params["tx_hash"] ?? ""
      statusHashes.push(txHash)
      const tx = ledger.get(txHash)
      if (!tx) throw new Error("Status lookup must use an admitted hash")
      result = outcome(tx)
    } else throw new Error(`Unexpected fixture request ${request.method}`)
    const bytes = Buffer.from(
      JSON.stringify({ jsonrpc: "2.0", id: request.id, result }),
    )
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const abort = () => {
          if (completed) return
          complete()
          controller.error(new DOMException("Aborted", "AbortError"))
        }
        init.signal.addEventListener("abort", abort, { once: true })
        setImmediate(() => {
          init.signal.removeEventListener("abort", abort)
          if (completed) return
          controller.enqueue(bytes)
          controller.close()
          complete()
        })
      },
      cancel() {
        complete()
      },
    })
    return new Response(body, {
      status,
      headers: { "content-type": "application/json" },
    })
  }
  const transport = Layer.effect(
    RpcTransport,
    Effect.gen(function* () {
      const base = yield* RpcTransport
      return RpcTransport.of({
        execute: (...args) =>
          options.trace
            ? record("rpc").pipe(Effect.andThen(base.execute(...args)))
            : base.execute(...args),
      })
    }),
  ).pipe(
    Layer.provide(RpcTransport.layer(fetch)),
    Layer.provide(track("transport")),
  )
  const rpc = Rpc.layer({
    url: "https://fixture.invalid",
    retry: { maxRetries: 0, initialDelayMs: 0 },
  }).pipe(Layer.provide(transport), Layer.provide(track("rpc")))
  const signingKey = keys[0]
  if (!signingKey) throw new Error("Fixture requires a signing key")
  if (options.trace && keys.length !== 1)
    throw new Error("The native signer fixture owns exactly one signing key")
  const signer = Effect.fn("Fixture.signer")((digest: Uint8Array) =>
    record("signer").pipe(
      Effect.andThen(
        Effect.sync(() => {
          signatures++
          return signingKey.sign(digest)
        }),
      ),
    ),
  )
  const custody = options.trace
    ? Effect.map(Signer, (signer) => ({ signer }))
    : Effect.succeed({})
  const layer = Client.layer(
    { network: "testnet", defaultWaitUntil: "NONE" },
    custody,
  ).pipe(
    Layer.provide(rpc),
    Layer.provide(
      Layer.succeed(KeyStore, keyStoreService(store)).pipe(
        Layer.provide(track("keys")),
      ),
    ),
    Layer.provide(NonceReservation.layer.pipe(Layer.provide(track("nonces")))),
    Layer.provide(Layer.succeed(Signer, signer)),
  )
  return {
    accounts,
    layer,
    acquired,
    released,
    submissions,
    statusHashes,
    observations,
    snapshot: () => ({ signatures, active, maximum }),
  }
}
