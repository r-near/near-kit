import { act, renderHook, waitFor } from "@testing-library/react"
import { Near } from "near-kit"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useAccount } from "../src/account.js"
import { NearProvider } from "../src/provider.js"

// Mock wallet interface
interface MockWallet {
  getAccounts: () => Promise<Array<{ accountId: string }>>
}

// Use a real client with a supported wallet adapter, not private Near fields.
function createMockNear(wallet?: MockWallet, defaultSignerId?: string): Near {
  return new Near({
    defaultSignerId,
    ...(wallet
      ? {
          wallet: {
            getAccounts: () => wallet.getAccounts(),
            signAndSendTransaction: async () => {
              throw new Error("Account reads cannot submit transactions")
            },
          },
        }
      : {}),
  })
}
function createWrapper(near: Near) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <NearProvider near={near}>{children}</NearProvider>
  }
}

describe("useAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("should start in loading state and finish loading", async () => {
    const mockNear = createMockNear()
    const wrapper = createWrapper(mockNear)

    const { result } = renderHook(() => useAccount(), { wrapper })

    // The hook should eventually finish loading
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.isConnected).toBe(false)
    expect(result.current.accountId).toBeUndefined()
  })

  it("should detect account from wallet connection", async () => {
    const mockWallet: MockWallet = {
      getAccounts: vi.fn().mockResolvedValue([{ accountId: "alice.near" }]),
    }
    const mockNear = createMockNear(mockWallet)
    const wrapper = createWrapper(mockNear)

    const { result } = renderHook(() => useAccount(), { wrapper })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.accountId).toBe("alice.near")
    expect(result.current.isConnected).toBe(true)
    expect(mockWallet.getAccounts).toHaveBeenCalled()
  })

  it("should detect account from defaultSignerId when no wallet", async () => {
    const mockNear = createMockNear(undefined, "bob.near")
    const wrapper = createWrapper(mockNear)

    const { result } = renderHook(() => useAccount(), { wrapper })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.accountId).toBe("bob.near")
    expect(result.current.isConnected).toBe(true)
  })

  it("should prefer wallet over defaultSignerId", async () => {
    const mockWallet: MockWallet = {
      getAccounts: vi
        .fn()
        .mockResolvedValue([{ accountId: "wallet-account.near" }]),
    }
    const mockNear = createMockNear(mockWallet, "default-account.near")
    const wrapper = createWrapper(mockNear)

    const { result } = renderHook(() => useAccount(), { wrapper })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.accountId).toBe("wallet-account.near")
    expect(result.current.isConnected).toBe(true)
  })

  it("should handle wallet with no accounts", async () => {
    const mockWallet: MockWallet = {
      getAccounts: vi.fn().mockResolvedValue([]),
    }
    const mockNear = createMockNear(mockWallet)
    const wrapper = createWrapper(mockNear)

    const { result } = renderHook(() => useAccount(), { wrapper })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.accountId).toBeUndefined()
    expect(result.current.isConnected).toBe(false)
  })

  it("should handle wallet.getAccounts error gracefully", async () => {
    const mockWallet: MockWallet = {
      getAccounts: vi.fn().mockRejectedValue(new Error("Wallet error")),
    }
    const mockNear = createMockNear(mockWallet)
    const wrapper = createWrapper(mockNear)

    const { result } = renderHook(() => useAccount(), { wrapper })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.accountId).toBeUndefined()
    expect(result.current.isConnected).toBe(false)
  })

  it("should support refetch function", async () => {
    let callCount = 0
    const mockWallet: MockWallet = {
      getAccounts: vi.fn().mockImplementation(async () => {
        callCount++
        if (callCount === 1) {
          return []
        }
        return [{ accountId: "new-account.near" }]
      }),
    }
    const mockNear = createMockNear(mockWallet)
    const wrapper = createWrapper(mockNear)

    const { result } = renderHook(() => useAccount(), { wrapper })

    // Wait for initial fetch (no account)
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })
    expect(result.current.isConnected).toBe(false)

    // Trigger refetch
    await act(async () => {
      await result.current.refetch()
    })

    // Should now have account
    expect(result.current.accountId).toBe("new-account.near")
    expect(result.current.isConnected).toBe(true)
  })

  it("should return not connected when no wallet and no defaultSignerId", async () => {
    const mockNear = createMockNear()
    const wrapper = createWrapper(mockNear)

    const { result } = renderHook(() => useAccount(), { wrapper })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.accountId).toBeUndefined()
    expect(result.current.isConnected).toBe(false)
  })
})
