import { renderHook } from "@testing-library/react"
import type { Near } from "near-kit"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"
import { useContract } from "../src/contract.js"
import { NearProvider } from "../src/provider.js"

// Mock contract type for testing
interface MockContractMethods {
  view: {
    get_balance: (args: { account_id: string }) => Promise<string>
  }
  call: {
    transfer: (args: { to: string; amount: string }) => Promise<void>
  }
}

// Mock contract proxy returned by near.contract()
interface MockContractProxy {
  view: {
    get_balance: (args: { account_id: string }) => Promise<string>
  }
  call: {
    transfer: (args: { to: string; amount: string }) => Promise<void>
  }
}

describe("useContract", () => {
  it("should return a typed contract from near.contract()", () => {
    const mockContract: MockContractProxy = {
      view: {
        get_balance: vi.fn().mockResolvedValue("100"),
      },
      call: {
        transfer: vi.fn().mockResolvedValue(undefined),
      },
    }

    const mockNear = {
      contract: vi.fn().mockReturnValue(mockContract),
    }

    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <NearProvider near={mockNear as unknown as Near}>
          {children}
        </NearProvider>
      )
    }

    const { result } = renderHook(
      () => useContract<MockContractMethods>("token.near"),
      { wrapper: Wrapper },
    )

    expect(mockNear.contract).toHaveBeenCalledWith("token.near")
    expect(result.current).toBe(mockContract)
  })

  it("should call view methods on the contract", async () => {
    const mockViewFn = vi.fn().mockResolvedValue("500")
    const mockContract: MockContractProxy = {
      view: {
        get_balance: mockViewFn,
      },
      call: {
        transfer: vi.fn(),
      },
    }

    const mockNear = {
      contract: vi.fn().mockReturnValue(mockContract),
    }

    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <NearProvider near={mockNear as unknown as Near}>
          {children}
        </NearProvider>
      )
    }

    const { result } = renderHook(
      () => useContract<MockContractMethods>("token.near"),
      { wrapper: Wrapper },
    )

    const balance = await result.current.view.get_balance({
      account_id: "alice.near",
    })

    expect(mockViewFn).toHaveBeenCalledWith({ account_id: "alice.near" })
    expect(balance).toBe("500")
  })

  it("should call change methods on the contract", async () => {
    const mockCallFn = vi.fn().mockResolvedValue(undefined)
    const mockContract: MockContractProxy = {
      view: {
        get_balance: vi.fn(),
      },
      call: {
        transfer: mockCallFn,
      },
    }

    const mockNear = {
      contract: vi.fn().mockReturnValue(mockContract),
    }

    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <NearProvider near={mockNear as unknown as Near}>
          {children}
        </NearProvider>
      )
    }

    const { result } = renderHook(
      () => useContract<MockContractMethods>("token.near"),
      { wrapper: Wrapper },
    )

    await result.current.call.transfer({ to: "bob.near", amount: "100" })

    expect(mockCallFn).toHaveBeenCalledWith({ to: "bob.near", amount: "100" })
  })

  it("should return new contract instance when contractId changes", () => {
    const mockContract1 = { view: {}, call: {} }
    const mockContract2 = { view: {}, call: {} }

    const contractFn = vi
      .fn()
      .mockReturnValueOnce(mockContract1)
      .mockReturnValueOnce(mockContract2)

    const mockNear = {
      contract: contractFn,
    }

    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <NearProvider near={mockNear as unknown as Near}>
          {children}
        </NearProvider>
      )
    }

    const { result, rerender } = renderHook(
      ({ contractId }) => useContract(contractId),
      { wrapper: Wrapper, initialProps: { contractId: "token1.near" } },
    )

    expect(result.current).toBe(mockContract1)
    expect(contractFn).toHaveBeenCalledWith("token1.near")

    rerender({ contractId: "token2.near" })

    expect(result.current).toBe(mockContract2)
    expect(contractFn).toHaveBeenCalledWith("token2.near")
  })
})
