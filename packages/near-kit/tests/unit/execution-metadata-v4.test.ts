/**
 * Unit tests for ExecutionMetadata V4 typed `contracts` (nearcore 2.13),
 * verifying V1-V3 back-compat is preserved.
 */

import { describe, expect, test } from "vitest"
import { ExecutionMetadataSchema } from "../../src/core/rpc/rpc-schemas.js"

describe("ExecutionMetadataSchema", () => {
  test("parses V1 metadata (gas_profile null, no contracts)", () => {
    const parsed = ExecutionMetadataSchema.parse({
      version: 1,
      gas_profile: null,
    })
    expect(parsed.version).toBe(1)
    expect("contracts" in parsed).toBe(false)
  })

  test("parses V3 metadata (gas profile entries, no contracts)", () => {
    const parsed = ExecutionMetadataSchema.parse({
      version: 3,
      gas_profile: [
        { cost: "BASE", cost_category: "WASM_HOST_COST", gas_used: "123" },
      ],
    })
    expect(parsed.version).toBe(3)
    expect(parsed.gas_profile?.length).toBe(1)
  })

  test("parses V4 metadata with typed per-action contracts", () => {
    const parsed = ExecutionMetadataSchema.parse({
      version: 4,
      gas_profile: [],
      contracts: [
        { local: "11111111111111111111111111111111" },
        { global_hash: "22222222222222222222222222222222" },
        { global_account_id: "factory.near" },
        null,
      ],
    })
    expect(parsed.version).toBe(4)
    if (parsed.version === 4) {
      expect(parsed.contracts?.length).toBe(4)
      expect(parsed.contracts?.[0]).toEqual({
        local: "11111111111111111111111111111111",
      })
      expect(parsed.contracts?.[1]).toEqual({
        global_hash: "22222222222222222222222222222222",
      })
      expect(parsed.contracts?.[2]).toEqual({
        global_account_id: "factory.near",
      })
      expect(parsed.contracts?.[3]).toBeNull()
    }
  })

  test("parses V4 metadata that omits contracts (older chunk producer)", () => {
    const parsed = ExecutionMetadataSchema.parse({
      version: 4,
      gas_profile: [],
    })
    expect(parsed.version).toBe(4)
  })

  test("does not throw on an unknown future version", () => {
    const parsed = ExecutionMetadataSchema.parse({
      version: 5,
      gas_profile: null,
    })
    expect(parsed.version).toBe(5)
  })

  test("rejects a malformed V4 instead of silently falling through", () => {
    // A V4 with a bad `contracts` entry must fail loudly, not get accepted by
    // the forward-compat fallback (which would strip `contracts`).
    expect(() =>
      ExecutionMetadataSchema.parse({
        version: 4,
        gas_profile: [],
        contracts: [{ bogus_variant: "x" }],
      }),
    ).toThrow()
  })

  test("a V4 result narrows to the typed branch (contracts is available)", () => {
    const parsed = ExecutionMetadataSchema.parse({
      version: 4,
      gas_profile: [],
      contracts: [{ local: "11111111111111111111111111111111" }],
    })
    if (parsed.version === 4) {
      expect(parsed.contracts?.[0]).toEqual({
        local: "11111111111111111111111111111111",
      })
    } else {
      throw new Error("expected version 4 to narrow to the V4 branch")
    }
  })
})
