/**
 * Tests for mutation hooks (useCall, useSend)
 */

import { act, renderHook } from "@testing-library/react"
import { type FinalExecutionOutcome, Near } from "near-kit"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useCall, useSend } from "../src/mutation-hooks.js"
import { NearProvider } from "../src/provider.js"

const mockOutcome: FinalExecutionOutcome = {
  status: { SuccessValue: "" },
  transaction: {
    signer_id: "alice.testnet",
    public_key: "ed25519:abc",
    nonce: 1,
    receiver_id: "contract.testnet",
    actions: [],
    signature: "ed25519:sig",
    hash: "hash123",
  },
  transaction_outcome: {
    proof: [],
    block_hash: "block123",
    id: "tx123",
    outcome: {
      logs: [],
      receipt_ids: [],
      gas_burnt: 1000000n,
      tokens_burnt: "0",
      executor_id: "alice.testnet",
      status: { SuccessValue: "" },
      metadata: { version: 1, gas_profile: null },
    },
  },
  receipts_outcome: [],
}

describe("useCall", () => {
  let mockNear: Near
  let wrapper: ({ children }: { children: ReactNode }) => ReactNode

  beforeEach(() => {
    mockNear = new Near({ network: "testnet" })
    wrapper = ({ children }: { children: ReactNode }) => (
      <NearProvider near={mockNear}>{children}</NearProvider>
    )
  })

  it("calls contract method", async () => {
    vi.spyOn(mockNear, "call").mockResolvedValue(mockOutcome)

    const { result } = renderHook(
      () =>
        useCall({
          contractId: "counter.testnet",
          method: "increment",
        }),
      { wrapper },
    )

    expect(result.current.isPending).toBe(false)
    expect(result.current.isSuccess).toBe(false)

    // Execute mutation
    await act(async () => {
      await result.current.mutate({})
    })

    expect(result.current.isPending).toBe(false)
    expect(result.current.isSuccess).toBe(true)
    expect(result.current.data).toEqual(mockOutcome)
    expect(mockNear.call).toHaveBeenCalledWith(
      "counter.testnet",
      "increment",
      {},
      undefined,
    )
  })

  it("handles errors", async () => {
    const mockError = new Error("Transaction failed")
    vi.spyOn(mockNear, "call").mockRejectedValue(mockError)

    const { result } = renderHook(
      () =>
        useCall({
          contractId: "counter.testnet",
          method: "increment",
        }),
      { wrapper },
    )

    // Execute mutation and catch the expected error
    let caughtError: Error | undefined
    await act(async () => {
      try {
        await result.current.mutate({})
      } catch (e) {
        caughtError = e as Error
      }
    })

    expect(caughtError).toBe(mockError)
    expect(result.current.isPending).toBe(false)
    expect(result.current.isError).toBe(true)
    expect(result.current.error).toBe(mockError)
  })

  it("supports reset", async () => {
    vi.spyOn(mockNear, "call").mockResolvedValue(mockOutcome)

    const { result } = renderHook(
      () =>
        useCall({
          contractId: "counter.testnet",
          method: "increment",
        }),
      { wrapper },
    )

    await act(async () => {
      await result.current.mutate({})
    })

    expect(result.current.isSuccess).toBe(true)

    // Reset state
    act(() => {
      result.current.reset()
    })

    expect(result.current.isSuccess).toBe(false)
    expect(result.current.data).toBeUndefined()
  })
})

describe("useSend", () => {
  let mockNear: Near
  let wrapper: ({ children }: { children: ReactNode }) => ReactNode

  beforeEach(() => {
    mockNear = new Near({ network: "testnet" })
    wrapper = ({ children }: { children: ReactNode }) => (
      <NearProvider near={mockNear}>{children}</NearProvider>
    )
  })

  it("sends NEAR tokens", async () => {
    vi.spyOn(mockNear, "send").mockResolvedValue(mockOutcome)

    const { result } = renderHook(() => useSend(), { wrapper })

    expect(result.current.isPending).toBe(false)

    await act(async () => {
      await result.current.mutate("bob.testnet", "1 NEAR")
    })

    expect(result.current.isPending).toBe(false)
    expect(result.current.isSuccess).toBe(true)
    expect(mockNear.send).toHaveBeenCalledWith("bob.testnet", "1 NEAR")
  })

  it("handles errors", async () => {
    const mockError = new Error("Insufficient balance")
    vi.spyOn(mockNear, "send").mockRejectedValue(mockError)

    const { result } = renderHook(() => useSend(), { wrapper })

    // Execute mutation and catch the expected error
    let caughtError: Error | undefined
    await act(async () => {
      try {
        await result.current.mutate("bob.testnet", "1000000 NEAR")
      } catch (e) {
        caughtError = e as Error
      }
    })

    expect(caughtError).toBe(mockError)
    expect(result.current.isError).toBe(true)
    expect(result.current.error).toBe(mockError)
  })
})
