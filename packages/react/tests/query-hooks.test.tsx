/**
 * Tests for query hooks (useView, useAccountExists, useBalance)
 */

import { act, renderHook, waitFor } from "@testing-library/react"
import { Near } from "near-kit"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NearProvider } from "../src/provider.js"
import { useAccountExists, useBalance, useView } from "../src/query-hooks.js"

describe("useView", () => {
  let mockNear: Near
  let wrapper: ({ children }: { children: ReactNode }) => ReactNode

  beforeEach(() => {
    mockNear = new Near({ network: "testnet" })
    wrapper = ({ children }: { children: ReactNode }) => (
      <NearProvider near={mockNear}>{children}</NearProvider>
    )
  })

  it("fetches view data on mount", async () => {
    const mockResult = { count: 42 }
    vi.spyOn(mockNear, "view").mockResolvedValue(mockResult)

    const { result } = renderHook(
      () =>
        useView({
          contractId: "counter.testnet",
          method: "get_count",
        }),
      { wrapper },
    )

    // Initial state
    expect(result.current.isLoading).toBe(true)
    expect(result.current.data).toBeUndefined()

    // Wait for fetch to complete
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.data).toEqual(mockResult)
    expect(result.current.error).toBeUndefined()
  })

  it("handles errors", async () => {
    const mockError = new Error("Contract not found")
    vi.spyOn(mockNear, "view").mockRejectedValue(mockError)

    const { result } = renderHook(
      () =>
        useView({
          contractId: "invalid.testnet",
          method: "get_count",
        }),
      { wrapper },
    )

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.error).toBe(mockError)
    expect(result.current.data).toBeUndefined()
  })

  it("does not fetch when disabled", async () => {
    const viewSpy = vi.spyOn(mockNear, "view").mockResolvedValue({})

    const { result } = renderHook(
      () =>
        useView({
          contractId: "counter.testnet",
          method: "get_count",
          enabled: false,
        }),
      { wrapper },
    )

    // Should remain not loading since query is disabled
    expect(result.current.isLoading).toBe(false)
    expect(viewSpy).not.toHaveBeenCalled()
  })

  it("supports refetch", async () => {
    let callCount = 0
    vi.spyOn(mockNear, "view").mockImplementation(async () => {
      callCount++
      return { count: callCount }
    })

    const { result } = renderHook(
      () =>
        useView({
          contractId: "counter.testnet",
          method: "get_count",
        }),
      { wrapper },
    )

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })
    expect(result.current.data).toEqual({ count: 1 })

    // Trigger refetch
    await act(async () => {
      await result.current.refetch()
    })

    expect(result.current.data).toEqual({ count: 2 })
  })
})

describe("useAccountExists", () => {
  let mockNear: Near
  let wrapper: ({ children }: { children: ReactNode }) => ReactNode

  beforeEach(() => {
    mockNear = new Near({ network: "testnet" })
    wrapper = ({ children }: { children: ReactNode }) => (
      <NearProvider near={mockNear}>{children}</NearProvider>
    )
  })

  it("returns true for existing account", async () => {
    vi.spyOn(mockNear, "accountExists").mockResolvedValue(true)

    const { result } = renderHook(
      () => useAccountExists({ accountId: "alice.testnet" }),
      { wrapper },
    )

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.data).toBe(true)
  })

  it("returns false for non-existing account", async () => {
    vi.spyOn(mockNear, "accountExists").mockResolvedValue(false)

    const { result } = renderHook(
      () => useAccountExists({ accountId: "nonexistent.testnet" }),
      { wrapper },
    )

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.data).toBe(false)
  })

  it("is disabled when accountId is undefined", async () => {
    const existsSpy = vi.spyOn(mockNear, "accountExists")

    const { result } = renderHook(
      () => useAccountExists({ accountId: undefined }),
      { wrapper },
    )

    expect(result.current.isLoading).toBe(false)
    expect(existsSpy).not.toHaveBeenCalled()
  })
})

describe("useBalance", () => {
  let mockNear: Near
  let wrapper: ({ children }: { children: ReactNode }) => ReactNode

  beforeEach(() => {
    mockNear = new Near({ network: "testnet" })
    wrapper = ({ children }: { children: ReactNode }) => (
      <NearProvider near={mockNear}>{children}</NearProvider>
    )
  })

  it("fetches balance for an account", async () => {
    vi.spyOn(mockNear, "getBalance").mockResolvedValue("100.5")

    const { result } = renderHook(
      () => useBalance({ accountId: "alice.testnet" }),
      { wrapper },
    )

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.data).toBe("100.5")
  })

  it("is disabled when accountId is undefined", async () => {
    const balanceSpy = vi.spyOn(mockNear, "getBalance")

    const { result } = renderHook(() => useBalance({ accountId: undefined }), {
      wrapper,
    })

    expect(result.current.isLoading).toBe(false)
    expect(balanceSpy).not.toHaveBeenCalled()
  })
})
