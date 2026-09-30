import { Effect } from "effect"
import { describe, expect, test } from "vitest"
import { runPromise } from "../../src/effect/runtime.js"
import { InvalidNonceError, NetworkError } from "../../src/errors/index.js"
import { testRpcPrograms } from "../helpers/rpc.js"

function nonceRejection(id: unknown): Response {
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
          InvalidTxError: { InvalidNonce: { tx_nonce: 2, ak_nonce: 2 } },
        },
      },
    },
  })
}

// RPC owns bounded retries of one payload. Only the transaction owner knows its
// signed hash and can reconcile outcomes; a low-level error never proves nonexecution.
describe("RPC same-byte transaction retries", () => {
  test.each([
    "lost response",
    "invalid JSON",
    "missing result",
    "nonce rejection",
  ])(
    "%s cannot change the request ID or signed payload across retries",
    async (fault) => {
      const bytes = new Uint8Array([1, 2, 3])
      const requests: string[] = []
      const rpc = testRpcPrograms(
        "https://rpc.test",
        async (_, init) => {
          if (typeof init.body !== "string")
            throw new Error("expected JSON request")
          requests.push(init.body)
          bytes.fill(9) // The encoded request already owns its payload.
          if (requests.length > 1 || fault === "nonce rejection")
            return nonceRejection(1)
          if (fault === "lost response")
            throw new Error("response lost after acceptance")
          return fault === "invalid JSON"
            ? new Response("not JSON")
            : Response.json({ jsonrpc: "2.0", id: 1 })
        },
        undefined,
        { maxRetries: 2, initialDelayMs: 0 },
      )
      const failure = await runPromise(
        rpc.sendTransaction(bytes, "NONE").pipe(Effect.flip),
      )
      expect(failure).toBeInstanceOf(InvalidNonceError)
      const body = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "send_tx",
        params: { signed_tx_base64: "AQID", wait_until: "NONE" },
      })
      expect(requests).toEqual([body, body, body])
    },
  )

  test("can recover a lost response by resending the exact bytes without signing again", async () => {
    const requests: string[] = []
    const rpc = testRpcPrograms(
      "https://rpc.test",
      async (_, init) => {
        if (typeof init.body !== "string")
          throw new Error("expected JSON request")
        requests.push(init.body)
        if (requests.length === 1) throw new Error("response lost")
        return Response.json({
          jsonrpc: "2.0",
          id: 1,
          result: { final_execution_status: "NONE" },
        })
      },
      undefined,
      { maxRetries: 1, initialDelayMs: 0 },
    )
    await expect(
      runPromise(rpc.sendTransaction(new Uint8Array([1, 2, 3]), "NONE")),
    ).resolves.toEqual({ final_execution_status: "NONE" })
    expect(requests).toHaveLength(2)
    expect(requests[0]).toBe(requests[1])
  })

  test("exhausted transport failures retain their original low-level error and bounded attempts", async () => {
    const error = new NetworkError("unavailable")
    let attempts = 0
    const rpc = testRpcPrograms(
      "https://rpc.test",
      async () => {
        attempts++
        throw error
      },
      undefined,
      { maxRetries: 2, initialDelayMs: 0 },
    )
    await expect(
      runPromise(rpc.sendTransaction(new Uint8Array([1]), "NONE")),
    ).rejects.toBe(error)
    expect(attempts).toBe(3)
  })
})
