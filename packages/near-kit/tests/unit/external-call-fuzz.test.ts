/**
 * Differential tests against nearcore's own near-primitives (0.39.0-rc.1, from
 * nearcore 2.15.0-rc.1). tests/fixtures/nearcore-2.15/oracle generates random
 * calls and mutated encodings with it; near-kit must agree on every encoding,
 * hash and unique id, and accept exactly the encodings nearcore accepts.
 */

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { sha256 } from "@noble/hashes/sha2.js"
import { base58, hex } from "@scure/base"
import { describe, expect, test } from "vitest"
import {
  decodeExternalCall,
  type ExternalCall,
  encodeExternalCall,
  externalCallHash,
  externalCallUniqueId,
} from "../../src/core/external-call.js"

type Call = {
  contract_id: string
  payload: string
  state_init: string | null
  bytes: string
  call_hash: string
  tx_root_leaf_hash: string
  unique_ids: { height: string; unique_id: string }[]
}

type Decode =
  | {
      ok: true
      bytes: string
      contract_id: string
      payload: string
      state_init: string | null
    }
  | { ok: false; bytes: string }

const fixture = JSON.parse(
  readFileSync(
    resolve(__dirname, "../fixtures/nearcore-2.15/near-primitives-fuzz.json"),
    "utf8",
  ),
) as { calls: Call[]; decodes: Decode[] }

const callOf = (c: {
  contract_id: string
  payload: string
  state_init: string | null
}): ExternalCall =>
  c.state_init === null
    ? { contractId: c.contract_id, payload: hex.decode(c.payload) }
    : {
        contractId: c.contract_id,
        payload: hex.decode(c.payload),
        stateInit: hex.decode(c.state_init),
      }

describe("random calls", () => {
  test("cover the edge cases", () => {
    const { calls } = fixture
    expect(calls.length).toBe(500)
    expect(calls.some((c) => c.payload === "")).toBe(true)
    expect(calls.some((c) => c.payload.length / 2 > 255)).toBe(true)
    expect(calls.some((c) => c.state_init === "")).toBe(true)
    expect(calls.filter((c) => c.state_init !== null).length).toBeGreaterThan(
      100,
    )
    const heights = calls.flatMap((c) =>
      c.unique_ids.map((u) => BigInt(u.height)),
    )
    expect(heights.some((h) => h > BigInt(Number.MAX_SAFE_INTEGER))).toBe(true)
    expect(heights.some((h) => h < 1000n)).toBe(true)
  })

  test("encode, hash and get unique ids like near-primitives", () => {
    for (const c of fixture.calls) {
      const call = callOf(c)
      const bytes = encodeExternalCall(call)
      expect(hex.encode(bytes), c.contract_id).toBe(c.bytes)
      expect(base58.encode(sha256(bytes))).toBe(c.tx_root_leaf_hash)
      expect(externalCallHash(call)).toBe(c.call_hash)
      for (const { height, unique_id } of c.unique_ids) {
        expect(externalCallUniqueId(call, BigInt(height))).toBe(unique_id)
        expect(externalCallUniqueId(c.call_hash, BigInt(height))).toBe(
          unique_id,
        )
      }
    }
  })

  test("decode back to themselves", () => {
    for (const c of fixture.calls) {
      expect(decodeExternalCall(hex.decode(c.bytes))).toEqual(callOf(c))
    }
  })
})

describe("mutated encodings", () => {
  const accepted = fixture.decodes.filter((d) => d.ok)
  const rejected = fixture.decodes.filter((d) => !d.ok)

  test("include both verdicts", () => {
    expect(fixture.decodes.length).toBe(3000)
    expect(accepted.length).toBeGreaterThan(300)
    expect(rejected.length).toBeGreaterThan(300)
  })

  test("decode where nearcore decodes, to the same call", () => {
    for (const d of accepted) {
      if (!d.ok) continue
      expect(decodeExternalCall(hex.decode(d.bytes)), d.bytes).toEqual(
        callOf(d),
      )
    }
  })

  test("are rejected where nearcore rejects them", () => {
    for (const d of rejected) {
      expect(() => decodeExternalCall(hex.decode(d.bytes)), d.bytes).toThrow()
    }
  })
})
