import { Effect } from "effect"
import { describe, expect, test } from "vitest"
import { isDefinitiveNonceRejection } from "../../src/core/rpc/submission.js"
import { runPromise } from "../../src/effect/runtime.js"
import { InvalidNonceError } from "../../src/errors/index.js"
import { testRpcPrograms } from "../helpers/rpc.js"

const signedBytes = new Uint8Array([1, 2, 3])

function nonceRejection(
  {
    id,
    txNonce = 2,
    akNonce = 2,
  }: {
    id: unknown
    txNonce?: number
    akNonce?: number
  } = { id: 1 },
): Response {
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
            InvalidNonce: { tx_nonce: txNonce, ak_nonce: akNonce },
          },
        },
      },
    },
  })
}

describe("RPC transaction submission provenance", () => {
  test("marks a decoded first-attempt send_tx nonce rejection, but not a read error", async () => {
    const rpc = testRpcPrograms(
      "https://rpc.test",
      async () => nonceRejection(),
      undefined,
      { maxRetries: 0, initialDelayMs: 0 },
    )
    const rejection = await runPromise(
      rpc.sendTransaction(signedBytes, "NONE").pipe(Effect.flip),
    )
    expect(rejection).toBeInstanceOf(InvalidNonceError)
    expect(isDefinitiveNonceRejection(rejection)).toBe(true)
    const readFailure = await runPromise(rpc.getGasPrice().pipe(Effect.flip))
    expect(readFailure).toBeInstanceOf(InvalidNonceError)
    expect(isDefinitiveNonceRejection(readFailure)).toBe(false)
  })

  test("does not treat a transport-thrown InvalidNonce as a decoded rejection", async () => {
    const transportFailure = new InvalidNonceError(2, 2)
    const rpc = testRpcPrograms(
      "https://rpc.test",
      async () => {
        throw transportFailure
      },
      undefined,
      { maxRetries: 0, initialDelayMs: 0 },
    )
    const failure = await runPromise(
      rpc.sendTransaction(signedBytes, "NONE").pipe(Effect.flip),
    )
    expect(failure).toMatchObject({
      code: "TRANSACTION_OUTCOME_UNKNOWN",
      retryable: false,
      data: { cause: transportFailure },
    })
    expect(isDefinitiveNonceRejection(failure)).toBe(false)
  })

  test("does not reuse rejection evidence when a transport throws an earlier decoded error", async () => {
    let earlierRejection: InvalidNonceError | undefined
    const rpc = testRpcPrograms(
      "https://rpc.test",
      async () => {
        if (earlierRejection) throw earlierRejection
        return nonceRejection()
      },
      undefined,
      { maxRetries: 0, initialDelayMs: 0 },
    )
    const first = await runPromise(
      rpc.sendTransaction(signedBytes, "NONE").pipe(Effect.flip),
    )
    if (!isDefinitiveNonceRejection(first))
      throw new Error("expected decoded rejection")
    earlierRejection = first
    const later = await runPromise(
      rpc.sendTransaction(signedBytes, "NONE").pipe(Effect.flip),
    )
    expect(later).toMatchObject({
      code: "TRANSACTION_OUTCOME_UNKNOWN",
      retryable: false,
      data: { cause: first },
    })
    expect(isDefinitiveNonceRejection(later)).toBe(false)
  })

  test.each(["lost response", "invalid JSON", "missing result"])(
    "keeps the outcome uncertain after %s followed by a decoded nonce rejection",
    async (uncertainty) => {
      const requests: string[] = []
      const rpc = testRpcPrograms(
        "https://rpc.test",
        async (_, init) => {
          if (typeof init.body !== "string")
            throw new Error("expected JSON request")
          requests.push(init.body)
          if (requests.length > 1) return nonceRejection()
          if (uncertainty === "lost response")
            throw new Error("response lost after acceptance")
          return uncertainty === "invalid JSON"
            ? new Response("not JSON")
            : Response.json({ jsonrpc: "2.0", id: 1 })
        },
        undefined,
        { maxRetries: 2, initialDelayMs: 0 },
      )
      const failure = await runPromise(
        rpc.sendTransaction(signedBytes, "NONE").pipe(Effect.flip),
      )
      expect(failure).toMatchObject({
        code: "TRANSACTION_OUTCOME_UNKNOWN",
        retryable: false,
        data: { cause: expect.any(InvalidNonceError) },
      })
      expect(isDefinitiveNonceRejection(failure)).toBe(false)
      const body = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "send_tx",
        params: { signed_tx_base64: "AQID", wait_until: "NONE" },
      })
      expect(requests).toEqual([body, body, body])
    },
  )

  test.each([
    { evidence: "stale response ID", id: 0, txNonce: 2, akNonce: 2 },
    { evidence: "missing response ID", id: undefined, txNonce: 2, akNonce: 2 },
    {
      evidence: "response ID with the wrong type",
      id: "1",
      txNonce: 2,
      akNonce: 2,
    },
    { evidence: "negative transaction nonce", id: 1, txNonce: -1, akNonce: 2 },
    {
      evidence: "fractional transaction nonce",
      id: 1,
      txNonce: 1.5,
      akNonce: 2,
    },
    {
      evidence: "unsafe transaction nonce",
      id: 1,
      txNonce: Number.MAX_SAFE_INTEGER + 1,
      akNonce: Number.MAX_SAFE_INTEGER + 1,
    },
    { evidence: "negative access-key nonce", id: 1, txNonce: 0, akNonce: -1 },
    {
      evidence: "fractional access-key nonce",
      id: 1,
      txNonce: 2,
      akNonce: 2.5,
    },
    {
      evidence: "unsafe access-key nonce",
      id: 1,
      txNonce: 2,
      akNonce: Number.MAX_SAFE_INTEGER + 1,
    },
    {
      evidence: "access-key nonce below transaction nonce",
      id: 1,
      txNonce: 2,
      akNonce: 1,
    },
  ])(
    "keeps $evidence uncertain even after a later matching rejection",
    async ({ id, txNonce, akNonce }) => {
      let attempts = 0
      const rpc = testRpcPrograms(
        "https://rpc.test",
        async () => {
          attempts++
          return attempts === 1
            ? nonceRejection({ id, txNonce, akNonce })
            : nonceRejection()
        },
        undefined,
        { maxRetries: 1, initialDelayMs: 0 },
      )
      const failure = await runPromise(
        rpc.sendTransaction(signedBytes, "NONE").pipe(Effect.flip),
      )
      expect(failure).toMatchObject({
        code: "TRANSACTION_OUTCOME_UNKNOWN",
        retryable: false,
      })
      expect(isDefinitiveNonceRejection(failure)).toBe(false)
      expect(attempts).toBe(2)
    },
  )

  test("requires every same-byte rejection to attest the same transaction nonce", async () => {
    let attempts = 0
    const rpc = testRpcPrograms(
      "https://rpc.test",
      async () => {
        attempts++
        return nonceRejection({
          id: 1,
          txNonce: attempts === 1 ? 1 : 2,
          akNonce: 2,
        })
      },
      undefined,
      { maxRetries: 1, initialDelayMs: 0 },
    )
    const failure = await runPromise(
      rpc.sendTransaction(signedBytes, "NONE").pipe(Effect.flip),
    )
    expect(failure).toMatchObject({
      code: "TRANSACTION_OUTCOME_UNKNOWN",
      retryable: false,
    })
    expect(isDefinitiveNonceRejection(failure)).toBe(false)
    expect(attempts).toBe(2)
  })

  test("retains successful same-byte retries after a lost submission response", async () => {
    const requests: string[] = []
    const rpc = testRpcPrograms(
      "https://rpc.test",
      async (_, init) => {
        if (typeof init.body !== "string")
          throw new Error("expected JSON request")
        requests.push(init.body)
        if (requests.length === 1)
          throw new Error("response lost after acceptance")
        return Response.json({ result: { final_execution_status: "NONE" } })
      },
      undefined,
      { maxRetries: 1, initialDelayMs: 0 },
    )
    expect(await runPromise(rpc.sendTransaction(signedBytes, "NONE"))).toEqual({
      final_execution_status: "NONE",
    })
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "send_tx",
      params: { signed_tx_base64: "AQID", wait_until: "NONE" },
    })
    expect(requests).toEqual([body, body])
  })

  test("retains ordinary read retries after a transient transport failure", async () => {
    let attempts = 0
    const rpc = testRpcPrograms(
      "https://rpc.test",
      async () => {
        attempts++
        return attempts === 1
          ? new Response("unavailable", { status: 503 })
          : Response.json({ result: { gas_price: "10" } })
      },
      undefined,
      { maxRetries: 1, initialDelayMs: 0 },
    )
    expect(await runPromise(rpc.getGasPrice())).toEqual({ gas_price: "10" })
    expect(attempts).toBe(2)
  })

  test("keeps uncertainty within one execution of a submission program", async () => {
    let attempts = 0
    const rpc = testRpcPrograms(
      "https://rpc.test",
      async (_, init) => {
        attempts++
        if (attempts === 1) throw new Error("response lost")
        if (typeof init.body !== "string")
          throw new Error("expected JSON request")
        return nonceRejection({ id: JSON.parse(init.body).id })
      },
      undefined,
      { maxRetries: 1, initialDelayMs: 0 },
    )
    const submission = rpc.sendTransaction(signedBytes, "NONE")
    const uncertain = await runPromise(submission.pipe(Effect.flip))
    expect(uncertain).toMatchObject({ code: "TRANSACTION_OUTCOME_UNKNOWN" })
    const rejected = await runPromise(submission.pipe(Effect.flip))
    expect(isDefinitiveNonceRejection(rejected)).toBe(true)
    expect(attempts).toBe(4)
  })
})
