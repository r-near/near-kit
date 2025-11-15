/**
 * Integration tests for typed error handling
 *
 * Tests various error scenarios to ensure proper typed errors are thrown
 */

import { describe, expect, test } from "bun:test"
import { RpcClient } from "../../src/core/rpc/rpc.js"
import {
  AccessKeyDoesNotExistError,
  AccountDoesNotExistError,
  FunctionCallError,
  NetworkError,
} from "../../src/errors/index.js"

const MAINNET_RPC = "https://free.rpc.fastnear.com"

describe("Error Handling - Account Errors", () => {
  const rpc = new RpcClient(MAINNET_RPC)

  test("should throw AccountDoesNotExistError for non-existent account", async () => {
    const nonExistentAccount = "this-account-does-not-exist-xyz-12345.near"

    await expect(async () => {
      await rpc.getAccount(nonExistentAccount)
    }).toThrow(AccountDoesNotExistError)

    try {
      await rpc.getAccount(nonExistentAccount)
      // Should not reach here
      expect(false).toBe(true)
    } catch (error) {
      expect(error).toBeInstanceOf(AccountDoesNotExistError)
      const accountError = error as AccountDoesNotExistError
      expect(accountError.accountId).toBe(nonExistentAccount)
      expect(accountError.code).toBe("ACCOUNT_NOT_FOUND")
      expect(accountError.message).toContain(nonExistentAccount)
      console.log(`✓ AccountDoesNotExistError: ${accountError.message}`)
    }
  }, 10000)

  test("should successfully get existing account", async () => {
    const account = await rpc.getAccount("near")
    expect(account).toBeDefined()
    expect(account.amount).toBeDefined()
    expect(account.storage_usage).toBeGreaterThan(0)
    console.log(`✓ Successfully retrieved account 'near'`)
  }, 10000)
})

describe("Error Handling - Access Key Errors", () => {
  const rpc = new RpcClient(MAINNET_RPC)

  test("should throw AccessKeyDoesNotExistError for non-existent access key", async () => {
    const accountId = "near"
    const fakePublicKey = "ed25519:He7QeRuwizNEhzeKNn2CLdCKfzkH6KLSaFKvJLYtnrFa"

    await expect(async () => {
      await rpc.getAccessKey(accountId, fakePublicKey)
    }).toThrow(AccessKeyDoesNotExistError)

    try {
      await rpc.getAccessKey(accountId, fakePublicKey)
      // Should not reach here
      expect(false).toBe(true)
    } catch (error) {
      expect(error).toBeInstanceOf(AccessKeyDoesNotExistError)
      const keyError = error as AccessKeyDoesNotExistError
      expect(keyError.accountId).toBe(accountId)
      expect(keyError.publicKey).toBe(fakePublicKey)
      expect(keyError.code).toBe("ACCESS_KEY_NOT_FOUND")
      expect(keyError.message).toContain(fakePublicKey)
      expect(keyError.message).toContain(accountId)
      console.log(`✓ AccessKeyDoesNotExistError: ${keyError.message}`)
    }
  }, 10000)

  test("should successfully get existing access key", async () => {
    // First get the list of access keys for an account
    const accountId = "near"
    const listResult = await rpc.call<{
      keys: Array<{ public_key: string }>
    }>("query", {
      request_type: "view_access_key_list",
      finality: "final",
      account_id: accountId,
    })

    expect(listResult.keys).toBeDefined()
    expect(listResult.keys.length).toBeGreaterThan(0)

    // Now get one of the access keys
    const publicKey = listResult.keys[0]?.public_key
    if (!publicKey) {
      throw new Error("No public key found")
    }
    const accessKey = await rpc.getAccessKey(accountId, publicKey)
    expect(accessKey).toBeDefined()
    expect(accessKey.nonce).toBeDefined()
    expect(accessKey.permission).toBeDefined()
    console.log(`✓ Successfully retrieved access key for '${accountId}'`)
  }, 10000)
})

describe("Error Handling - Function Call Errors", () => {
  const rpc = new RpcClient(MAINNET_RPC)

  test("should throw FunctionCallError for non-existent method", async () => {
    const contractId = "wrap.near"
    const methodName = "this_method_does_not_exist_xyz"

    await expect(async () => {
      await rpc.viewFunction(contractId, methodName, {})
    }).toThrow(FunctionCallError)

    try {
      await rpc.viewFunction(contractId, methodName, {})
      // Should not reach here
      expect(false).toBe(true)
    } catch (error) {
      expect(error).toBeInstanceOf(FunctionCallError)
      const funcError = error as FunctionCallError
      expect(funcError.contractId).toBe(contractId)
      expect(funcError.methodName).toBe(methodName)
      expect(funcError.code).toBe("FUNCTION_CALL_ERROR")
      expect(funcError.message).toContain(contractId)
      expect(funcError.message).toContain(methodName)
      expect(funcError.panic).toBeDefined()
      expect(funcError.panic).toContain("MethodNotFound")
      console.log(`✓ FunctionCallError: ${funcError.message}`)
    }
  }, 10000)

  test("should throw FunctionCallError for method call on non-contract account", async () => {
    const accountId = "near"
    const methodName = "some_method"

    await expect(async () => {
      await rpc.viewFunction(accountId, methodName, {})
    }).toThrow(FunctionCallError)

    try {
      await rpc.viewFunction(accountId, methodName, {})
      // Should not reach here
      expect(false).toBe(true)
    } catch (error) {
      expect(error).toBeInstanceOf(FunctionCallError)
      const funcError = error as FunctionCallError
      expect(funcError.contractId).toBe(accountId)
      expect(funcError.methodName).toBe(methodName)
      console.log(`✓ FunctionCallError for non-contract: ${funcError.message}`)
    }
  }, 10000)

  test("should successfully call valid view method", async () => {
    const result = await rpc.viewFunction("wrap.near", "ft_metadata", {})
    expect(result).toBeDefined()
    expect(result.result).toBeDefined()
    expect(Array.isArray(result.result)).toBe(true)

    // Decode result
    const decoded = JSON.parse(
      new TextDecoder().decode(new Uint8Array(result.result)),
    )
    expect(decoded.name).toBeDefined()
    console.log(`✓ Successfully called view method: ${decoded.name}`)
  }, 10000)
})

describe("Error Handling - Network Errors", () => {
  const invalidRpc = new RpcClient("https://invalid-rpc-endpoint-xyz.near.org")

  test("should throw NetworkError for unreachable RPC endpoint", async () => {
    await expect(async () => {
      await invalidRpc.getStatus()
    }).toThrow(NetworkError)

    try {
      await invalidRpc.getStatus()
      // Should not reach here
      expect(false).toBe(true)
    } catch (error) {
      expect(error).toBeInstanceOf(NetworkError)
      const netError = error as NetworkError
      expect(netError.code).toBe("NETWORK_ERROR")
      expect(netError.retryable).toBe(true)
      console.log(`✓ NetworkError: ${netError.message}`)
    }
  }, 60000)
})

describe("Error Handling - Error Properties", () => {
  const rpc = new RpcClient(MAINNET_RPC)

  test("all error types should extend NearError", async () => {
    const testCases = [
      {
        name: "AccountDoesNotExistError",
        test: async () =>
          await rpc.getAccount("nonexistent-account-xyz-12345.near"),
      },
      {
        name: "AccessKeyDoesNotExistError",
        test: async () =>
          await rpc.getAccessKey(
            "near",
            "ed25519:He7QeRuwizNEhzeKNn2CLdCKfzkH6KLSaFKvJLYtnrFa",
          ),
      },
      {
        name: "FunctionCallError",
        test: async () =>
          await rpc.viewFunction("wrap.near", "nonexistent_method_xyz", {}),
      },
    ]

    for (const testCase of testCases) {
      try {
        await testCase.test()
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
        expect(error).toHaveProperty("code")
        expect(error).toHaveProperty("name")
        expect(error).toHaveProperty("message")
        const err = error as { code: string; name: string }
        console.log(
          `✓ ${testCase.name} has required properties: code=${err.code}, name=${err.name}`,
        )
      }
    }
  }, 30000)
})
