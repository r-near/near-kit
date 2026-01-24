import { act, renderHook } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NearProvider, useCall, useSend } from "../src/index.js"

// Create mock functions at module level
const mockCall = vi.fn()
const mockSend = vi.fn()

interface MockNearInstance {
  view: ReturnType<typeof vi.fn>
  call: typeof mockCall
  send: typeof mockSend
  contract: ReturnType<typeof vi.fn>
  getBalance: ReturnType<typeof vi.fn>
  accountExists: ReturnType<typeof vi.fn>
}

// Mock the Near class using a function factory
vi.mock("near-kit", () => {
  return {
    Near: vi.fn().mockImplementation(function (this: MockNearInstance) {
      this.view = vi.fn()
      this.call = mockCall
      this.send = mockSend
      this.contract = vi.fn()
      this.getBalance = vi.fn()
      this.accountExists = vi.fn()
    }),
  }
})

const wrapper = ({ children }: { children: ReactNode }) => (
  <NearProvider config={{ network: "testnet" }}>{children}</NearProvider>
)

describe("useCall", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("executes call and tracks state", async () => {
    mockCall.mockResolvedValue("success")

    const { result } = renderHook(
      () =>
        useCall<{ value: number }, string>({
          contractId: "counter.testnet",
          method: "increment",
        }),
      { wrapper },
    )

    expect(result.current.isPending).toBe(false)
    expect(result.current.isSuccess).toBe(false)
    expect(result.current.isError).toBe(false)

    await act(async () => {
      await result.current.mutate({ value: 1 })
    })

    expect(result.current.isPending).toBe(false)
    expect(result.current.isSuccess).toBe(true)
    expect(result.current.data).toBe("success")
    expect(mockCall).toHaveBeenCalledWith(
      "counter.testnet",
      "increment",
      { value: 1 },
      {},
    )
  })

  it("handles errors", async () => {
    const error = new Error("Transaction failed")
    mockCall.mockRejectedValue(error)

    const { result } = renderHook(
      () =>
        useCall({
          contractId: "counter.testnet",
          method: "increment",
        }),
      { wrapper },
    )

    await act(async () => {
      try {
        await result.current.mutate({})
      } catch {
        // Expected
      }
    })

    expect(result.current.isPending).toBe(false)
    expect(result.current.isError).toBe(true)
    expect(result.current.error?.message).toBe("Transaction failed")
  })

  it("merges options from params and call", async () => {
    mockCall.mockResolvedValue(undefined)

    const { result } = renderHook(
      () =>
        useCall({
          contractId: "counter.testnet",
          method: "increment",
          options: { gas: "30 Tgas" },
        }),
      { wrapper },
    )

    await act(async () => {
      await result.current.mutate({}, { attachedDeposit: "1 NEAR" })
    })

    expect(mockCall).toHaveBeenCalledWith(
      "counter.testnet",
      "increment",
      {},
      { gas: "30 Tgas", attachedDeposit: "1 NEAR" },
    )
  })

  it("resets state", async () => {
    mockCall.mockResolvedValue("result")

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
    expect(result.current.data).toBe("result")

    act(() => {
      result.current.reset()
    })

    expect(result.current.isSuccess).toBe(false)
    expect(result.current.data).toBeUndefined()
    expect(result.current.error).toBeUndefined()
  })

  it("handles parallel mutations (last write wins)", async () => {
    let resolveFirst: ((value: string) => void) | undefined
    let resolveSecond: ((value: string) => void) | undefined

    mockCall
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            resolveFirst = resolve
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            resolveSecond = resolve
          }),
      )

    const { result } = renderHook(
      () =>
        useCall<Record<string, never>, string>({
          contractId: "counter.testnet",
          method: "increment",
        }),
      { wrapper },
    )

    // Start first mutation
    act(() => {
      result.current.mutate({})
    })

    // Start second mutation while first is pending
    act(() => {
      result.current.mutate({})
    })

    expect(result.current.isPending).toBe(true)

    // Resolve second first
    await act(async () => {
      if (resolveSecond) resolveSecond("second")
    })

    expect(result.current.data).toBe("second")

    // Resolve first (stale)
    await act(async () => {
      if (resolveFirst) resolveFirst("first")
    })

    // Should still be "second"
    expect(result.current.data).toBe("second")
  })
})

describe("useSend", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("sends NEAR tokens", async () => {
    mockSend.mockResolvedValue(undefined)

    const { result } = renderHook(() => useSend(), { wrapper })

    expect(result.current.isPending).toBe(false)

    await act(async () => {
      await result.current.mutate("bob.testnet", "1 NEAR")
    })

    expect(result.current.isPending).toBe(false)
    expect(result.current.isSuccess).toBe(true)
    expect(mockSend).toHaveBeenCalledWith("bob.testnet", "1 NEAR")
  })

  it("handles send errors", async () => {
    const error = new Error("Insufficient balance")
    mockSend.mockRejectedValue(error)

    const { result } = renderHook(() => useSend(), { wrapper })

    await act(async () => {
      try {
        await result.current.mutate("bob.testnet", "1000 NEAR")
      } catch {
        // Expected
      }
    })

    expect(result.current.isError).toBe(true)
    expect(result.current.error?.message).toBe("Insufficient balance")
  })

  it("resets state", async () => {
    mockSend.mockResolvedValue(undefined)

    const { result } = renderHook(() => useSend(), { wrapper })

    await act(async () => {
      await result.current.mutate("bob.testnet", "1 NEAR")
    })

    expect(result.current.isSuccess).toBe(true)

    act(() => {
      result.current.reset()
    })

    expect(result.current.isSuccess).toBe(false)
    expect(result.current.isPending).toBe(false)
    expect(result.current.isError).toBe(false)
    expect(result.current.error).toBeUndefined()
  })
})
