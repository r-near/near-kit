import { afterEach, describe, expect, it, vi } from "vitest"
import { Near } from "../../src/core/near.js"

const emptyCodeHash = "11111111111111111111111111111111"
const codeHash = "1thX6LZfHDZZKUs92febYZhYRcXddmzfzF2NvTkPNE"

afterEach(() => vi.unstubAllGlobals())

describe("global contract account state", () => {
  it.each([
    { name: "empty account", fields: {}, hasContract: false },
    {
      name: "null global references",
      fields: { global_contract_account_id: null, global_contract_hash: null },
      hasContract: false,
    },
    {
      name: "local contract",
      fields: { code_hash: codeHash },
      hasContract: true,
    },
    {
      name: "global contract by publisher",
      fields: { global_contract_account_id: "publisher.testnet" },
      hasContract: true,
    },
    {
      name: "global contract by hash",
      fields: { global_contract_hash: codeHash },
      hasContract: true,
    },
  ])("recognizes $name", async ({ fields, hasContract }) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              result: {
                amount: "1000000000000000000000000",
                locked: "0",
                code_hash: emptyCodeHash,
                storage_usage: 100,
                storage_paid_at: 0,
                block_height: 123,
                block_hash: codeHash,
                ...fields,
              },
            }),
          ),
      ),
    )
    const near = new Near({ network: "testnet" })
    expect(await near.rpc.getAccount("switch.testnet")).toMatchObject(fields)
    expect((await near.getAccount("switch.testnet")).hasContract).toBe(
      hasContract,
    )
  })
})
