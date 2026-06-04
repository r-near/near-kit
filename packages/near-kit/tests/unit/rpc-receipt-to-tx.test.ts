/**
 * Unit tests for RpcClient.receiptToTx (EXPERIMENTAL_receipt_to_tx)
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { RpcClient } from "../../src/core/rpc/rpc.js"
import { UnknownReceiptError } from "../../src/errors/index.js"

describe("RpcClient.receiptToTx", () => {
  let originalFetch: typeof global.fetch

  beforeEach(() => {
    originalFetch = global.fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  test("returns parsed response and calls the right method/params", async () => {
    const receiptId = "9ADoP8t3kRkV6JqYy3a6mJZ1uXuJ4Z3o2bF7tQwErTy"
    const expected = {
      transaction_hash: "7AfonAhbK4ZbdBU9VPcQdrTZVZBXE25HmZAMEABs9To1",
      sender_account_id: "alice.near",
    }

    const mockFetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: expected,
        }),
        { status: 200 },
      )
    })

    global.fetch = mockFetch as unknown as typeof global.fetch

    const rpc = new RpcClient("https://test.rpc.near.org")
    const result = await rpc.receiptToTx(receiptId)

    expect(result).toEqual(expected)

    // Verify the request method and params
    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.method).toBe("EXPERIMENTAL_receipt_to_tx")
    expect(body.params).toEqual({ receipt_id: receiptId })
  })

  test("throws UnknownReceiptError for UNKNOWN_RECEIPT error cause", async () => {
    const receiptId = "UnknownReceipt111111111111111111111111111111"

    const mockFetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          error: {
            name: "HANDLER_ERROR",
            code: -32000,
            message: "Receipt not found",
            cause: {
              name: "UNKNOWN_RECEIPT",
              info: { receipt_id: receiptId },
            },
          },
        }),
        { status: 200 },
      )
    })

    global.fetch = mockFetch as unknown as typeof global.fetch

    const rpc = new RpcClient("https://test.rpc.near.org")

    await expect(rpc.receiptToTx(receiptId)).rejects.toThrow(
      UnknownReceiptError,
    )

    try {
      await rpc.receiptToTx(receiptId)
    } catch (error) {
      expect(error).toBeInstanceOf(UnknownReceiptError)
      expect((error as UnknownReceiptError).receiptId).toBe(receiptId)
    }
  })
})
