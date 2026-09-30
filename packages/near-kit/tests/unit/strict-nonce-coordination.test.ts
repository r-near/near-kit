import { Effect } from "effect"
import { afterEach, expect, test, vi } from "vitest"
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
  { api: "public", slot: undefined, scenario: "mixed" },
  { api: "native", slot: undefined, scenario: "mixed" },
  { api: "public", slot: 0, scenario: "mixed" },
  { api: "native", slot: 0, scenario: "mixed" },
  { api: "public", slot: undefined, scenario: "failed-sign" },
  { api: "native", slot: undefined, scenario: "failed-sign" },
  { api: "public", slot: 0, scenario: "failed-sign" },
  { api: "native", slot: 0, scenario: "failed-sign" },
] as const)(
  "$api coordinates strict nonce in slot $slot after $scenario",
  async ({ api, slot, scenario }) => {
    const key = generateKey()
    let chain = 1
    const submitted: { nonce: number; strict: boolean }[] = []
    vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
      if (typeof init.body !== "string") throw new Error("Expected body")
      const { id, method, params } = JSON.parse(init.body)
      const result = (value: unknown) =>
        Response.json({ jsonrpc: "2.0", id, result: value })
      if (method === "block") return result(block)
      if (method === "query" && params.request_type === "view_access_key")
        return result({
          nonce: chain,
          permission: "FullAccess",
          block_height: 100,
          block_hash: zeroHash,
        })
      if (
        method === "EXPERIMENTAL_view_gas_key_nonces" ||
        (method === "query" && params.request_type === "view_gas_key_nonces")
      )
        return result({
          nonces: [chain],
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
            message: "Unknown",
            cause: {
              name: "UNKNOWN_TRANSACTION",
              info: { requested_transaction_hash: params.tx_hash },
            },
          },
        })
      if (method !== "send_tx") throw new Error(`Unexpected ${method}`)
      const tx = inspectSignedTransaction(params.signed_tx_base64)
      expect(tx.signatureValid).toBe(true)
      expect(tx.nonceIndex).toBe(slot)
      submitted.push({ nonce: tx.nonce, strict: tx.strict })
      if (tx.nonce <= chain || (tx.strict && tx.nonce !== chain + 1))
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
                  InvalidNonce: { tx_nonce: tx.nonce, ak_nonce: chain },
                },
              },
            },
          },
        })
      chain = tx.nonce
      return result({ final_execution_status: "NONE" })
    })
    const near = new Near({
      rpcUrl: "https://fixture.invalid",
      privateKey: key.secretKey,
      defaultSignerId: "alice.near",
      retryConfig: { maxRetries: 0 },
    })
    const failure = new Error("Hardware signer unavailable before submission")
    let failNextSignature = scenario === "failed-sign"
    const sign = async (digest: Uint8Array) => {
      if (failNextSignature) {
        failNextSignature = false
        throw failure
      }
      return key.sign(digest)
    }
    const terminal = (strict: boolean) => {
      if (api === "public") {
        const builder = near
          .transaction("alice.near")
          .transfer("bob.near", 1n)
          .strictNonceMode(strict)
          .signWith(sign)
        if (slot !== undefined) builder.useGasKey(slot)
        return () => builder.send({ waitUntil: "NONE" })
      }
      const operation = near.effects.transactions.send(
        transactionPlan({
          signerId: "alice.near",
          receiverId: "bob.near",
          actions: [Actions.transfer(1n)],
          strictNonce: strict,
          ...(slot === undefined ? {} : { nonceIndex: slot }),
          signer: (digest) =>
            Effect.tryPromise({
              try: () => sign(digest),
              catch: (cause) =>
                new ExternalError({ operation: "fixture signer", cause }),
            }),
        }),
        { waitUntil: "NONE" },
      )
      return () => Effect.runPromise(operation)
    }
    if (scenario === "mixed") {
      await terminal(false)()
      await terminal(true)()
      // Assert the actual wire sequence even when the final send rejects.
      const last = await terminal(false)().then(
        () => "success",
        () => "failure",
      )
      expect(submitted).toEqual([
        { nonce: 2, strict: false },
        { nonce: 3, strict: true },
        { nonce: 4, strict: false },
      ])
      expect(last).toBe("success")
    } else {
      const retry = terminal(true)
      if (api === "public") await expect(retry()).rejects.toBe(failure)
      else
        await expect(retry()).rejects.toMatchObject({
          _tag: "ExternalError",
          cause: failure,
        })
      expect(submitted).toEqual([])
      await retry()
      await terminal(false)()
      expect(submitted).toEqual([
        { nonce: 2, strict: true },
        { nonce: 3, strict: false },
      ])
    }
  },
)
