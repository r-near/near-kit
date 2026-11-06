import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { deterministicAccountId, type StateInit } from "../src/address.js"
import { parseHash } from "../src/data.js"
import { encodeStateInit } from "../src/internal/state-init.js"

const fixtures = JSON.parse(
  readFileSync(new URL("./fixtures/address.json", import.meta.url), "utf8"),
) as Array<{
  name: string
  code: StateInit["code"]
  codeBytes?: string
  data: Array<[string, string]>
  encoded: string
  address: string
}>
const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex, "hex"))
const hex = (value: Uint8Array) => Buffer.from(value).toString("hex")
const code = { accountId: "publisher.near" }

describe("NEP-616 public address", () => {
  for (const fixture of fixtures) {
    it(`matches the ${fixture.name} canonical vector`, () => {
      const data = fixture.data.map(
        ([key, value]) => [bytes(key), bytes(value)] as const,
      )
      const input = { code: fixture.code, data }
      expect(hex(encodeStateInit(input))).toBe(fixture.encoded)
      expect(deterministicAccountId(input)).toBe(fixture.address)
      expect(
        deterministicAccountId({ ...input, data: [...data].reverse() }),
      ).toBe(fixture.address)
      if (fixture.codeBytes && fixture.code.hash)
        expect(hex(parseHash(fixture.code.hash))).toBe(fixture.codeBytes)
    })
  }
  it("defaults omitted data to empty storage", () => {
    expect(deterministicAccountId({ code })).toBe(fixtures[1]?.address)
  })
  it("does not mutate tuples, order or subarray backing bytes", () => {
    const backing = bytes("9902ff88")
    const key = backing.subarray(1, 2)
    const value = backing.subarray(2, 3)
    const data = [
      [bytes("0a"), bytes("22")],
      [key, value],
    ] as const
    const before = data.map(([k, v]) => [hex(k), hex(v)])
    const expected = deterministicAccountId({ code, data })
    expect(data.map(([k, v]) => [hex(k), hex(v)])).toEqual(before)
    expect(hex(backing)).toBe("9902ff88")
    expect(expected).toBe(
      deterministicAccountId({
        code,
        data: [
          [bytes("02"), bytes("ff")],
          [bytes("0a"), bytes("22")],
        ],
      }),
    )
  })
  it("rejects equal-byte duplicate keys instead of overwriting by insertion order", () => {
    expect(() =>
      deterministicAccountId({
        code,
        data: [
          [bytes("00"), bytes("01")],
          [bytes("00"), bytes("02")],
        ],
      }),
    ).toThrowError("Duplicate storage key")
  })
  it.each([
    null,
    {},
    { code: null },
    { code: {} },
    { code: { hash: "11111111111111111111111111111111", accountId: "aa" } },
    { code: { accountId: "bad..near" } },
    { code: { hash: "private invalid hash" } },
    { code, data: {} },
    { code, data: [undefined] },
    { code, data: new Array(1) },
    { code, data: [[bytes("00")]] },
    { code, data: [["00", bytes("00")]] },
  ])("rejects malformed public input %#", (input) => {
    expect(() => deterministicAccountId(input as StateInit)).toThrow()
  })
  it("rejects shared and detached data as sanitized input errors", () => {
    const shared = new Uint8Array(new SharedArrayBuffer(1))
    expect(() =>
      deterministicAccountId({ code, data: [[shared, bytes("")]] }),
    ).toThrowError("Expected attached, non-shared storage bytes")
    const detached = bytes("01")
    structuredClone(detached, { transfer: [detached.buffer] })
    expect(() =>
      deterministicAccountId({ code, data: [[detached, bytes("")]] }),
    ).toThrowError("Expected attached, non-shared storage bytes")
  })
  it("preserves caller-code defects without disguising them as validation", () => {
    const defect = new Error("caller getter")
    const input = {
      get code(): StateInit["code"] {
        throw defect
      },
    }
    expect(() => deterministicAccountId(input)).toThrow(defect)
  })
})
