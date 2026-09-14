/**
 * Unit tests for NEP-616 StateInit utilities
 */

import { keccak_256 } from "@noble/hashes/sha3.js"
import { hex } from "@scure/base"
import { describe, expect, test } from "vitest"
import {
  createStateInit,
  deriveAccountId,
  isDeterministicAccountId,
  serializeStateInit,
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

  test("should derive same ID regardless of map insertion order", () => {
    const code = { accountId: "publisher.near" }

    // Create first map with keys inserted in one order
    const data1 = new Map<Uint8Array, Uint8Array>()
    data1.set(new TextEncoder().encode("zzz"), new TextEncoder().encode("last"))
    data1.set(
      new TextEncoder().encode("aaa"),
      new TextEncoder().encode("first"),
    )
    data1.set(
      new TextEncoder().encode("mmm"),
      new TextEncoder().encode("middle"),
    )

    // Create second map with keys inserted in different order
    const data2 = new Map<Uint8Array, Uint8Array>()
    data2.set(
      new TextEncoder().encode("aaa"),
      new TextEncoder().encode("first"),
    )
    data2.set(
      new TextEncoder().encode("mmm"),
      new TextEncoder().encode("middle"),
    )
    data2.set(new TextEncoder().encode("zzz"), new TextEncoder().encode("last"))

    const id1 = deriveAccountId({ code, data: data1 })
    const id2 = deriveAccountId({ code, data: data2 })

    // Both should produce the same account ID despite different insertion order
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

describe("serializeStateInit canonical data ordering", () => {
  const encoder = new TextEncoder()
  const code = { accountId: "publisher.near" }
  const zetaFirst = () =>
    new Map([
      [encoder.encode("zeta"), encoder.encode("1")],
      [encoder.encode("alpha"), encoder.encode("2")],
    ])
  const alphaFirst = () =>
    new Map([
      [encoder.encode("alpha"), encoder.encode("2")],
      [encoder.encode("zeta"), encoder.encode("1")],
    ])
  // Hand-built canonical encoding: StateInit::V1 (0x00),
  // GlobalContractIdentifier::AccountId (0x01) + "publisher.near", then the
  // BTreeMap: entry count, and each length-prefixed key and value, with the
  // entries sorted bytewise by key ("alpha" before "zeta").
  const canonicalHex = [
    "00",
    "01",
    "0e000000",
    hex.encode(encoder.encode("publisher.near")),
    "02000000",
    "05000000",
    hex.encode(encoder.encode("alpha")),
    "01000000",
    hex.encode(encoder.encode("2")),
    "04000000",
    hex.encode(encoder.encode("zeta")),
    "01000000",
    hex.encode(encoder.encode("1")),
  ].join("")

  test("encodes data as a BTreeMap sorted bytewise by key, regardless of insertion order", () => {
    expect(
      hex.encode(
        serializeStateInit(createStateInit({ code, data: zetaFirst() })),
      ),
    ).toBe(canonicalHex)
    expect(
      hex.encode(
        serializeStateInit(createStateInit({ code, data: alphaFirst() })),
      ),
    ).toBe(canonicalHex)
  })

  test("orders keys by byte value, not by their decimal digits", () => {
    // As decimal strings "10" sorts before "2"; as bytes 0x02 sorts before 0x0a
    const data = new Map([
      [new Uint8Array([10]), encoder.encode("b")],
      [new Uint8Array([2]), encoder.encode("a")],
    ])

    const serialized = hex.encode(
      serializeStateInit(createStateInit({ code, data })),
    )

    expect(
      serialized.endsWith("0200000001000000020100000061010000000a0100000062"),
    ).toBe(true)
  })

  test("derives the account ID nearcore expects for a multi-entry map", () => {
    const expected = `0s${hex.encode(keccak_256(hex.decode(canonicalHex)).slice(12))}`

    expect(expected).toBe("0sdc62d9abe65f3ea3e17df718a8842d5677229988")
    expect(deriveAccountId({ code, data: zetaFirst() })).toBe(expected)
    expect(deriveAccountId({ code, data: alphaFirst() })).toBe(expected)
  })

  test("rejects two keys with identical bytes", () => {
    const data = new Map([
      [encoder.encode("key"), encoder.encode("1")],
      [encoder.encode("key"), encoder.encode("2")],
    ])

    expect(() => deriveAccountId({ code, data })).toThrow(/compare equal/)
  })
})
