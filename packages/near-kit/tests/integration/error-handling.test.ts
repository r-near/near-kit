/**
 * Integration tests for typed error handling
 *
 * Tests various error scenarios to ensure proper typed errors are thrown.
 * Runs against a local Sandbox (deterministic) rather than live public RPC.
 */

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { Near } from "../../src/core/near.js"
import { RpcClient } from "../../src/core/rpc/rpc.js"
import {
  AccessKeyDoesNotExistError,
  AccountDoesNotExistError,
  FunctionCallError,
  NetworkError,
} from "../../src/errors/index.js"
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

  // Deploy guestbook contract so view-method scenarios have a real contract.
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

describe("Error Handling - Account Errors", () => {
  test("should throw AccountDoesNotExistError for non-existent account", async () => {
    const nonExistentAccount = `nope-${Date.now()}.${sandbox.rootAccount.id}`

    await expect(async () => {
      await rpc.getAccount(nonExistentAccount)
    }).rejects.toThrow(AccountDoesNotExistError)

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
  })

  test("should successfully get existing account", async () => {
    const account = await rpc.getAccount(sandbox.rootAccount.id)
    expect(account).toBeDefined()
    expect(account.amount).toBeDefined()
    expect(account.storage_usage).toBeGreaterThanOrEqual(0)
    console.log(`✓ Successfully retrieved account '${sandbox.rootAccount.id}'`)
  })
})

describe("Error Handling - Access Key Errors", () => {
  test("should throw AccessKeyDoesNotExistError for non-existent access key", async () => {
    const accountId = sandbox.rootAccount.id
    const fakePublicKey = "ed25519:He7QeRuwizNEhzeKNn2CLdCKfzkH6KLSaFKvJLYtnrFa"

    await expect(async () => {
      await rpc.getAccessKey(accountId, fakePublicKey)
    }).rejects.toThrow(AccessKeyDoesNotExistError)

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
  })

  test("should successfully get existing access key", async () => {
    // First get the list of access keys for the root account
    const accountId = sandbox.rootAccount.id
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
  })
})

describe("Error Handling - Function Call Errors", () => {
  test("should throw FunctionCallError for non-existent method", async () => {
    const methodName = "this_method_does_not_exist_xyz"

    await expect(async () => {
      await rpc.viewFunction(contractId, methodName, {})
    }).rejects.toThrow(FunctionCallError)

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
  })

  test("should throw FunctionCallError for method call on non-contract account", async () => {
    // The sandbox root account has no contract deployed.
    const accountId = sandbox.rootAccount.id
    const methodName = "some_method"

    await expect(async () => {
      await rpc.viewFunction(accountId, methodName, {})
    }).rejects.toThrow(FunctionCallError)

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
  })

  test("should successfully call valid view method", async () => {
    const result = await rpc.viewFunction(contractId, "total_messages", {})
    expect(result).toBeDefined()
    expect(result.result).toBeDefined()
    expect(Array.isArray(result.result)).toBe(true)

    // Decode result - total_messages() returns a number.
    const decoded = JSON.parse(
      new TextDecoder().decode(new Uint8Array(result.result)),
    )
    expect(typeof decoded).toBe("number")
    expect(decoded).toBe(0)
    console.log(`✓ Successfully called view method: total_messages=${decoded}`)
  })
})

describe("Error Handling - Network Errors", () => {
  // Deterministically-unreachable local endpoint (connection refused, instant).
  const invalidRpc = new RpcClient("http://127.0.0.1:1")

  test("should throw NetworkError for unreachable RPC endpoint", async () => {
    await expect(async () => {
      await invalidRpc.getStatus()
    }).rejects.toThrow(NetworkError)

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
  })
})

describe("Error Handling - Error Properties", () => {
  test("all error types should extend NearError", async () => {
    const testCases = [
      {
        name: "AccountDoesNotExistError",
        test: async () =>
          await rpc.getAccount(`nope-${Date.now()}.${sandbox.rootAccount.id}`),
      },
      {
        name: "AccessKeyDoesNotExistError",
        test: async () =>
          await rpc.getAccessKey(
            sandbox.rootAccount.id,
            "ed25519:He7QeRuwizNEhzeKNn2CLdCKfzkH6KLSaFKvJLYtnrFa",
          ),
      },
      {
        name: "FunctionCallError",
        test: async () =>
          await rpc.viewFunction(contractId, "nonexistent_method_xyz", {}),
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
  })
})
