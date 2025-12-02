import { describe, expect, test, vi } from "vitest"

import { Near } from "../../src/core/near.js"
import type { CallOptions } from "../../src/core/types.js"
import type { Amount, Gas } from "../../src/utils/validation.js"

describe("Near edge behaviors", () => {
  test("view returns undefined on empty response and raw string on parse failure", async () => {
    const near = new Near()
    const viewFn = vi.fn().mockResolvedValue({ result: [] })
    ;(near as unknown as { rpc: unknown }).rpc = { viewFunction: viewFn }

    const emptyResult = await near.view("contract.near", "method")
    expect(emptyResult).toBeUndefined()

    const rawText = "plain text"
    viewFn.mockResolvedValueOnce({
      result: new TextEncoder().encode(rawText),
    })
    const stringResult = await near.view("contract.near", "method")
    expect(stringResult).toBe(rawText)
  })

  test("call forwards gas/deposit options to transaction builder", async () => {
    const near = new Near()
    near["defaultSignerId"] = "alice.near"
    // Force wallet-less path
    ;(near as unknown as { wallet?: unknown }).wallet = undefined

    const functionCall = vi.fn().mockReturnThis()
    const send = vi.fn().mockResolvedValue("ok")
    const txBuilder = { functionCall, send }
    ;(near as unknown as { transaction: unknown }).transaction = vi
      .fn()
      .mockReturnValue(txBuilder)

    const options: CallOptions = {
      gas: "30 Tgas" as Gas,
      attachedDeposit: "1 yocto" as Amount,
      waitUntil: "FINAL",
      signerId: "alice.near",
    }

    await near.call("contract.near", "method", {}, options)

    expect(functionCall).toHaveBeenCalledWith(
      "contract.near",
      "method",
      {},
      { gas: options.gas, attachedDeposit: options.attachedDeposit },
    )
    expect(send).toHaveBeenCalledWith({ waitUntil: "FINAL" })
  })

  test("send falls back to transaction builder when no wallet is configured", async () => {
    const near = new Near()
    near["defaultSignerId"] = "alice.near"
    ;(near as unknown as { wallet?: unknown }).wallet = undefined

    const transfer = vi.fn().mockReturnThis()
    const send = vi.fn().mockResolvedValue("sent")
    const builder = { transfer, send }

    ;(near as unknown as { transaction: unknown }).transaction = vi
      .fn()
      .mockReturnValue(builder)

    await near.send("bob.near", "1 NEAR")

    expect(transfer).toHaveBeenCalledWith("bob.near", "1 NEAR")
    expect(send).toHaveBeenCalled()
  })
})
