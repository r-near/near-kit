import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  NearProvider,
  useAccountExists,
  useBalance,
  useView,
} from "../src/index.js"

// Create mock functions at module level
const mockView = vi.fn()
const mockGetBalance = vi.fn()
const mockAccountExists = vi.fn()

interface MockNearInstance {
  view: typeof mockView
  call: ReturnType<typeof vi.fn>
  send: ReturnType<typeof vi.fn>
  contract: ReturnType<typeof vi.fn>
  getBalance: typeof mockGetBalance
  accountExists: typeof mockAccountExists
}

// Mock the Near class using a function factory
vi.mock("near-kit", () => {
  return {
    Near: vi.fn().mockImplementation(function (this: MockNearInstance) {
      this.view = mockView
      this.call = vi.fn()
      this.send = vi.fn()
      this.contract = vi.fn()
      this.getBalance = mockGetBalance
      this.accountExists = mockAccountExists
    }),
  }
})

const wrapper = ({ children }: { children: ReactNode }) => (
  <NearProvider config={{ network: "testnet" }}>{children}</NearProvider>
)

describe("useView", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("fetches data on mount", async () => {
    mockView.mockResolvedValue(42)

    const { result } = renderHook(
      () =>
        useView<Record<string, never>, number>({
          contractId: "counter.testnet",
          method: "get_count",
        }),
      { wrapper },
    )

    expect(result.current.isLoading).toBe(true)

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.data).toBe(42)
    expect(result.current.error).toBeUndefined()
    expect(mockView).toHaveBeenCalledWith("counter.testnet", "get_count", {})
  })

  it("handles errors", async () => {
    const error = new Error("Contract not found")
    mockView.mockRejectedValue(error)

    const { result } = renderHook(
      () =>
        useView({
          contractId: "missing.testnet",
          method: "get_count",
        }),
      { wrapper },
    )

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.data).toBeUndefined()
    expect(result.current.error).toBeInstanceOf(Error)
    expect(result.current.error?.message).toBe("Contract not found")
  })

  it("respects enabled=false", async () => {
    const { result } = renderHook(
      () =>
        useView({
          contractId: "counter.testnet",
          method: "get_count",
          enabled: false,
        }),
      { wrapper },
    )

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(mockView).not.toHaveBeenCalled()
    expect(result.current.data).toBeUndefined()
  })

  it("refetches when refetch is called", async () => {
    mockView.mockResolvedValueOnce(1).mockResolvedValueOnce(2)

    const { result } = renderHook(
      () =>
        useView<Record<string, never>, number>({
          contractId: "counter.testnet",
          method: "get_count",
        }),
      { wrapper },
    )

    await waitFor(() => {
      expect(result.current.data).toBe(1)
    })

    await act(async () => {
      await result.current.refetch()
    })

    expect(result.current.data).toBe(2)
    expect(mockView).toHaveBeenCalledTimes(2)
  })

  it("ignores stale responses", async () => {
    let resolveFirst: ((value: number) => void) | undefined
    let resolveSecond: ((value: number) => void) | undefined

    mockView
      .mockImplementationOnce(
        () =>
          new Promise<number>((resolve) => {
            resolveFirst = resolve
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<number>((resolve) => {
            resolveSecond = resolve
          }),
      )

    const { result, rerender } = renderHook(
      ({ args }) =>
        useView<{ id: number }, number>({
          contractId: "counter.testnet",
          method: "get_count",
          args,
        }),
      { wrapper, initialProps: { args: { id: 1 } } },
    )

    // First request starts
    expect(result.current.isLoading).toBe(true)

    // Second request starts (args change)
    rerender({ args: { id: 2 } })

    // Resolve second first (out of order)
    if (resolveSecond) resolveSecond(200)

    await waitFor(() => {
      expect(result.current.data).toBe(200)
    })

    // Now resolve first (stale)
    if (resolveFirst) resolveFirst(100)

    // Should still show second result, not stale first
    await waitFor(() => {
      expect(result.current.data).toBe(200)
    })
  })
})

describe("useBalance", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("fetches balance", async () => {
    mockGetBalance.mockResolvedValue("10 NEAR")

    const { result } = renderHook(
      () => useBalance({ accountId: "alice.testnet" }),
      { wrapper },
    )

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.data).toBe("10 NEAR")
    expect(mockGetBalance).toHaveBeenCalledWith("alice.testnet")
  })

  it("respects enabled=false", async () => {
    const { result } = renderHook(
      () => useBalance({ accountId: "alice.testnet", enabled: false }),
      { wrapper },
    )

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(mockGetBalance).not.toHaveBeenCalled()
    expect(result.current.data).toBeUndefined()
  })

  it("handles errors", async () => {
    const error = new Error("Account not found")
    mockGetBalance.mockRejectedValue(error)

    const { result } = renderHook(
      () => useBalance({ accountId: "missing.testnet" }),
      { wrapper },
    )

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.error).toBeInstanceOf(Error)
    expect(result.current.error?.message).toBe("Account not found")
  })
})

describe("useAccountExists", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("checks account existence", async () => {
    mockAccountExists.mockResolvedValue(true)

    const { result } = renderHook(
      () => useAccountExists({ accountId: "alice.testnet" }),
      { wrapper },
    )

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.data).toBe(true)
    expect(mockAccountExists).toHaveBeenCalledWith("alice.testnet")
  })

  it("handles non-existent account", async () => {
    mockAccountExists.mockResolvedValue(false)

    const { result } = renderHook(
      () => useAccountExists({ accountId: "missing.testnet" }),
      { wrapper },
    )

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.data).toBe(false)
  })

  it("respects enabled=false", async () => {
    const { result } = renderHook(
      () => useAccountExists({ accountId: "alice.testnet", enabled: false }),
      { wrapper },
    )

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(mockAccountExists).not.toHaveBeenCalled()
    expect(result.current.data).toBeUndefined()
  })

  it("handles errors", async () => {
    const error = new Error("Network error")
    mockAccountExists.mockRejectedValue(error)

    const { result } = renderHook(
      () => useAccountExists({ accountId: "alice.testnet" }),
      { wrapper },
    )

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.error).toBeInstanceOf(Error)
    expect(result.current.error?.message).toBe("Network error")
  })
})
