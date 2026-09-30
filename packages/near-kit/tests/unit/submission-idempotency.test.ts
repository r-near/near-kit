import { sha256 } from "@noble/hashes/sha2.js"
import { base58, base64 } from "@scure/base"
import { Cause, Effect, Exit } from "effect"
import { describe, expect, test } from "vitest"
import { SignedTransactionSchema } from "../../src/core/schema.js"
import { TransactionBuilder } from "../../src/core/transaction.js"
import { InvalidNonceError } from "../../src/errors/index.js"
import { keyStoreService } from "../../src/effect/keys.js"
import { makeNonceReservation } from "../../src/effect/nonce.js"
import {
  transactions,
  type TransactionDependencies,
} from "../../src/effect/transaction.js"
import { InMemoryKeyStore } from "../../src/keys/in-memory-keystore.js"
import { generateKey } from "../../src/utils/key.js"
import { testRpcPrograms } from "../helpers/rpc.js"

function nonceRejection(nonce: number, chainNonce: number) {
  return Response.json({
    jsonrpc: "2.0",
    id: 1,
    error: {
      name: "HANDLER_ERROR",
      code: -32000,
      message: "nonce rejected",
      cause: { name: "INVALID_TRANSACTION", info: {} },
      data: {
        TxExecutionError: {
          InvalidTxError: {
            InvalidNonce: {
              tx_nonce: nonce,
              ak_nonce: chainNonce,
            },
          },
        },
      },
    },
  })
}
function fixture(
  options: {
    retries?: number
    first?: "lost" | "malformed" | "accepted"
    gate?: Promise<void>
  } = {},
) {
  const key = generateKey()
  let chainNonce = 1
  const accepted: string[] = []
  const wires: Uint8Array[] = []
  const lookups: unknown[] = []
  let statusKnown = false
  let signatures = 0
  const started = Promise.withResolvers<void>()
  const rpc = {
    ...testRpcPrograms(
      "https://rpc.invalid",
      async (_url, init) => {
        if (typeof init.body !== "string") throw new Error("Expected RPC body")
        const { method, params } = JSON.parse(init.body)
        if (method === "EXPERIMENTAL_tx_status") {
          lookups.push(params)
          return statusKnown
            ? Response.json({
                jsonrpc: "2.0",
                id: 1,
                result: { final_execution_status: "NONE", receipts: [] },
              })
            : Response.json({
                jsonrpc: "2.0",
                id: 1,
                error: {
                  name: "HANDLER_ERROR",
                  code: -32000,
                  message: "Transaction is not visible",
                  cause: {
                    name: "UNKNOWN_TRANSACTION",
                    info: { requested_transaction_hash: params.tx_hash },
                  },
                },
              })
        }
        if (method !== "send_tx") throw new Error(`Unexpected ${method}`)
        const wire = base64.decode(params.signed_tx_base64)
        wires.push(wire)
        const nonce = Number(
          SignedTransactionSchema.deserialize(wire).transaction.nonce,
        )
        if (nonce <= chainNonce) return nonceRejection(nonce, chainNonce)
        chainNonce = nonce
        accepted.push(base58.encode(sha256(wire.slice(0, -65))))
        started.resolve()
        if (accepted.length === 1) {
          if (options.gate) await options.gate
          if (options.first === "lost")
            throw new Error("accepted response lost")
          if (options.first === "malformed")
            return Response.json({ jsonrpc: "2.0", id: 1, result: {} })
        }
        return Response.json({
          jsonrpc: "2.0",
          id: 1,
          result: { final_execution_status: "NONE" },
        })
      },
      undefined,
      { maxRetries: options.retries ?? 0, initialDelayMs: 0 },
    ),
    getAccessKey: () => Effect.succeed({ nonce: chainNonce } as never),
    getBlock: () =>
      Effect.succeed({
        header: { hash: "11111111111111111111111111111111" },
      } as never),
  }
  const dependencies: TransactionDependencies = {
    rpc,
    keyStore: keyStoreService(
      new InMemoryKeyStore({ "alice.near": key.secretKey }),
    ),
    nonces: Effect.runSync(makeNonceReservation),
    signer: (digest) =>
      Effect.sync(() => {
        signatures++
        return key.sign(digest)
      }),
  }
  const builder = new TransactionBuilder("alice.near", dependencies).transfer(
    "bob.near",
    "1 NEAR",
  )
  return {
    builder,
    dependencies,
    rpc,
    accepted,
    wires,
    lookups,
    started: started.promise,
    knowStatus: () => {
      statusKnown = true
    },
    signatures: () => signatures,
  }
}

describe("signed commitment submission history", () => {
  test.each([
    "internal retry",
    "caller retry",
    "accepted replay",
    "malformed response",
  ] as const)("%s never repeats an accepted transfer", async (scenario) => {
    const f = fixture({
      retries: scenario === "internal retry" ? 1 : 0,
      first:
        scenario === "accepted replay"
          ? "accepted"
          : scenario === "malformed response"
            ? "malformed"
            : "lost",
    })
    if (scenario !== "internal retry")
      await f.builder.send({ waitUntil: "NONE" }).catch(() => undefined)
    const failure = await f.builder
      .send({ waitUntil: "NONE" })
      .catch((error: unknown) => error)
    expect(failure).toMatchObject({
      code: "TRANSACTION_OUTCOME_UNKNOWN",
      retryable: false,
      data: { hash: f.accepted[0], sender: "alice.near" },
    })
    expect(f.accepted).toHaveLength(1)
    expect(f.signatures()).toBe(1)
    const firstWire = f.wires[0]
    if (!firstWire) throw new Error("Expected a captured submission")
    for (const wire of f.wires) expect(wire).toEqual(firstWire)
    f.knowStatus()
    const result = await f.builder.send({ waitUntil: "NONE" })
    expect(result.transaction?.hash).toBe(f.accepted[0])
    expect(f.accepted).toHaveLength(1)
    expect(f.signatures()).toBe(1)
    expect(f.lookups.length).toBeGreaterThan(0)
    expect(
      f.lookups.every(
        (lookup) =>
          JSON.stringify(lookup) ===
          JSON.stringify({
            tx_hash: f.accepted[0],
            sender_account_id: "alice.near",
            wait_until: "NONE",
          }),
      ),
    ).toBe(true)
  })

  test("a concurrent rejection cannot refresh while another broadcast is unresolved", async () => {
    const gate = Promise.withResolvers<void>()
    const f = fixture({ gate: gate.promise })
    await f.builder.sign()
    const first = f.builder.send({ waitUntil: "NONE" })
    await f.started
    await expect(f.builder.send({ waitUntil: "NONE" })).rejects.toMatchObject({
      code: "TRANSACTION_OUTCOME_UNKNOWN",
    })
    expect(f.signatures()).toBe(1)
    expect(f.accepted).toHaveLength(1)
    gate.resolve()
    expect((await first).transaction?.hash).toBe(f.accepted[0])
  })

  test("interruption leaves the signed value uncertain for later native broadcasts", async () => {
    const gate = Promise.withResolvers<void>()
    const f = fixture({ gate: gate.promise })
    const tx = transactions(f.dependencies)
    const signed = await Effect.runPromise(
      tx.sign({
        signerId: "alice.near",
        receiverId: "bob.near",
        actions: [{ transfer: { deposit: 1n } }],
      }),
    )
    const controller = new AbortController()
    const pending = Effect.runPromiseExit(
      tx.broadcast(signed, { waitUntil: "NONE" }),
      { signal: controller.signal },
    )
    await f.started
    controller.abort()
    const exit = await pending
    expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true)
    await expect(
      Effect.runPromise(tx.broadcast(signed, { waitUntil: "NONE" })),
    ).rejects.toMatchObject({ code: "TRANSACTION_OUTCOME_UNKNOWN" })
    expect(f.signatures()).toBe(1)
    expect(f.accepted).toHaveLength(1)
    gate.resolve()
  })

  test("a provider-thrown InvalidNonce class is not proof of rejection", async () => {
    const f = fixture()
    const failure = new InvalidNonceError(2, 10)
    f.rpc.sendTransaction = () => Effect.fail(failure)
    await expect(f.builder.send({ waitUntil: "NONE" })).rejects.toMatchObject({
      code: "TRANSACTION_OUTCOME_UNKNOWN",
      retryable: false,
      data: { cause: failure },
    })
    expect(f.signatures()).toBe(1)
    expect(f.accepted).toHaveLength(0)
  })
})
