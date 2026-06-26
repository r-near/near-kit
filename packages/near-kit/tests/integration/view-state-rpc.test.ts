/**
 * Integration tests for view_state pagination and the RPC methods stabilized in
 * nearcore 2.13 (block_effects / genesis_config / maintenance_windows).
 */

import { base64 } from "@scure/base"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { Near } from "../../src/core/near.js"
import { EMPTY_CODE_HASH, Sandbox } from "../../src/sandbox/sandbox.js"

// view_state `limit`/`after_key_base64` pagination was added in nearcore 2.13
// (protocol v85). Older nodes ignore `limit` and return every entry, so the
// pagination assertions only run against a 2.13.x sandbox.
const VIEW_STATE_PAGINATION_PROTOCOL_VERSION = 85

describe("view_state + stabilized RPC - Integration Tests", () => {
  let sandbox: Sandbox
  let near: Near
  let stateAccount: string
  let protocolVersion = 0

  beforeAll(async () => {
    sandbox = await Sandbox.start()
    near = new Near({
      network: sandbox,
      keyStore: { [sandbox.rootAccount.id]: sandbox.rootAccount.secretKey },
    })
    protocolVersion = (await near.getStatus()).protocol_version

    // Seed a contract account with deterministic state via patchState, so the
    // pagination assertions don't depend on any contract's internal layout.
    stateAccount = `state-${Date.now()}.${sandbox.rootAccount.id}`
    const enc = new TextEncoder()
    const data = Array.from({ length: 5 }, (_, i) => ({
      Data: {
        account_id: stateAccount,
        data_key: base64.encode(enc.encode(`key-${i}`)),
        value: base64.encode(enc.encode(`value-${i}`)),
      },
    }))
    await sandbox.patchState([
      {
        Account: {
          account_id: stateAccount,
          account: {
            amount: "100000000000000000000000000",
            locked: "0",
            code_hash: EMPTY_CODE_HASH,
            storage_usage: 500,
          },
        },
      },
      ...data,
    ])
  }, 120000)

  afterAll(async () => {
    if (sandbox) await sandbox.stop()
  })

  test("view_state returns all seeded entries", async () => {
    const result = await near.viewState(stateAccount)
    expect(result.values.length).toBe(5)
    const dec = new TextDecoder()
    const keys = result.values
      .map((v) => dec.decode(base64.decode(v.key)))
      .sort()
    expect(keys).toEqual(["key-0", "key-1", "key-2", "key-3", "key-4"])
  })

  test("view_state paginates via limit + last_key cursor", async (ctx) => {
    if (protocolVersion < VIEW_STATE_PAGINATION_PROTOCOL_VERSION) {
      console.warn(
        `⚠ Skipping view_state pagination test: node is protocol ${protocolVersion}, ` +
          `limit/after_key_base64 needs ${VIEW_STATE_PAGINATION_PROTOCOL_VERSION}+ (2.13.x sandbox)`,
      )
      ctx.skip()
      return
    }

    const page1 = await near.viewState(stateAccount, { limit: 2 })
    expect(page1.values.length).toBe(2)
    expect(page1.last_key).toBeDefined()

    const page2 = await near.viewState(stateAccount, {
      limit: 2,
      afterKey: page1.last_key,
    })
    expect(page2.values.length).toBeGreaterThan(0)
    // Cursor advanced: page 2's first key differs from page 1's first key.
    expect(page2.values[0]?.key).not.toBe(page1.values[0]?.key)
  })

  test("viewStateAll iterates every entry across pages", async () => {
    const seen: string[] = []
    for await (const item of near.viewStateAll(stateAccount, { limit: 2 })) {
      seen.push(item.key)
    }
    expect(seen.length).toBe(5)
    // No duplicates across page boundaries.
    expect(new Set(seen).size).toBe(5)
  })

  test("genesis_config returns the chain config", async () => {
    const cfg = await near.rpc.genesisConfig()
    expect(cfg.chain_id).toBe("localnet")
    expect(cfg.protocol_version).toBeGreaterThan(0)
  })

  test("block_effects returns state-change kinds for a block", async () => {
    const effects = await near.rpc.blockEffects({ finality: "final" })
    expect(typeof effects.block_hash).toBe("string")
    expect(Array.isArray(effects.changes)).toBe(true)
  })

  test("maintenance_windows returns ranges for the validator", async () => {
    const windows = await near.rpc.maintenanceWindows(sandbox.rootAccount.id)
    expect(Array.isArray(windows)).toBe(true)
    for (const w of windows) {
      expect(w.end).toBeGreaterThanOrEqual(w.start)
    }
  })
})
