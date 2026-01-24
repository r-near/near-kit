/**
 * Tests for edge cases and branch coverage
 * Imports from index.ts to ensure that file is covered
 */
import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

// Import from index.ts to cover that file
import {
  NearProvider,
  useAccountExists,
  useBalance,
  useCall,
  useSend,
  useView,
} from "../src/index.js"

// Create mock functions at module level
const mockView = vi.fn()
const mockGetBalance = vi.fn()
const mockAccountExists = vi.fn()
const mockCall = vi.fn()
const mockSend = vi.fn()

interface MockNearInstance {
  view: typeof mockView
  call: typeof mockCall
  send: typeof mockSend
  contract: ReturnType<typeof vi.fn>
  getBalance: typeof mockGetBalance
  accountExists: typeof mockAccountExists
}

vi.mock("near-kit", () => {
  return {
    Near: vi.fn().mockImplementation(function (this: MockNearInstance) {
      this.view = mockView
      this.call = mockCall
      this.send = mockSend
      this.contract = vi.fn()
      this.getBalance = mockGetBalance
      this.accountExists = mockAccountExists
    }),
  }
})

const wrapper = ({ children }: { children: ReactNode }) => (
  <NearProvider config={{ network: "testnet" }}>{children}</NearProvider>
)

describe("stale request handling", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("useView stale error handling", () => {
    it("ignores stale error responses", async () => {
      let rejectFirst: ((error: Error) => void) | undefined
      let resolveSecond: ((value: number) => void) | undefined

      mockView
        .mockImplementationOnce(
          () =>
            new Promise<number>((_, reject) => {
              rejectFirst = reject
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

      // Resolve second first
      if (resolveSecond) resolveSecond(200)

      await waitFor(() => {
        expect(result.current.data).toBe(200)
      })

      // Now reject first (stale) - should be ignored
      if (rejectFirst) rejectFirst(new Error("Stale error"))

      // Should still show second result, no error
      await waitFor(() => {
        expect(result.current.data).toBe(200)
        expect(result.current.error).toBeUndefined()
      })
    })

    it("handles non-Error thrown values", async () => {
      mockView.mockRejectedValue("string error")

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

      expect(result.current.error).toBeInstanceOf(Error)
      expect(result.current.error?.message).toBe("string error")
    })
  })

  describe("useBalance stale handling", () => {
    it("ignores stale success responses", async () => {
      let resolveFirst: ((value: string) => void) | undefined
      let resolveSecond: ((value: string) => void) | undefined

      mockGetBalance
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

      const { result, rerender } = renderHook(
        ({ accountId }) => useBalance({ accountId }),
        { wrapper, initialProps: { accountId: "alice.testnet" } },
      )

      // First request starts
      expect(result.current.isLoading).toBe(true)

      // Second request starts (accountId change)
      rerender({ accountId: "bob.testnet" })

      // Resolve second first
      if (resolveSecond) resolveSecond("20 NEAR")

      await waitFor(() => {
        expect(result.current.data).toBe("20 NEAR")
      })

      // Now resolve first (stale)
      if (resolveFirst) resolveFirst("10 NEAR")

      // Should still show second result
      await waitFor(() => {
        expect(result.current.data).toBe("20 NEAR")
      })
    })

    it("ignores stale error responses", async () => {
      let rejectFirst: ((error: Error) => void) | undefined
      let resolveSecond: ((value: string) => void) | undefined

      mockGetBalance
        .mockImplementationOnce(
          () =>
            new Promise<string>((_, reject) => {
              rejectFirst = reject
            }),
        )
        .mockImplementationOnce(
          () =>
            new Promise<string>((resolve) => {
              resolveSecond = resolve
            }),
        )

      const { result, rerender } = renderHook(
        ({ accountId }) => useBalance({ accountId }),
        { wrapper, initialProps: { accountId: "alice.testnet" } },
      )

      // Second request starts
      rerender({ accountId: "bob.testnet" })

      // Resolve second first
      if (resolveSecond) resolveSecond("20 NEAR")

      await waitFor(() => {
        expect(result.current.data).toBe("20 NEAR")
      })

      // Now reject first (stale)
      if (rejectFirst) rejectFirst(new Error("Stale error"))

      // Should still show second result, no error
      expect(result.current.data).toBe("20 NEAR")
      expect(result.current.error).toBeUndefined()
    })

    it("handles non-Error thrown values", async () => {
      mockGetBalance.mockRejectedValue({ code: 500 })

      const { result } = renderHook(
        () => useBalance({ accountId: "alice.testnet" }),
        { wrapper },
      )

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.error).toBeInstanceOf(Error)
      expect(result.current.error?.message).toBe("[object Object]")
    })
  })

  describe("useAccountExists stale handling", () => {
    it("ignores stale success responses", async () => {
      let resolveFirst: ((value: boolean) => void) | undefined
      let resolveSecond: ((value: boolean) => void) | undefined

      mockAccountExists
        .mockImplementationOnce(
          () =>
            new Promise<boolean>((resolve) => {
              resolveFirst = resolve
            }),
        )
        .mockImplementationOnce(
          () =>
            new Promise<boolean>((resolve) => {
              resolveSecond = resolve
            }),
        )

      const { result, rerender } = renderHook(
        ({ accountId }) => useAccountExists({ accountId }),
        { wrapper, initialProps: { accountId: "alice.testnet" } },
      )

      // Second request starts
      rerender({ accountId: "bob.testnet" })

      // Resolve second first
      if (resolveSecond) resolveSecond(false)

      await waitFor(() => {
        expect(result.current.data).toBe(false)
      })

      // Now resolve first (stale)
      if (resolveFirst) resolveFirst(true)

      // Should still show second result
      expect(result.current.data).toBe(false)
    })

    it("ignores stale error responses", async () => {
      let rejectFirst: ((error: Error) => void) | undefined
      let resolveSecond: ((value: boolean) => void) | undefined

      mockAccountExists
        .mockImplementationOnce(
          () =>
            new Promise<boolean>((_, reject) => {
              rejectFirst = reject
            }),
        )
        .mockImplementationOnce(
          () =>
            new Promise<boolean>((resolve) => {
              resolveSecond = resolve
            }),
        )

      const { result, rerender } = renderHook(
        ({ accountId }) => useAccountExists({ accountId }),
        { wrapper, initialProps: { accountId: "alice.testnet" } },
      )

      // Second request starts
      rerender({ accountId: "bob.testnet" })

      // Resolve second first
      if (resolveSecond) resolveSecond(true)

      await waitFor(() => {
        expect(result.current.data).toBe(true)
      })

      // Now reject first (stale)
      if (rejectFirst) rejectFirst(new Error("Stale error"))

      // Should still show second result, no error
      expect(result.current.data).toBe(true)
      expect(result.current.error).toBeUndefined()
    })

    it("handles non-Error thrown values", async () => {
      mockAccountExists.mockRejectedValue(42)

      const { result } = renderHook(
        () => useAccountExists({ accountId: "alice.testnet" }),
        { wrapper },
      )

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.error).toBeInstanceOf(Error)
      expect(result.current.error?.message).toBe("42")
    })
  })
})

describe("mutation stale handling", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("useCall stale error handling", () => {
    it("ignores stale error responses", async () => {
      let rejectFirst: ((error: Error) => void) | undefined
      let resolveSecond: ((value: string) => void) | undefined

      mockCall
        .mockImplementationOnce(
          () =>
            new Promise<string>((_, reject) => {
              rejectFirst = reject
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
        result.current.mutate({}).catch(() => {
          // Ignore expected rejection
        })
      })

      // Start second mutation
      act(() => {
        result.current.mutate({})
      })

      // Resolve second first
      await act(async () => {
        if (resolveSecond) resolveSecond("success")
      })

      expect(result.current.data).toBe("success")
      expect(result.current.isSuccess).toBe(true)

      // Now reject first (stale)
      await act(async () => {
        if (rejectFirst) rejectFirst(new Error("Stale error"))
      })

      // Should still show success, not error
      expect(result.current.data).toBe("success")
      expect(result.current.isSuccess).toBe(true)
      expect(result.current.isError).toBe(false)
    })

    it("handles non-Error thrown values", async () => {
      mockCall.mockRejectedValue({ status: "failed" })

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

      expect(result.current.error).toBeInstanceOf(Error)
      expect(result.current.error?.message).toBe("[object Object]")
    })
  })

  describe("useSend stale handling", () => {
    it("ignores stale success responses", async () => {
      let resolveFirst: (() => void) | undefined
      let resolveSecond: (() => void) | undefined

      mockSend
        .mockImplementationOnce(
          () =>
            new Promise<void>((resolve) => {
              resolveFirst = resolve
            }),
        )
        .mockImplementationOnce(
          () =>
            new Promise<void>((resolve) => {
              resolveSecond = resolve
            }),
        )

      const { result } = renderHook(() => useSend(), { wrapper })

      // Start first send
      act(() => {
        result.current.mutate("alice.testnet", "1 NEAR")
      })

      // Start second send
      act(() => {
        result.current.mutate("bob.testnet", "2 NEAR")
      })

      expect(result.current.isPending).toBe(true)

      // Resolve second first
      await act(async () => {
        if (resolveSecond) resolveSecond()
      })

      expect(result.current.isSuccess).toBe(true)

      // Now resolve first (stale)
      await act(async () => {
        if (resolveFirst) resolveFirst()
      })

      // Should still show success
      expect(result.current.isSuccess).toBe(true)
    })

    it("ignores stale error responses", async () => {
      let rejectFirst: ((error: Error) => void) | undefined
      let resolveSecond: (() => void) | undefined

      mockSend
        .mockImplementationOnce(
          () =>
            new Promise<void>((_, reject) => {
              rejectFirst = reject
            }),
        )
        .mockImplementationOnce(
          () =>
            new Promise<void>((resolve) => {
              resolveSecond = resolve
            }),
        )

      const { result } = renderHook(() => useSend(), { wrapper })

      // Start first send
      act(() => {
        result.current.mutate("alice.testnet", "1 NEAR").catch(() => {
          // Expected
        })
      })

      // Start second send
      act(() => {
        result.current.mutate("bob.testnet", "2 NEAR")
      })

      // Resolve second first
      await act(async () => {
        if (resolveSecond) resolveSecond()
      })

      expect(result.current.isSuccess).toBe(true)
      expect(result.current.isError).toBe(false)

      // Now reject first (stale)
      await act(async () => {
        if (rejectFirst) rejectFirst(new Error("Stale error"))
      })

      // Should still show success, not error
      expect(result.current.isSuccess).toBe(true)
      expect(result.current.isError).toBe(false)
    })

    it("handles non-Error thrown values", async () => {
      mockSend.mockRejectedValue(null)

      const { result } = renderHook(() => useSend(), { wrapper })

      await act(async () => {
        try {
          await result.current.mutate("bob.testnet", "1 NEAR")
        } catch {
          // Expected
        }
      })

      expect(result.current.error).toBeInstanceOf(Error)
      expect(result.current.error?.message).toBe("null")
    })
  })
})
