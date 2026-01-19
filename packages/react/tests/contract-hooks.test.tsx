/**
 * Tests for typed contract hooks (useContract, useContractView)
 */

import { act, renderHook, waitFor } from "@testing-library/react"
import { type Contract, Near } from "near-kit"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useContract, useContractView } from "../src/contract-hooks.js"
import { NearProvider } from "../src/provider.js"

// Define a test contract type
type TestContract = Contract<{
  view: {
    get_count: () => Promise<number>
    get_balance: (args: { account_id: string }) => Promise<string>
  }
  call: {
    increment: () => Promise<void>
    set_count: (args: { count: number }) => Promise<void>
  }
}>

describe("useContract", () => {
  let mockNear: Near
  let wrapper: ({ children }: { children: ReactNode }) => ReactNode

  beforeEach(() => {
    mockNear = new Near({ network: "testnet" })
    wrapper = ({ children }: { children: ReactNode }) => (
      <NearProvider near={mockNear}>{children}</NearProvider>
    )
  })

  it("returns a contract instance", () => {
    const { result } = renderHook(
      () => useContract<TestContract>("counter.testnet"),
      { wrapper },
    )

    expect(result.current).toBeDefined()
    expect(result.current.view).toBeDefined()
    expect(result.current.call).toBeDefined()
  })

  it("contract view methods work", async () => {
    vi.spyOn(mockNear, "view").mockResolvedValue(42)

    const { result } = renderHook(
      () => useContract<TestContract>("counter.testnet"),
      { wrapper },
    )

    const count = await result.current.view.get_count()
    expect(count).toBe(42)
    expect(mockNear.view).toHaveBeenCalledWith(
      "counter.testnet",
      "get_count",
      {},
      undefined,
    )
  })
})

describe("useContractView", () => {
  let mockNear: Near
  let wrapper: ({ children }: { children: ReactNode }) => ReactNode

  beforeEach(() => {
    mockNear = new Near({ network: "testnet" })
    wrapper = ({ children }: { children: ReactNode }) => (
      <NearProvider near={mockNear}>{children}</NearProvider>
    )
  })

  it("fetches data using typed view method", async () => {
    vi.spyOn(mockNear, "view").mockResolvedValue("100")

    // Use a simplified test approach
    const contract = mockNear.contract<TestContract>("token.testnet")

    const { result } = renderHook(
      () =>
        useContractView(contract.view.get_balance, {
          args: { account_id: "alice.testnet" },
        }),
      { wrapper },
    )

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.data).toBe("100")
  })

  it("supports enabled flag", async () => {
    const viewSpy = vi.spyOn(mockNear, "view").mockResolvedValue("100")

    const contract = mockNear.contract<TestContract>("token.testnet")

    const { result } = renderHook(
      () =>
        useContractView(contract.view.get_balance, {
          args: { account_id: "alice.testnet" },
          enabled: false,
        }),
      { wrapper },
    )

    expect(result.current.isLoading).toBe(false)
    expect(viewSpy).not.toHaveBeenCalled()
  })

  it("supports refetch", async () => {
    let callCount = 0
    vi.spyOn(mockNear, "view").mockImplementation(async () => {
      callCount++
      return String(callCount * 100)
    })

    // Create stable function reference outside of render
    const contract = mockNear.contract<TestContract>("token.testnet")
    const viewFn = contract.view.get_balance
    const args = { account_id: "alice.testnet" }

    const { result } = renderHook(() => useContractView(viewFn, { args }), {
      wrapper,
    })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.data).toBe("100")

    await act(async () => {
      await result.current.refetch()
    })

    expect(result.current.data).toBe("200")
  })
})
