/**
 * The external call (NEP-667) wire format and the ids derived from it.
 *
 * The vectors follow nearcore's `test_ecc_outcome_id_of_a_call`
 * (core/primitives/src/utils.rs, 2.15.0-rc.1) and were cross-checked with an
 * independent implementation. The last one is a call sent to a real
 * 2.15.0-rc.1 node, whose `transaction_id` the unique id must equal.
 */

import { sha256 } from "@noble/hashes/sha2.js"
import { base58, base64, hex } from "@scure/base"
import { describe, expect, test } from "vitest"
import {
  decodeExternalCall,
  EXTERNAL_CALL_ESCAPE_BYTE,
  EXTERNAL_CALL_METHOD_NAME,
  EXTERNAL_CALL_VERSION,
  encodeExternalCall,
  externalCallHash,
  externalCallHashBytes,
  externalCallUniqueId,
} from "../../src/core/external-call.js"
import { InvalidAccountIdError } from "../../src/errors/index.js"

const WITH_STATE_INIT = {
  contractId: "wallet.near",
  payload: Uint8Array.of(1, 2),
  stateInit: Uint8Array.of(9),
}
const WITHOUT_STATE_INIT = {
  contractId: "wallet.near",
  payload: Uint8Array.of(1, 2),
}

describe("constants", () => {
  test("match nearcore", () => {
    expect(EXTERNAL_CALL_METHOD_NAME).toBe("__external_call")
    expect(EXTERNAL_CALL_ESCAPE_BYTE).toBe(0xff)
    expect(EXTERNAL_CALL_VERSION).toBe(0)
  })
})

describe("encodeExternalCall", () => {
  test("encodes a call without a state init", () => {
    expect(hex.encode(encodeExternalCall(WITHOUT_STATE_INIT))).toBe(
      "ff000b00000077616c6c65742e6e65617202000000010200",
    )
  })

  test("encodes a call with a state init", () => {
    expect(hex.encode(encodeExternalCall(WITH_STATE_INIT))).toBe(
      "ff000b00000077616c6c65742e6e656172020000000102010100000009",
    )
  })

  test("encodes an empty payload", () => {
    expect(
      hex.encode(
        encodeExternalCall({
          contractId: "wallet.near",
          payload: new Uint8Array(),
        }),
      ),
    ).toBe("ff000b00000077616c6c65742e6e6561720000000000")
  })

  test("encodes an empty state init as present", () => {
    const bytes = encodeExternalCall({
      ...WITHOUT_STATE_INIT,
      stateInit: new Uint8Array(),
    })
    expect(hex.encode(bytes.slice(-5))).toBe("0100000000")
  })

  test("rejects an invalid contract id", () => {
    expect(() =>
      encodeExternalCall({
        contractId: "Not Valid",
        payload: new Uint8Array(),
      }),
    ).toThrow(InvalidAccountIdError)
  })
})

describe("decodeExternalCall", () => {
  test("round-trips with and without a state init", () => {
    for (const call of [WITH_STATE_INIT, WITHOUT_STATE_INIT]) {
      expect(decodeExternalCall(encodeExternalCall(call))).toEqual(call)
    }
  })

  test("reads a subarray at an offset", () => {
    const encoded = encodeExternalCall(WITH_STATE_INIT)
    const padded = new Uint8Array(encoded.length + 3)
    padded.set(encoded, 3)
    expect(decodeExternalCall(padded.subarray(3))).toEqual(WITH_STATE_INIT)
  })

  test("rejects a signed transaction's first byte", () => {
    const bytes = encodeExternalCall(WITHOUT_STATE_INIT)
    bytes[0] = 0x0b
    expect(() => decodeExternalCall(bytes)).toThrow(/escape byte: 11/)
  })

  test("rejects another version", () => {
    expect(() =>
      decodeExternalCall(Uint8Array.of(0xff, 1, 0, 0, 0, 0, 0, 0)),
    ).toThrow(/Unsupported external call version: 1/)
  })

  test("rejects truncated input at every length", () => {
    const bytes = encodeExternalCall(WITH_STATE_INIT)
    for (let length = 0; length < bytes.length; length++) {
      expect(() => decodeExternalCall(bytes.slice(0, length))).toThrow(
        /Truncated/,
      )
    }
  })

  test("rejects trailing bytes", () => {
    const bytes = encodeExternalCall(WITHOUT_STATE_INIT)
    const longer = new Uint8Array(bytes.length + 1)
    longer.set(bytes)
    expect(() => decodeExternalCall(longer)).toThrow(/1 trailing bytes/)
  })

  test("rejects an option tag other than 0 or 1", () => {
    const bytes = encodeExternalCall(WITHOUT_STATE_INIT)
    bytes[bytes.length - 1] = 2
    expect(() => decodeExternalCall(bytes)).toThrow(/option tag/)
  })

  test("rejects an invalid contract id", () => {
    const bytes = encodeExternalCall({
      contractId: "abc.near",
      payload: new Uint8Array(),
    })
    bytes[6] = "A".charCodeAt(0)
    expect(() => decodeExternalCall(bytes)).toThrow(InvalidAccountIdError)
  })

  test("rejects a contract id that is not UTF-8", () => {
    const bytes = encodeExternalCall({
      contractId: "abc.near",
      payload: new Uint8Array(),
    })
    bytes[6] = 0xff
    expect(() => decodeExternalCall(bytes)).toThrow()
  })
})

describe("externalCallHash", () => {
  test("is the SHA-256 of the encoding without the state init", () => {
    const expected = sha256(encodeExternalCall(WITHOUT_STATE_INIT))
    expect(externalCallHashBytes(WITHOUT_STATE_INIT)).toEqual(expected)
    expect(externalCallHashBytes(WITH_STATE_INIT)).toEqual(expected)
    expect(externalCallHash(WITH_STATE_INIT)).toBe(
      "EnevB5kSdphvkR4fANfF3n3WrPuFqUM5ufcoK7Ma29h2",
    )
  })

  test("differs from the hash of the bytes sent with a state init", () => {
    expect(externalCallHashBytes(WITH_STATE_INIT)).not.toEqual(
      sha256(encodeExternalCall(WITH_STATE_INIT)),
    )
  })

  test("covers the contract id and the payload", () => {
    const hashes = new Set([
      externalCallHash(WITHOUT_STATE_INIT),
      externalCallHash({ ...WITHOUT_STATE_INIT, contractId: "other.near" }),
      externalCallHash({ ...WITHOUT_STATE_INIT, payload: new Uint8Array() }),
    ])
    expect(hashes.size).toBe(3)
  })
})

describe("externalCallUniqueId", () => {
  test("follows nearcore's test_ecc_outcome_id_of_a_call", () => {
    const callBytes = Uint8Array.from([
      0xff,
      0x00,
      11,
      0,
      0,
      0,
      ...new TextEncoder().encode("wallet.near"),
      2,
      0,
      0,
      0,
      1,
      2,
      0,
    ])
    const idInput = new Uint8Array(40)
    idInput.set(sha256(callBytes))
    idInput[32] = 7
    const expected = base58.encode(sha256(idInput))

    expect(externalCallUniqueId(WITH_STATE_INIT, 7)).toBe(expected)
    expect(expected).toBe("A746zQvp994aqiPFLJTYb6W5cNoXJiw22nvFDX12wZqR")
  })

  test("takes the call, its base58 hash or its hash bytes", () => {
    const hashBytes = externalCallHashBytes(WITHOUT_STATE_INIT)
    const fromCall = externalCallUniqueId(WITHOUT_STATE_INIT, 7)
    expect(externalCallUniqueId(base58.encode(hashBytes), 7)).toBe(fromCall)
    expect(externalCallUniqueId(hashBytes, 7)).toBe(fromCall)
    expect(externalCallUniqueId(hashBytes, 7n)).toBe(fromCall)
  })

  test("encodes the height as u64 little endian", () => {
    expect(
      externalCallUniqueId(
        { contractId: "wallet.near", payload: new Uint8Array() },
        0,
      ),
    ).toBe("9PpWtPXfQPJCtsLoZycooNGQ7WFtD9jckUdWvfFa4F8c")
    expect(externalCallUniqueId(WITHOUT_STATE_INIT, 2 ** 32 + 5)).toBe(
      "Hk3oiRV5KDyECZJFJ4P3NkqW13iuTpULwimc35mDnpF8",
    )
    expect(
      externalCallUniqueId(WITHOUT_STATE_INIT, 0xffff_ffff_ffff_ffffn),
    ).toBe("GHHRQWdYmZ86fxj2VZWVm3yDi31MnjtXtd7Z83qfNwUc")
  })

  test("differs per height", () => {
    expect(externalCallUniqueId(WITHOUT_STATE_INIT, 7)).not.toBe(
      externalCallUniqueId(WITHOUT_STATE_INIT, 8),
    )
  })

  test("matches the transaction_id a 2.15.0-rc.1 node gave a call", () => {
    const call = {
      contractId: "ecc-1795554409281.test.near",
      payload: base64.decode(
        "cDE3OTU1NTQ0MTYzNjItMC4xMzY3NTA5MDYxMzA4NjgwNA==",
      ),
    }
    expect(externalCallHash(call)).toBe(
      "4kjZFjfKQbtMv7dQ67t3bPAqBRKuVqaezYDmt6Ya4jvT",
    )
    expect(externalCallUniqueId(call, 14)).toBe(
      "7GACTspx75YEcW25VohrTvf9pmfiQkf1aneZagNvKxAz",
    )
  })

  test("rejects heights outside u64 or unsafe numbers", () => {
    expect(() => externalCallUniqueId(WITHOUT_STATE_INIT, -1)).toThrow(/u64/)
    expect(() => externalCallUniqueId(WITHOUT_STATE_INIT, 2n ** 64n)).toThrow(
      /u64/,
    )
    expect(() => externalCallUniqueId(WITHOUT_STATE_INIT, 2 ** 53)).toThrow(
      /safe integer/,
    )
    expect(() => externalCallUniqueId(WITHOUT_STATE_INIT, 1.5)).toThrow(
      /safe integer/,
    )
  })

  test("rejects a hash that is not 32 bytes", () => {
    expect(() => externalCallUniqueId(new Uint8Array(31), 1)).toThrow(
      /32 bytes/,
    )
    expect(() =>
      externalCallUniqueId(base58.encode(new Uint8Array(33)), 1),
    ).toThrow(/32 bytes/)
  })
})
