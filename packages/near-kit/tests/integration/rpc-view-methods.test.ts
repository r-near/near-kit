/**
 * Integration tests for RPC view methods.
 *
 * These tests run against a local Sandbox (deterministic) rather than live
 * public RPC. They exercise read-only operations that don't require signing or
 * gas, plus a couple of error paths.
 */

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { Near } from "../../src/core/near.js"
import { RpcClient } from "../../src/core/rpc/rpc.js"
import type {
  AccountView,
  GasPriceResponse,
  StatusResponse,
  ViewFunctionCallResult,
} from "../../src/core/types.js"
import { AccountDoesNotExistError } from "../../src/errors/index.js"
import { Sandbox } from "../../src/sandbox/sandbox.js"
import { generateKey } from "../../src/utils/key.js"

let sandbox: Sandbox
let rpc: RpcClient
let contractId: string

beforeAll(async () => {
  sandbox = await Sandbox.start()
  const near = new Near({
    network: sandbox,
    keyStore: {
      [sandbox.rootAccount.id]: sandbox.rootAccount.secretKey,
    },
  })

  // Deploy guestbook contract for view-call coverage.
  contractId = `contract-${Date.now()}.${sandbox.rootAccount.id}`
  const contractWasm = readFileSync(
    resolve(__dirname, "../contracts/guestbook.wasm"),
  )
  const contractKey = generateKey()
  await near
    .transaction(sandbox.rootAccount.id)
    .createAccount(contractId)
    .transfer(contractId, "10 NEAR")
    .addKey(contractKey.publicKey.toString(), { type: "fullAccess" })
    .deployContract(contractId, contractWasm)
    .send({ waitUntil: "FINAL" })

  rpc = new RpcClient(sandbox.rpcUrl)

  console.log(`✓ Sandbox started: ${sandbox.rpcUrl}`)
  console.log(`✓ Contract deployed: ${contractId}`)
}, 120000)

afterAll(async () => {
  if (sandbox) {
    await sandbox.stop()
    console.log("✓ Sandbox stopped")
  }
})

describe("RPC View Methods (sandbox)", () => {
  test("getStatus should return network status", async () => {
    const status: StatusResponse = await rpc.getStatus()

    // Verify response structure
    expect(status).toBeDefined()
    expect(typeof status.chain_id).toBe("string")
    expect(status.chain_id).toBe(sandbox.networkId)
    expect(status.genesis_hash).toBeDefined()
    expect(status.version).toBeDefined()
    expect(status.version.version).toBeDefined()
    expect(status.version.build).toBeDefined()
    expect(status.protocol_version).toBeGreaterThan(0)
    expect(status.latest_protocol_version).toBeGreaterThan(0)

    // Verify node info
    expect(status.node_public_key).toBeDefined()
    expect(status.rpc_addr).toBeDefined()

    // Verify validators structure (array of objects with account_id)
    expect(Array.isArray(status.validators)).toBe(true)
    if (status.validators.length > 0) {
      expect(status.validators[0]).toHaveProperty("account_id")
      expect(typeof status.validators[0]?.account_id).toBe("string")
    }

    // Verify sync info
    expect(status.sync_info).toBeDefined()
    expect(status.sync_info.latest_block_hash).toBeDefined()
    expect(status.sync_info.latest_block_height).toBeGreaterThan(0)
    expect(status.sync_info.latest_state_root).toBeDefined()
    expect(status.sync_info.latest_block_time).toBeDefined()
    expect(typeof status.sync_info.syncing).toBe("boolean")

    console.log(
      `✓ Status: chain=${status.chain_id}, height=${status.sync_info.latest_block_height}, validators=${status.validators.length}`,
    )
  })

  test("getBlock should return block with default finality", async () => {
    const block = await rpc.getBlock()

    expect(block).toBeDefined()
    expect(block.header).toBeDefined()
    expect(block.header.hash).toBeDefined()
    expect(block.header.height).toBeGreaterThan(0)
    expect(block.author).toBeDefined()
    expect(Array.isArray(block.chunks)).toBe(true)

    console.log(
      `✓ Block (final): height=${block.header.height}, hash=${block.header.hash.slice(0, 8)}...`,
    )
  })

  test("getBlock should accept finality parameter", async () => {
    const block = await rpc.getBlock({ finality: "optimistic" })

    expect(block).toBeDefined()
    expect(block.header.hash).toBeDefined()
    expect(block.header.height).toBeGreaterThan(0)

    console.log(`✓ Block (optimistic): height=${block.header.height}`)
  })

  test("getBlock should accept blockId parameter", async () => {
    // First get the current final block to get a valid height. Guard against
    // underflow on a very fresh sandbox by clamping to height 1.
    const finalBlock = await rpc.getBlock({ finality: "final" })
    const targetHeight = Math.max(1, finalBlock.header.height - 1)

    const block = await rpc.getBlock({ blockId: targetHeight })

    expect(block).toBeDefined()
    expect(block.header.height).toBe(targetHeight)

    console.log(
      `✓ Block (by height ${targetHeight}): hash=${block.header.hash.slice(0, 8)}...`,
    )
  })

  test("getAccount should return account info for known account", async () => {
    const account: AccountView = await rpc.getAccount(sandbox.rootAccount.id)

    // Verify response structure
    expect(account).toBeDefined()
    expect(account.amount).toBeDefined()
    expect(account.locked).toBeDefined()
    expect(account.code_hash).toBeDefined()
    expect(account.storage_usage).toBeGreaterThanOrEqual(0)
    expect(account.block_height).toBeGreaterThan(0)
    expect(account.block_hash).toBeDefined()

    // Amount should be a valid yoctoNEAR string
    expect(BigInt(account.amount)).toBeGreaterThanOrEqual(0n)
    expect(BigInt(account.locked)).toBeGreaterThanOrEqual(0n)

    console.log(
      `✓ Account '${sandbox.rootAccount.id}': balance=${account.amount} yoctoNEAR, storage=${account.storage_usage} bytes`,
    )
  })

  test("getGasPrice should return current gas price", async () => {
    const gasPrice: GasPriceResponse = await rpc.getGasPrice()

    // Verify response structure
    expect(gasPrice).toBeDefined()
    expect(gasPrice.gas_price).toBeDefined()

    // Gas price should be a valid yoctoNEAR string and positive
    const price = BigInt(gasPrice.gas_price)
    expect(price).toBeGreaterThan(0n)

    console.log(`✓ Gas price: ${gasPrice.gas_price} yoctoNEAR`)
  })

  test("viewFunction should call contract view method", async () => {
    const result: ViewFunctionCallResult = await rpc.viewFunction(
      contractId,
      "total_messages",
      {},
    )

    // Verify response structure
    expect(result).toBeDefined()
    expect(result.result).toBeDefined()
    expect(Array.isArray(result.result)).toBe(true)
    expect(result.logs).toBeDefined()
    expect(Array.isArray(result.logs)).toBe(true)
    expect(result.block_height).toBeGreaterThan(0)
    expect(result.block_hash).toBeDefined()

    // Decode the result - total_messages() returns a number.
    const decoded = JSON.parse(
      new TextDecoder().decode(new Uint8Array(result.result)),
    )
    expect(typeof decoded).toBe("number")

    console.log(`✓ View call to ${contractId}.total_messages(): ${decoded}`)
  })
})

describe("RPC Error Handling", () => {
  test("should handle non-existent account", async () => {
    const nonExistentAccount = `nope-${Date.now()}.${sandbox.rootAccount.id}`

    try {
      await rpc.getAccount(nonExistentAccount)
      // Should not reach here
      expect(false).toBe(true)
    } catch (error) {
      // Should throw an AccountDoesNotExistError
      expect(error).toBeDefined()
      expect(error).toBeInstanceOf(AccountDoesNotExistError)
      const accountError = error as AccountDoesNotExistError
      expect(accountError.accountId).toBeDefined()
      expect(accountError.code).toBe("ACCOUNT_NOT_FOUND")
      console.log(
        `✓ Correctly handled non-existent account error: ${accountError.message}`,
      )
    }
  })

  test("should handle invalid contract method call", async () => {
    try {
      await rpc.viewFunction(contractId, "this_method_does_not_exist_12345", {})
      // Should not reach here
      expect(false).toBe(true)
    } catch (error) {
      // Should throw an error (FunctionCallError for a missing method)
      expect(error).toBeDefined()
      console.log(`✓ Correctly handled invalid method call error`)
    }
  })
})
