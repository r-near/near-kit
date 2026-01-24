import { renderHook } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"
import { NearProvider, useNear } from "../src/provider.js"

interface MockNearInstance {
  config: unknown
  view: ReturnType<typeof vi.fn>
  call: ReturnType<typeof vi.fn>
  send: ReturnType<typeof vi.fn>
  contract: ReturnType<typeof vi.fn>
}

// Mock the Near class using a function factory
vi.mock("near-kit", () => {
  return {
    Near: vi.fn().mockImplementation(function (
      this: MockNearInstance,
      config: unknown,
    ) {
      this.config = config
      this.view = vi.fn()
      this.call = vi.fn()
      this.send = vi.fn()
      this.contract = vi.fn()
    }),
  }
})

describe("NearProvider", () => {
  it("provides Near instance from config", () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <NearProvider config={{ network: "testnet" }}>{children}</NearProvider>
    )

    const { result } = renderHook(() => useNear(), { wrapper })

    expect(result.current).toBeDefined()
    expect(result.current.view).toBeDefined()
    expect(result.current.call).toBeDefined()
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
