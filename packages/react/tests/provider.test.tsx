/**
 * Tests for NearProvider and useNear hook
 */

import { renderHook } from "@testing-library/react"
import { Near } from "near-kit"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"
import { NearProvider, useNear } from "../src/provider.js"

describe("NearProvider", () => {
  it("provides a Near instance from config", () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <NearProvider config={{ network: "testnet" }}>{children}</NearProvider>
    )

    const { result } = renderHook(() => useNear(), { wrapper })
    expect(result.current).toBeInstanceOf(Near)
  })

  it("provides an existing Near instance", () => {
    const near = new Near({ network: "testnet" })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <NearProvider near={near}>{children}</NearProvider>
    )

    const { result } = renderHook(() => useNear(), { wrapper })
    expect(result.current).toBe(near)
  })

  it("throws when useNear is called outside provider", () => {
    // Suppress console.error for expected error
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    expect(() => {
      renderHook(() => useNear())
    }).toThrow("useNear must be used within a NearProvider")

    consoleSpy.mockRestore()
  })
})
