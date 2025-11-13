/**
 * Integration tests for RPC view methods against real NEAR RPC endpoints
 *
 * These tests make actual network calls to NEAR mainnet and testnet RPCs.
 * They test read-only operations that don't require signing or gas.
 */

import { describe, test, expect } from "bun:test"
import { RpcClient } from "../../src/core/rpc.js"
import type {
  ViewFunctionCallResult,
  AccountView,
  StatusResponse,
  GasPriceResponse,
} from "../../src/core/types.js"

// Use the new FastNEAR endpoints
const MAINNET_RPC = "https://free.rpc.fastnear.com"
const TESTNET_RPC = "https://rpc.testnet.fastnear.com"

// Well-known accounts that should exist
const MAINNET_ACCOUNT = "near"
const TESTNET_ACCOUNT = "testnet"

// Well-known contract for testing view calls
const WRAP_NEAR_CONTRACT = "wrap.near" // Wrapped NEAR contract on mainnet

describe("RPC View Methods - Mainnet", () => {
  const rpc = new RpcClient(MAINNET_RPC)

  test("getStatus should return network status", async () => {
    const status: StatusResponse = await rpc.getStatus()

    // Verify response structure
    expect(status).toBeDefined()
    expect(status.chain_id).toBe("mainnet")
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
      expect(typeof status.validators[0].account_id).toBe("string")
    }

    // Verify sync info
    expect(status.sync_info).toBeDefined()
    expect(status.sync_info.latest_block_hash).toBeDefined()
    expect(status.sync_info.latest_block_height).toBeGreaterThan(0)
    expect(status.sync_info.latest_state_root).toBeDefined()
    expect(status.sync_info.latest_block_time).toBeDefined()
    expect(typeof status.sync_info.syncing).toBe("boolean")

    console.log(`✓ Mainnet status: chain=${status.chain_id}, height=${status.sync_info.latest_block_height}, validators=${status.validators.length}`)
  }, 10000) // 10 second timeout

  test("getAccount should return account info for known account", async () => {
    const account: AccountView = await rpc.getAccount(MAINNET_ACCOUNT)

    // Verify response structure
    expect(account).toBeDefined()
    expect(account.amount).toBeDefined()
    expect(account.locked).toBeDefined()
    expect(account.code_hash).toBeDefined()
    expect(account.storage_usage).toBeGreaterThan(0)
    expect(account.block_height).toBeGreaterThan(0)
    expect(account.block_hash).toBeDefined()

    // Amount should be a valid yoctoNEAR string
    expect(BigInt(account.amount)).toBeGreaterThanOrEqual(0n)
    expect(BigInt(account.locked)).toBeGreaterThanOrEqual(0n)

    console.log(`✓ Account '${MAINNET_ACCOUNT}': balance=${account.amount} yoctoNEAR, storage=${account.storage_usage} bytes`)
  }, 10000)

  test("getGasPrice should return current gas price", async () => {
    const gasPrice: GasPriceResponse = await rpc.getGasPrice()

    // Verify response structure
    expect(gasPrice).toBeDefined()
    expect(gasPrice.gas_price).toBeDefined()

    // Gas price should be a valid yoctoNEAR string and positive
    const price = BigInt(gasPrice.gas_price)
    expect(price).toBeGreaterThan(0n)

    console.log(`✓ Gas price: ${gasPrice.gas_price} yoctoNEAR`)
  }, 10000)

  test("viewFunction should call contract view method", async () => {
    const result: ViewFunctionCallResult = await rpc.viewFunction(
      WRAP_NEAR_CONTRACT,
      "ft_metadata",
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

    // Decode the result to verify it's valid JSON
    const decoded = JSON.parse(
      new TextDecoder().decode(new Uint8Array(result.result)),
    )
    expect(decoded).toBeDefined()
    expect(decoded.name).toBeDefined() // FT metadata should have name field

    console.log(`✓ View call to ${WRAP_NEAR_CONTRACT}.ft_metadata(): ${decoded.name}`)
  }, 10000)
})

describe("RPC View Methods - Testnet", () => {
  const rpc = new RpcClient(TESTNET_RPC)

  test("getStatus should return network status", async () => {
    const status: StatusResponse = await rpc.getStatus()

    // Verify response structure
    expect(status).toBeDefined()
    expect(status.chain_id).toBe("testnet")
    expect(status.version).toBeDefined()
    expect(status.protocol_version).toBeGreaterThan(0)

    // Verify sync info
    expect(status.sync_info).toBeDefined()
    expect(status.sync_info.latest_block_hash).toBeDefined()
    expect(status.sync_info.latest_block_height).toBeGreaterThan(0)

    console.log(`✓ Testnet status: chain=${status.chain_id}, height=${status.sync_info.latest_block_height}`)
  }, 10000)

  test("getAccount should return account info for known account", async () => {
    const account: AccountView = await rpc.getAccount(TESTNET_ACCOUNT)

    // Verify response structure
    expect(account).toBeDefined()
    expect(account.amount).toBeDefined()
    expect(account.storage_usage).toBeGreaterThan(0)
    expect(account.block_height).toBeGreaterThan(0)

    console.log(`✓ Testnet account '${TESTNET_ACCOUNT}': balance=${account.amount} yoctoNEAR`)
  }, 10000)

  test("getGasPrice should return current gas price", async () => {
    const gasPrice: GasPriceResponse = await rpc.getGasPrice()

    // Verify response structure
    expect(gasPrice).toBeDefined()
    expect(gasPrice.gas_price).toBeDefined()

    const price = BigInt(gasPrice.gas_price)
    expect(price).toBeGreaterThan(0n)

    console.log(`✓ Testnet gas price: ${gasPrice.gas_price} yoctoNEAR`)
  }, 10000)
})

describe("RPC Error Handling", () => {
  const rpc = new RpcClient(MAINNET_RPC)

  test("should handle non-existent account", async () => {
    const nonExistentAccount = "this-account-definitely-does-not-exist-12345.near"

    try {
      await rpc.getAccount(nonExistentAccount)
      // Should not reach here
      expect(false).toBe(true)
    } catch (error) {
      // Should throw a NetworkError
      expect(error).toBeDefined()
      // Error message should contain either "Server error" or account info
      const message = (error as Error).message
      expect(message).toBeTruthy()
      // Verify it's an RPC error (not a network failure)
      expect(message).toMatch(/RPC error|does not exist|Server error/)
      console.log(`✓ Correctly handled non-existent account error: ${message}`)
    }
  }, 10000)

  test("should handle invalid contract method call", async () => {
    try {
      await rpc.viewFunction(
        MAINNET_ACCOUNT,
        "this_method_does_not_exist_12345",
        {},
      )
      // Should not reach here
      expect(false).toBe(true)
    } catch (error) {
      // Should throw a NetworkError
      expect(error).toBeDefined()
      console.log(`✓ Correctly handled invalid method call error`)
    }
  }, 10000)
})
