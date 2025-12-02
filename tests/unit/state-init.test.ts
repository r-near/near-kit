/**
 * Unit tests for NEP-616 StateInit utilities
 */

import { describe, expect, test } from "vitest"
import {
  createStateInit,
  deriveAccountId,
  isDeterministicAccountId,
  verifyDeterministicAccountId,
} from "../../src/utils/state-init.js"

describe("createStateInit", () => {
  test("should create StateInit with account ID reference", () => {
    const stateInit = createStateInit({
      code: { accountId: "publisher.near" },
    })

    expect(stateInit.code.type).toBe("accountId")
    expect(stateInit.code).toHaveProperty("accountId", "publisher.near")
    expect(stateInit.data).toBeInstanceOf(Map)
    expect(stateInit.data.size).toBe(0)
  })

  test("should create StateInit with code hash (Uint8Array)", () => {
    const hash = new Uint8Array(32).fill(0xab)

    const stateInit = createStateInit({
      code: { codeHash: hash },
    })

    expect(stateInit.code.type).toBe("codeHash")
    expect(stateInit.code).toHaveProperty("hash")
    if (stateInit.code.type === "codeHash") {
      expect(stateInit.code.hash).toEqual(hash)
    }
  })

  test("should create StateInit with code hash (base58 string)", () => {
    // Valid 32-byte base58 string
    const base58Hash = "11111111111111111111111111111111"

    const stateInit = createStateInit({
      code: { codeHash: base58Hash },
    })

    expect(stateInit.code.type).toBe("codeHash")
    expect(stateInit.code).toHaveProperty("hash")
  })

  test("should throw error for invalid base58 code hash", () => {
    const invalidBase58 = "invalid-base58-!@#$%"

    expect(() =>
      createStateInit({
        code: { codeHash: invalidBase58 },
      }),
    ).toThrow("Invalid base58 code hash")
  })

  test("should throw error for code hash with wrong length (Uint8Array)", () => {
    const wrongLengthHash = new Uint8Array(16).fill(0xab) // Only 16 bytes instead of 32

    expect(() =>
      createStateInit({
        code: { codeHash: wrongLengthHash },
      }),
    ).toThrow("Code hash must be 32 bytes, got 16 bytes")
  })

  test("should throw error for code hash with wrong length (base58)", () => {
    // A valid base58 string but only 16 bytes when decoded
    const shortBase58 = "111111111111111111111111"

    expect(() =>
      createStateInit({
        code: { codeHash: shortBase58 },
      }),
    ).toThrow("Code hash must be 32 bytes")
  })

  test("should create StateInit with initial data", () => {
    const data = new Map<Uint8Array, Uint8Array>()
    data.set(
      new TextEncoder().encode("key1"),
      new TextEncoder().encode("value1"),
    )
    data.set(
      new TextEncoder().encode("key2"),
      new TextEncoder().encode("value2"),
    )

    const stateInit = createStateInit({
      code: { accountId: "publisher.near" },
      data,
    })

    expect(stateInit.data).toBe(data)
    expect(stateInit.data.size).toBe(2)
  })
})

describe("deriveAccountId", () => {
  test("should derive deterministic account ID from account reference", () => {
    const accountId = deriveAccountId({
      code: { accountId: "publisher.near" },
    })

    expect(accountId).toMatch(/^0s[0-9a-f]{40}$/)
    expect(accountId.length).toBe(42)
    expect(isDeterministicAccountId(accountId)).toBe(true)
  })

  test("should derive deterministic account ID from code hash", () => {
    const hash = new Uint8Array(32).fill(0xcd)

    const accountId = deriveAccountId({
      code: { codeHash: hash },
    })

    expect(accountId).toMatch(/^0s[0-9a-f]{40}$/)
    expect(accountId.length).toBe(42)
    expect(isDeterministicAccountId(accountId)).toBe(true)
  })

  test("should derive different IDs for different inputs", () => {
    const id1 = deriveAccountId({
      code: { accountId: "publisher1.near" },
    })

    const id2 = deriveAccountId({
      code: { accountId: "publisher2.near" },
    })

    expect(id1).not.toBe(id2)
  })

  test("should derive different IDs when data differs", () => {
    const code = { accountId: "publisher.near" }

    const id1 = deriveAccountId({ code })

    const data = new Map<Uint8Array, Uint8Array>()
    data.set(new TextEncoder().encode("key"), new TextEncoder().encode("value"))

    const id2 = deriveAccountId({ code, data })

    expect(id1).not.toBe(id2)
  })

  test("should be deterministic - same input produces same output", () => {
    const options = {
      code: { accountId: "publisher.near" },
    }

    const id1 = deriveAccountId(options)
    const id2 = deriveAccountId(options)

    expect(id1).toBe(id2)
  })
})

describe("isDeterministicAccountId", () => {
  test("should return true for valid deterministic account IDs", () => {
    expect(
      isDeterministicAccountId("0s1234567890abcdef1234567890abcdef12345678"),
    ).toBe(true)
    expect(
      isDeterministicAccountId("0sabcdefabcdefabcdefabcdefabcdefabcdefabcd"),
    ).toBe(true)
  })

  test("should return false for non-deterministic account IDs", () => {
    expect(isDeterministicAccountId("alice.near")).toBe(false)
    expect(isDeterministicAccountId("test.testnet")).toBe(false)
    expect(
      isDeterministicAccountId("0x1234567890abcdef1234567890abcdef12345678"),
    ).toBe(false) // Ethereum-style
  })

  test("should return false for malformed deterministic IDs", () => {
    expect(isDeterministicAccountId("0s123")).toBe(false) // Too short
    expect(
      isDeterministicAccountId(
        "0s1234567890abcdef1234567890abcdef12345678extra",
      ),
    ).toBe(false) // Too long
    expect(
      isDeterministicAccountId("0s1234567890ABCDEF1234567890ABCDEF12345678"),
    ).toBe(false) // Uppercase
    expect(
      isDeterministicAccountId("1s1234567890abcdef1234567890abcdef12345678"),
    ).toBe(false) // Wrong prefix
  })
})

describe("verifyDeterministicAccountId", () => {
  test("should verify that account ID matches expected derivation", () => {
    const options = {
      code: { accountId: "publisher.near" },
    }

    const derivedId = deriveAccountId(options)

    expect(verifyDeterministicAccountId(derivedId, options)).toBe(true)
    expect(
      verifyDeterministicAccountId(
        "0s0000000000000000000000000000000000000000",
        options,
      ),
    ).toBe(false)
  })

  test("should verify with data included", () => {
    const data = new Map<Uint8Array, Uint8Array>()
    data.set(new TextEncoder().encode("key"), new TextEncoder().encode("value"))

    const options = {
      code: { accountId: "publisher.near" },
      data,
    }

    const derivedId = deriveAccountId(options)

    expect(verifyDeterministicAccountId(derivedId, options)).toBe(true)

    // Should fail with different data
    const optionsWithoutData = {
      code: { accountId: "publisher.near" },
    }

    expect(verifyDeterministicAccountId(derivedId, optionsWithoutData)).toBe(
      false,
    )
  })
})
