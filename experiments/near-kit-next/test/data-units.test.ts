import { describe, expect, it } from "vitest"
import * as Data from "../src/data.js"
import * as Units from "../src/units.js"

const U64 = (1n << 64n) - 1n
const U128 = (1n << 128n) - 1n
it("roundtrips exact native units across boundaries and a deterministic sample", () => {
  let sample = 1n
  const values = [0n, 1n, 10n ** 24n, U128]
  for (let i = 0; i < 256; i++) {
    sample = (sample * 6364136223846793005n + 1442695040888963407n) & U128
    values.push(sample)
  }
  for (const value of values) {
    expect(Units.parseNear(Units.formatNear(value))).toBe(value)
    const gas = value & U64
    expect(Units.parseTgas(Units.formatTgas(gas))).toBe(gas)
  }
  expect(Units.formatNear(1n)).toBe("0.000000000000000000000001")
  expect(Units.formatTgas(1n)).toBe("0.000000000001")
  expect(Units.formatNear(0n)).toBe("0")
})
for (const name of ["Near", "Tgas"] as const) {
  describe(name, () => {
    const parse = name === "Near" ? Units.parseNear : Units.parseTgas
    const format = name === "Near" ? Units.formatNear : Units.formatTgas
    const decimals = name === "Near" ? 24 : 12
    const maximum = name === "Near" ? U128 : U64
    for (const value of [
      "",
      ".5",
      "1.",
      "1.2.3",
      "+1",
      "-1",
      "01",
      "1e0",
      " 1",
      "1 ",
      "1\n",
      "1\r",
      "1\u2028",
      "1\u2029",
      `0.${"0".repeat(decimals + 1)}`,
    ]) {
      it(`rejects ${JSON.stringify(value)} rather than rounding`, () =>
        expect(() => parse(value)).toThrow(RangeError))
    }
    it("enforces string and unsigned bigint domains", () => {
      for (const value of [1, NaN, Infinity, 1n, null])
        expect(() => Reflect.apply(parse, undefined, [value])).toThrow(
          TypeError,
        )
      for (const value of ["1", 1, NaN, null])
        expect(() => Reflect.apply(format, undefined, [value])).toThrow(
          TypeError,
        )
      expect(() => format(-1n)).toThrow(RangeError)
      expect(() => format(maximum + 1n)).toThrow(RangeError)
      expect(() => parse("9".repeat(10000))).toThrow(RangeError)
    })
  })
}
it("validates account syntax without claiming existence", () => {
  for (const value of [
    "aa",
    "alice.near",
    "a-b.c_d",
    "a".repeat(64),
    `0x${"a".repeat(40)}`,
    `0s${"f".repeat(40)}`,
  ])
    expect(Data.parseAccountId(value)).toBe(value)
  for (const value of [
    "a",
    "a".repeat(65),
    "-aa",
    "aa.",
    "a..b",
    "a_-b",
    "AA",
    "éé",
    "aa\n",
    "aa\u2028",
    " aa",
  ]) {
    expect(Data.isAccountId(value)).toBe(false)
    expect(() => Data.parseAccountId(value)).toThrow(RangeError)
  }
  expect(Data.isAccountId(undefined)).toBe(false)
})
it("roundtrips owned hash/key bytes, distinguishes handles, and checks exact lengths", () => {
  const hash = new Uint8Array(32).fill(7)
  const text = Data.formatHash(hash)
  const decoded = Data.parseHash(text)
  decoded[0] = 9
  expect(Data.parseHash(text)).toEqual(hash)
  for (const [kind, length] of [
    ["ed25519", 32],
    ["secp256k1", 64],
    ["ml-dsa-65", 1952],
    ["ml-dsa-65-hash", 32],
  ] as const) {
    const data = new Uint8Array(length).fill(255)
    const encoded = Data.formatPublicKey({ kind, data })
    const parsed = Data.parsePublicKey(encoded)
    expect(parsed).toEqual({ kind, data })
    parsed.data[0] = 0
    expect(Data.parsePublicKey(encoded).data).toEqual(data)
    expect(() =>
      Data.formatPublicKey({ kind, data: new Uint8Array(length - 1) }),
    ).toThrow(RangeError)
    expect(() => Data.parsePublicKey(`${encoded}\n`)).toThrow(RangeError)
  }
  for (const value of [
    "",
    "0".repeat(32),
    "1".repeat(31),
    "1".repeat(33),
    `${text}\n`,
  ])
    expect(() => Data.parseHash(value)).toThrow(RangeError)
  expect(() => Data.parsePublicKey(text)).toThrow(RangeError)
  const short = new Uint8Array(31)
  Object.defineProperty(short, "length", { value: 32 })
  expect(() => Data.formatHash(short)).toThrow(RangeError)
})
