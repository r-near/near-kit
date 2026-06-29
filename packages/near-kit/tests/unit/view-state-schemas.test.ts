/**
 * Unit tests for the view_state / stabilized-RPC response schemas.
 */

import { describe, expect, test } from "vitest"
import {
  BlockEffectsResponseSchema,
  GenesisConfigResponseSchema,
  MaintenanceWindowsResponseSchema,
  ViewStateResultSchema,
} from "../../src/core/rpc/rpc-schemas.js"

describe("ViewStateResultSchema", () => {
  test("parses a page with a continuation cursor", () => {
    const parsed = ViewStateResultSchema.parse({
      values: [
        { key: "a2V5", value: "dmFsdWU=" },
        { key: "azI=", value: "djI=" },
      ],
      last_key: "azI=",
      block_height: 100,
      block_hash: "abc",
    })
    expect(parsed.values).toHaveLength(2)
    expect(parsed.last_key).toBe("azI=")
  })

  test("parses a final page (no last_key, no proof)", () => {
    const parsed = ViewStateResultSchema.parse({ values: [] })
    expect(parsed.values).toEqual([])
    expect(parsed.last_key).toBeUndefined()
    expect(parsed.proof).toBeUndefined()
  })

  test("accepts an inclusion proof when present", () => {
    const parsed = ViewStateResultSchema.parse({
      values: [{ key: "a2V5", value: "dg==" }],
      proof: ["cHJvb2Yx", "cHJvb2Yy"],
    })
    expect(parsed.proof).toHaveLength(2)
  })
})

describe("BlockEffectsResponseSchema", () => {
  test("parses tagged state-change kinds", () => {
    const parsed = BlockEffectsResponseSchema.parse({
      block_hash: "Hhh",
      changes: [
        { type: "account_touched", account_id: "alice.near" },
        { type: "data_touched", account_id: "contract.near" },
      ],
    })
    expect(parsed.changes[0]?.type).toBe("account_touched")
    expect(parsed.changes[1]?.account_id).toBe("contract.near")
  })
})

describe("MaintenanceWindowsResponseSchema", () => {
  test("parses an array of block-height ranges", () => {
    const parsed = MaintenanceWindowsResponseSchema.parse([
      { start: 100, end: 200 },
      { start: 300, end: 400 },
    ])
    expect(parsed).toHaveLength(2)
    expect(parsed[0]).toEqual({ start: 100, end: 200 })
  })

  test("parses an empty list", () => {
    expect(MaintenanceWindowsResponseSchema.parse([])).toEqual([])
  })
})

describe("GenesisConfigResponseSchema", () => {
  test("parses known fields and preserves unknown ones", () => {
    const parsed = GenesisConfigResponseSchema.parse({
      protocol_version: 85,
      chain_id: "localnet",
      genesis_height: 0,
      some_future_field: { nested: true },
    })
    expect(parsed.protocol_version).toBe(85)
    expect(parsed.chain_id).toBe("localnet")
    expect((parsed as Record<string, unknown>)["some_future_field"]).toEqual({
      nested: true,
    })
  })
})
