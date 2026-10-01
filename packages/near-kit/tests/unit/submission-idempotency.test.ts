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

function nonceRejection(nonce: number, chainNonce: number, id: unknown) {
  return Response.json({
    jsonrpc: "2.0",
    id,
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
    first?: "lost" | "malformed" | "accepted" | "wrong nonce" | "hidden replay"
    replay?: "ShardCongested" | "ShardStuck"
    gate?: Promise<void>
    signGate?: Promise<void>
    rejection?: { id?: unknown; txNonce: number; akNonce: number }
    statusIdentity?: "correct" | "hash" | "signer" | "receiver" | "nonce"
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
  const signingStarted = Promise.withResolvers<void>()
  const rpc = {
    ...testRpcPrograms(
      "https://rpc.invalid",
      async (_url, init) => {
        if (typeof init.body !== "string") throw new Error("Expected RPC body")
        const { id, method, params } = JSON.parse(init.body)
        if (method === "EXPERIMENTAL_tx_status") {
          lookups.push(params)
          return statusKnown
            ? Response.json({
                jsonrpc: "2.0",
                id,
                result: {
                  final_execution_status: "NONE",
                  receipts: [],
                  ...(options.statusIdentity
                    ? {
                        transaction: {
                          hash:
                            options.statusIdentity === "hash"
                              ? "another-hash"
                              : accepted[0],
                          signer_id:
                            options.statusIdentity === "signer"
                              ? "other.near"
                              : "alice.near",
                          receiver_id:
                            options.statusIdentity === "receiver"
                              ? "other.near"
                              : "bob.near",
                          nonce: options.statusIdentity === "nonce" ? 999 : 2,
                        },
                      }
                    : {}),
                },
              })
            : Response.json({
                jsonrpc: "2.0",
                id,
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
        if (nonce <= chainNonce) {
          if (options.replay)
            return Response.json({
              jsonrpc: "2.0",
              id,
              error: {
                name: "HANDLER_ERROR",
                code: -32000,
                message: options.replay,
                cause: { name: "INVALID_TRANSACTION", info: {} },
                data: { InvalidTxError: { [options.replay]: true } },
              },
            })
          return nonceRejection(nonce, chainNonce, id)
        }
        chainNonce = nonce
        accepted.push(base58.encode(sha256(wire.slice(0, -65))))
        started.resolve()
        if (accepted.length === 1) {
          if (options.rejection)
            return nonceRejection(
              options.rejection.txNonce,
              options.rejection.akNonce,
              options.rejection.id,
            )
          // A browser/proxy can replay below fetch: the SDK observes only this rejection.
          if (options.first === "hidden replay")
            return nonceRejection(nonce, chainNonce, id)
          if (options.first === "wrong nonce")
            return nonceRejection(nonce + 1, nonce + 1, id)
          if (options.gate) await options.gate
          if (options.first === "lost")
            throw new Error("accepted response lost")
          if (options.first === "malformed")
            return Response.json({ jsonrpc: "2.0", id, result: {} })
        }
        return Response.json({
          jsonrpc: "2.0",
          id,
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
      Effect.gen(function* () {
        signatures++
        signingStarted.resolve()
        if (options.signGate)
          yield* Effect.promise(() => options.signGate ?? Promise.resolve())
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
    signingStarted: signingStarted.promise,
    knowStatus: () => {
      statusKnown = true
    },
    signatures: () => signatures,
  }
}

describe("signed commitment submission safety", () => {
  test.each(["send+send", "sign+send"] as const)(
    "concurrent %s on one unsigned builder shares one commitment",
    async (mode) => {
      const gate = Promise.withResolvers<void>()
      const f = fixture({ signGate: gate.promise })
      f.knowStatus()
      const first =
        mode === "send+send"
          ? f.builder.send({ waitUntil: "NONE" })
          : f.builder.sign()
      const second = f.builder.send({ waitUntil: "NONE" })
      await f.signingStarted
      gate.resolve()
      await first
      const result = await second
      expect(f.signatures()).toBe(1)
      expect(f.accepted).toHaveLength(1)
      expect(new Set(f.wires.map((wire) => base64.encode(wire))).size).toBe(1)
      expect(result.transaction?.hash).toBe(f.accepted[0])
      expect(f.builder.getHash()).toBe(f.accepted[0])
    },
  )

  test.each([
    { native: false, known: false },
    { native: false, known: true },
    { native: true, known: false },
    { native: true, known: true },
  ])(
    "a first visible nonce rejection cannot prove nonexecution ($native/$known)",
    async ({ native, known }) => {
      const f = fixture({ first: "hidden replay", retries: 1 })
      if (known) f.knowStatus()
      const pending = native
        ? Effect.runPromise(
            transactions(f.dependencies).send(
              {
                signerId: "alice.near",
                receiverId: "bob.near",
                actions: [{ transfer: { deposit: 1n } }],
              },
              { waitUntil: "NONE" },
            ),
          )
        : f.builder.send({ waitUntil: "NONE" })
      if (known) {
        const result = await pending
        expect(result.transaction?.hash).toBe(f.accepted[0])
      } else {
        await expect(pending).rejects.toMatchObject({
          code: "TRANSACTION_OUTCOME_UNKNOWN",
          retryable: false,
        })
      }
      expect(f.accepted).toHaveLength(1)
      expect(f.signatures()).toBe(1)
      expect(new Set(f.wires.map((wire) => base64.encode(wire))).size).toBe(1)
      expect(f.lookups).toEqual([
        {
          tx_hash: f.accepted[0],
          sender_account_id: "alice.near",
          wait_until: "NONE",
        },
      ])
    },
  )

  test.each(["correct", "hash", "signer", "receiver", "nonce"] as const)(
    "reconciliation checks returned transaction identity (%s)",
    async (statusIdentity) => {
      const f = fixture({ first: "hidden replay", statusIdentity })
      f.knowStatus()
      const pending = f.builder.send({ waitUntil: "NONE" })
      if (statusIdentity === "correct") {
        expect((await pending).transaction?.hash).toBe(f.accepted[0])
      } else {
        await expect(pending).rejects.toMatchObject({
          code: "TRANSACTION_OUTCOME_UNKNOWN",
          retryable: false,
          data: { hash: f.accepted[0] },
        })
      }
      expect(f.accepted).toHaveLength(1)
      expect(f.signatures()).toBe(1)
    },
  )

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

  test.each(["wrong nonce", "ShardCongested", "ShardStuck"] as const)(
    "%s cannot turn a possibly accepted dispatch into retry authorization",
    async (scenario) => {
      const f = fixture(
        scenario === "wrong nonce"
          ? { first: "wrong nonce" }
          : { first: "lost", replay: scenario, retries: 1 },
      )
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
      f.knowStatus()
      const result = await f.builder.send({ waitUntil: "NONE" })
      expect(result.transaction?.hash).toBe(f.accepted[0])
      expect(f.accepted).toHaveLength(1)
      expect(f.signatures()).toBe(1)
    },
  )

  test.each([
    { id: 0, txNonce: 2, akNonce: 2 },
    { id: undefined, txNonce: 2, akNonce: 2 },
    { id: "1", txNonce: 2, akNonce: 2 },
    { id: 1, txNonce: -1, akNonce: 2 },
    { id: 1, txNonce: 1.5, akNonce: 2 },
    {
      id: 1,
      txNonce: Number.MAX_SAFE_INTEGER + 1,
      akNonce: Number.MAX_SAFE_INTEGER + 1,
    },
    { id: 1, txNonce: 0, akNonce: -1 },
    { id: 1, txNonce: 2, akNonce: 2.5 },
    { id: 1, txNonce: 2, akNonce: Number.MAX_SAFE_INTEGER + 1 },
    { id: 1, txNonce: 2, akNonce: 1 },
  ])(
    "untrusted rejection hints never authorize another economic operation (%j)",
    async (rejection) => {
      const f = fixture({ rejection, retries: 1 })
      await expect(f.builder.send({ waitUntil: "NONE" })).rejects.toMatchObject(
        {
          code: "TRANSACTION_OUTCOME_UNKNOWN",
          retryable: false,
        },
      )
      expect(f.accepted).toHaveLength(1)
      expect(f.signatures()).toBe(1)
      expect(new Set(f.wires.map((wire) => base64.encode(wire))).size).toBe(1)
      expect(f.lookups).toEqual([
        {
          tx_hash: f.accepted[0],
          sender_account_id: "alice.near",
          wait_until: "NONE",
        },
      ])
    },
  )

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
