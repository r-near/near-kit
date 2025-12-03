/**
 * Unit tests for Near.view() method handling empty responses
 *
 * Tests the specific code path where a contract returns an empty string,
 * which should result in `undefined` being returned.
 */

import { describe, expect, test, vi } from "vitest"
import { Near } from "../../src/core/near.js"
import { RpcClient } from "../../src/core/rpc/rpc.js"

describe("Near.view() - Empty Response Handling", () => {
  test("should return undefined when contract returns empty string", async () => {
    // Create a Near instance
    const near = new Near({ network: "testnet" })

    // Mock the RPC client's viewFunction to return empty result
    const mockViewFunction = vi
      .spyOn(RpcClient.prototype, "viewFunction")
      .mockResolvedValue({
        result: [], // Empty byte array
        logs: [],
        block_height: 123456,
        block_hash: "test-hash",
      })

    // Call view method - should return undefined for empty response
    const result = await near.view("contract.near", "empty_method", {})

    expect(result).toBeUndefined()
    expect(mockViewFunction).toHaveBeenCalledWith(
      "contract.near",
      "empty_method",
      {},
      undefined,
    )

    mockViewFunction.mockRestore()
  })

  test("should parse JSON when contract returns valid JSON", async () => {
    const near = new Near({ network: "testnet" })

    const jsonData = { count: 42, message: "Hello" }
    const jsonBytes = new TextEncoder().encode(JSON.stringify(jsonData))

    const mockViewFunction = vi
      .spyOn(RpcClient.prototype, "viewFunction")
      .mockResolvedValue({
        result: Array.from(jsonBytes),
        logs: [],
        block_height: 123456,
        block_hash: "test-hash",
      })

    const result = await near.view<{ count: number; message: string }>(
      "contract.near",
      "get_data",
      {},
    )

    expect(result).toEqual(jsonData)
    expect(result?.count).toBe(42)
    expect(result?.message).toBe("Hello")

    mockViewFunction.mockRestore()
  })

  test("should return string as-is when contract returns non-JSON string", async () => {
    const near = new Near({ network: "testnet" })

    const plainText = "Hello World"
    const textBytes = new TextEncoder().encode(plainText)

    const mockViewFunction = vi
      .spyOn(RpcClient.prototype, "viewFunction")
      .mockResolvedValue({
        result: Array.from(textBytes),
        logs: [],
        block_height: 123456,
        block_hash: "test-hash",
      })

    const result = await near.view<string>("contract.near", "get_text", {})

    expect(result).toBe(plainText)

    mockViewFunction.mockRestore()
  })

  test("should handle zero-length result array", async () => {
    const near = new Near({ network: "testnet" })

    const mockViewFunction = vi
      .spyOn(RpcClient.prototype, "viewFunction")
      .mockResolvedValue({
        result: [],
        logs: [],
        block_height: 123456,
        block_hash: "test-hash",
      })

    const result = await near.view("contract.near", "void_method", {})

    expect(result).toBeUndefined()

    mockViewFunction.mockRestore()
  })

  test("should return number when contract returns JSON number", async () => {
    const near = new Near({ network: "testnet" })

    const number = 12345
    const numberBytes = new TextEncoder().encode(JSON.stringify(number))

    const mockViewFunction = vi
      .spyOn(RpcClient.prototype, "viewFunction")
      .mockResolvedValue({
        result: Array.from(numberBytes),
        logs: [],
        block_height: 123456,
        block_hash: "test-hash",
      })

    const result = await near.view<number>("contract.near", "get_count", {})

    expect(result).toBe(number)
    expect(typeof result).toBe("number")

    mockViewFunction.mockRestore()
  })

  test("should return null when contract explicitly returns JSON null", async () => {
    const near = new Near({ network: "testnet" })

    const nullBytes = new TextEncoder().encode("null")

    const mockViewFunction = vi
      .spyOn(RpcClient.prototype, "viewFunction")
      .mockResolvedValue({
        result: Array.from(nullBytes),
        logs: [],
        block_height: 123456,
        block_hash: "test-hash",
      })

    const result = await near.view<null>("contract.near", "get_null", {})

    expect(result).toBeNull()

    mockViewFunction.mockRestore()
  })

  test("should distinguish between undefined (empty) and null (explicit JSON null)", async () => {
    const near = new Near({ network: "testnet" })

    // Test empty response -> undefined
    const mockEmpty = vi
      .spyOn(RpcClient.prototype, "viewFunction")
      .mockResolvedValue({
        result: [],
        logs: [],
        block_height: 123456,
        block_hash: "test-hash",
      })

    const emptyResult = await near.view("contract.near", "empty", {})
    expect(emptyResult).toBeUndefined()

    mockEmpty.mockRestore()

    // Test null response -> null
    const mockNull = vi
      .spyOn(RpcClient.prototype, "viewFunction")
      .mockResolvedValue({
        result: Array.from(new TextEncoder().encode("null")),
        logs: [],
        block_height: 123456,
        block_hash: "test-hash",
      })

    const nullResult = await near.view("contract.near", "get_null", {})
    expect(nullResult).toBeNull()

    mockNull.mockRestore()
  })
})
