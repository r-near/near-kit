import { Cause, Effect, Exit } from "effect"
import { afterEach, expect, onTestFinished, test, vi } from "vitest"
import { Near } from "../../src/core/near.js"
import { ExternalError } from "../../src/effect/runtime.js"
import { inspectSignedTransaction } from "../../../../tests/browser/wire-oracle.js"
import { transactionPlan, Actions } from "../../src/effect/index.js"
import { generateKey } from "../../src/utils/key.js"

import {
  testBlock as block,
  testBlockHash as zeroHash,
} from "../helpers/rpc.js"

afterEach(() => vi.unstubAllGlobals())

test.each([
  { api: "public", heldStage: "sign", partition: "key", ending: "success" },
  { api: "public", heldStage: "dispatch", partition: "key", ending: "success" },
  { api: "native", heldStage: "sign", partition: "key", ending: "success" },
  { api: "native", heldStage: "dispatch", partition: "key", ending: "success" },
  { api: "public", heldStage: "sign", partition: "slot", ending: "success" },
  { api: "native", heldStage: "sign", partition: "slot", ending: "success" },
  { api: "native", heldStage: "sign", partition: "key", ending: "failure" },
  { api: "native", heldStage: "sign", partition: "key", ending: "interrupt" },
] as const)(
  "$api orders $partition during $heldStage/$ending while another lane progresses",
  async ({ api, heldStage, partition, ending }) => {
    const keyA = generateKey()
    const keyB = partition === "key" ? generateKey() : keyA
    const aPublic = keyA.publicKey.toString()
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    onTestFinished(() => release.resolve())
    let keyReads = 0
    const failure = new Error("hardware signing failed")
    const controller = new AbortController()
    let firstExit: Exit.Exit<unknown, unknown> | undefined
    const firstSlot = partition === "slot" ? 0 : undefined
    const keySequence = [keyA, keyA, keyB]
    const chain = new Map<string, number>()
    const delivered: {
      publicKey: string
      nonce: number
      hash: string
      nonceIndex?: number
    }[] = []
    const isFirstLane = (r: (typeof delivered)[number]) =>
      r.publicKey === aPublic && r.nonceIndex === firstSlot
    const laneKey = (key: string, slot?: number) =>
      key + ":" + (slot ?? "ordinary")
    const admitted: typeof delivered = []
    vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
      if (typeof init.body !== "string")
        throw new Error("Expected JSON request")
      const { id, method, params } = JSON.parse(init.body)
      const result = (value: unknown) =>
        Response.json({ jsonrpc: "2.0", id, result: value })
      if (method === "block") return result(block)
      if (
        method === "EXPERIMENTAL_view_gas_key_nonces" ||
        (method === "query" && params.request_type === "view_gas_key_nonces")
      )
        return result({
          nonces: [
            chain.get(laneKey(params.public_key, 0)) ?? 1,
            chain.get(laneKey(params.public_key, 1)) ?? 1,
          ],
          block_height: 100,
          block_hash: zeroHash,
        })
      if (method === "query")
        return result({
          nonce: chain.get(laneKey(params.public_key)) ?? 1,
          permission: "FullAccess",
          block_height: 100,
          block_hash: zeroHash,
        })
      if (method === "EXPERIMENTAL_tx_status")
        return Response.json({
          jsonrpc: "2.0",
          id,
          error: {
            name: "HANDLER_ERROR",
            code: -32000,
            message: "Not admitted",
            cause: {
              name: "UNKNOWN_TRANSACTION",
              info: { requested_transaction_hash: params.tx_hash },
            },
          },
        })
      if (method !== "send_tx") throw new Error(`Unexpected RPC ${method}`)
      const tx = inspectSignedTransaction(params.signed_tx_base64)
      expect(tx.signatureValid).toBe(true)
      const { publicKey, nonce, hash } = tx
      const record = {
        publicKey,
        nonce,
        hash,
        ...(tx.nonceIndex === undefined ? {} : { nonceIndex: tx.nonceIndex }),
      }
      delivered.push(record)
      if (
        heldStage === "dispatch" &&
        isFirstLane(record) &&
        delivered.filter(isFirstLane).length === 1
      ) {
        entered.resolve()
        await release.promise
      }
      const current = chain.get(laneKey(publicKey, tx.nonceIndex)) ?? 1
      if (nonce <= current)
        return Response.json({
          jsonrpc: "2.0",
          id,
          error: {
            name: "HANDLER_ERROR",
            code: -32000,
            message: "Nonce rejected",
            cause: { name: "INVALID_TRANSACTION", info: {} },
            data: {
              TxExecutionError: {
                InvalidTxError: {
                  InvalidNonce: { tx_nonce: nonce, ak_nonce: current },
                },
              },
            },
          },
        })
      chain.set(laneKey(publicKey, tx.nonceIndex), nonce)
      admitted.push(record)
      const status = { SuccessValue: "" }
      return result({
        final_execution_status: "EXECUTED_OPTIMISTIC",
        status,
        transaction: {
          signer_id: "alice.near",
          receiver_id: "bob.near",
          public_key: publicKey,
          nonce,
          hash,
          actions: [],
          signature: "fixture",
        },
        transaction_outcome: {
          id: hash,
          block_hash: zeroHash,
          proof: [],
          outcome: {
            logs: [],
            receipt_ids: [],
            gas_burnt: 0,
            tokens_burnt: "0",
            executor_id: "bob.near",
            status,
          },
        },
        receipts_outcome: [],
        receipts: [],
      })
    })
    const near = new Near({
      rpcUrl: "https://fixture.invalid",
      defaultSignerId: "alice.near",
      retryConfig: { maxRetries: 0 },
      keyStore: {
        get: async () => {
          const key = keySequence[keyReads++]
          if (!key) throw new Error("A send selected its key more than once")
          return key
        },
        add: async () => {},
        remove: async () => {},
        list: async () => [],
      },
    })
    const start = (
      key: typeof keyA,
      amount: number,
      slot?: number,
      signal?: AbortSignal,
    ) => {
      const sign = async (digest: Uint8Array) => {
        if (amount === 1 && heldStage === "sign") {
          entered.resolve()
          await release.promise
          if (ending === "failure") throw failure
        }
        return key.sign(digest)
      }
      if (api === "public") {
        const builder = near
          .transaction("alice.near")
          .transfer("bob.near", BigInt(amount))
          .signWith(sign)
        if (slot !== undefined) builder.useGasKey(slot)
        return builder.send()
      }
      const operation = near.effects.transactions
        .send(
          transactionPlan({
            signerId: "alice.near",
            receiverId: "bob.near",
            actions: [Actions.transfer(BigInt(amount))],
            ...(slot === undefined ? {} : { nonceIndex: slot }),
            signer: (digest) =>
              Effect.tryPromise({
                try: () => sign(digest),
                catch: (cause) =>
                  new ExternalError({
                    operation: "ordering fixture signer",
                    cause,
                  }),
              }),
          }),
        )
        .pipe(
          Effect.onExit((exit) =>
            Effect.sync(() => {
              if (amount === 1) firstExit = exit
            }),
          ),
        )
      return Effect.runPromise(operation, signal ? { signal } : undefined)
    }
    const first = start(keyA, 1, firstSlot, controller.signal)
    await entered.promise
    const second = start(keyA, 2, firstSlot)
    const independent = start(keyB, 3, partition === "slot" ? 1 : undefined)
    const completed = Promise.allSettled([first, second, independent])
    // A different-key completion is a progress barrier, not an arbitrary sleep.
    await independent
    const beforeRelease = delivered.filter(isFirstLane).map((d) => d.nonce)
    if (ending === "interrupt") {
      controller.abort()
      await first.catch(() => undefined)
    }
    release.resolve()
    const outcomes = await completed
    expect(beforeRelease).toEqual(heldStage === "sign" ? [] : [2])
    expect(outcomes.map((r) => r.status)).toEqual([
      ending === "success" ? "fulfilled" : "rejected",
      "fulfilled",
      "fulfilled",
    ])
    expect(admitted).toHaveLength(ending === "success" ? 3 : 2)
    expect(admitted.filter(isFirstLane).map((d) => d.nonce)).toEqual(
      ending === "success" ? [2, 3] : [3],
    )
    if (ending === "failure") {
      const firstResult = outcomes[0]
      if (!firstResult || firstResult.status !== "rejected")
        throw new Error("Expected signing failure")
      expect(firstResult.reason).toMatchObject({ cause: failure })
    }
    if (ending === "interrupt") {
      expect(
        firstExit &&
          Exit.isFailure(firstExit) &&
          Cause.hasInterrupts(firstExit.cause),
      ).toBe(true)
    }
    expect(keyReads).toBe(3)
  },
  10_000,
)
