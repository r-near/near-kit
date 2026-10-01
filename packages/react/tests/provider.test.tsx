import { renderHook } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"
import { NearProvider, useNear } from "../src/provider.js"

describe("NearProvider", () => {
  it("provides Near instance from config", () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <NearProvider config={{ network: "testnet" }}>{children}</NearProvider>
    )

    const { result } = renderHook(() => useNear(), { wrapper })

    expect(result.current).toBeDefined()
    expect(result.current).toHaveProperty("view", expect.any(Function))
    expect(result.current).toHaveProperty("call", expect.any(Function))
  })

  it("provides existing Near instance", () => {
    const mockNear = {
      view: vi.fn(),
      call: vi.fn(),
      send: vi.fn(),
      contract: vi.fn(),
    }

    const wrapper = ({ children }: { children: ReactNode }) => (
      // @ts-expect-error - mock Near instance for testing
      <NearProvider near={mockNear}>{children}</NearProvider>
    )

    const { result } = renderHook(() => useNear(), { wrapper })

    expect(result.current).toBe(mockNear)
  })

  it("throws error when nested", () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <NearProvider config={{ network: "testnet" }}>
        <NearProvider config={{ network: "mainnet" }}>{children}</NearProvider>
      </NearProvider>
    )

    expect(() => renderHook(() => useNear(), { wrapper })).toThrow(
      /Nested <NearProvider> detected/,
    )
  })
})

describe("useNear", () => {
  it("throws error when used outside provider", () => {
    expect(() => renderHook(() => useNear())).toThrow(
      /useNear must be used within a <NearProvider>/,
    )
  })
})
