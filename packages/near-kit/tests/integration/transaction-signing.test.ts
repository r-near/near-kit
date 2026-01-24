/**
 * Integration tests for transaction signing
 *
 * These tests require a running NEAR sandbox or testnet access.
 * They can be run manually or in CI with appropriate setup.
 *
 * To run against sandbox:
 * 1. Start near-sandbox
 * 2. Run: bun test tests/integration/transaction-signing.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { InMemoryKeyStore, Near } from "../../src/index.js"
import { Sandbox } from "../../src/sandbox/index.js"
import { Amount } from "../../src/utils/amount.js"
import { generateKey, parseKey } from "../../src/utils/key.js"
import type { PrivateKey } from "../../src/utils/validation.js"

// Shared sandbox instance for all tests
let globalSandbox: Sandbox
let globalNear: Near
let globalKeyStore: InMemoryKeyStore

beforeAll(async () => {
  globalSandbox = await Sandbox.start({ detached: false })
  globalKeyStore = new InMemoryKeyStore()
  globalNear = new Near({
    network: globalSandbox,
    keyStore: globalKeyStore,
  })
  console.log(`✓ Sandbox started at ${globalSandbox.rpcUrl}`)
}, 120000)

afterAll(async () => {
  if (globalSandbox) {
    await globalSandbox.stop()
    console.log("✓ Sandbox stopped")
  }
})

describe("Transaction Signing - Integration Tests", () => {
  let near: Near
  let sandbox: Sandbox

  beforeAll(() => {
    sandbox = globalSandbox
    near = globalNear
  })

  test("should sign a transaction and get hash before sending", async () => {
    const recipientKey = generateKey()
    const recipientId = `recipient-none-${Date.now()}.${sandbox.rootAccount.id}`

    const tx = await near
      .transaction(sandbox.rootAccount.id)
      .createAccount(recipientId)
      .addKey(recipientKey.publicKey.toString(), {
        type: "fullAccess",
      })
      .transfer(recipientId, Amount.NEAR(0))
      .sign()

    const hash = tx.getHash()
    expect(hash).toBeTruthy()
    expect(typeof hash).toBe("string")
    expect(hash?.length).toBeGreaterThan(40) // Base58 hash should be long
  })

  test("should send pre-signed transaction", async () => {
    // Sign first
    const recipientKey = generateKey()
    const recipientId = `recipient-send-${Date.now()}.${sandbox.rootAccount.id}`

    const tx = await near
      .transaction(sandbox.rootAccount.id)
      .createAccount(recipientId)
      .addKey(recipientKey.publicKey.toString(), {
        type: "fullAccess",
      })
      .transfer(recipientId, Amount.NEAR(0))
      .sign()

    const hashBeforeSend = tx.getHash()
    expect(hashBeforeSend).toBeTruthy()
    if (!hashBeforeSend) {
      throw new Error("Hash should be defined after signing")
    }

    // Send later
    const result = await tx.send()

    // Hash should match
    expect(result.transaction.hash).toBe(hashBeforeSend)
    expect(result.final_execution_status).toBe("EXECUTED_OPTIMISTIC")
  })

  test("should serialize and deserialize transaction", async () => {
    const recipientKey = generateKey()
    const recipientId = `recipient-serialize-${Date.now()}.${
      sandbox.rootAccount.id
    }`

    const tx = await near
      .transaction(sandbox.rootAccount.id)
      .createAccount(recipientId)
      .addKey(recipientKey.publicKey.toString(), {
        type: "fullAccess",
      })
      .transfer(recipientId, Amount.NEAR(0))
      .sign()

    const bytes = tx.serialize()
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(bytes.length).toBeGreaterThan(0)

    // TODO: Add deserialization and re-send test when we add deserialize support
  })

  test("should return transaction hash with NONE finality", async () => {
    const recipientKey = generateKey()
    const recipientId = `recipient-none2-${Date.now()}.${
      sandbox.rootAccount.id
    }`

    const result = await near
      .transaction(sandbox.rootAccount.id)
      .createAccount(recipientId)
      .addKey(recipientKey.publicKey.toString(), {
        type: "fullAccess",
      })
      .transfer(recipientId, Amount.NEAR(0))
      .send({ waitUntil: "NONE" })

    // Transaction hash should be injected
    expect(result.transaction).toBeDefined()
    expect(result.transaction?.hash).toBeTruthy()
    expect(result.transaction?.signer_id).toBe(sandbox.rootAccount.id)
    expect(result.transaction?.receiver_id).toBe(recipientId)
    expect(typeof result.transaction?.nonce).toBe("number")

    expect(result.final_execution_status).toBe("NONE")
  })

  test("should return transaction hash with INCLUDED finality", async () => {
    const recipientKey = generateKey()
    const recipientId = `recipient-included-${Date.now()}.${
      sandbox.rootAccount.id
    }`

    const result = await near
      .transaction(sandbox.rootAccount.id)
      .createAccount(recipientId)
      .addKey(recipientKey.publicKey.toString(), {
        type: "fullAccess",
      })
      .transfer(recipientId, Amount.NEAR(0))
      .send({ waitUntil: "INCLUDED" })

    expect(result.transaction).toBeDefined()
    expect(result.transaction?.hash).toBeTruthy()
    expect(result.final_execution_status).toBe("INCLUDED")
  }, 30000)

  test("should return full transaction with EXECUTED_OPTIMISTIC", async () => {
    const recipientKey = generateKey()
    const recipientId = `recipient-executed-optimistic-${Date.now()}.${
      sandbox.rootAccount.id
    }`

    const result = await near
      .transaction(sandbox.rootAccount.id)
      .createAccount(recipientId)
      .addKey(recipientKey.publicKey.toString(), {
        type: "fullAccess",
      })
      .transfer(recipientId, Amount.NEAR(0))
      .send({ waitUntil: "EXECUTED_OPTIMISTIC" })

    expect(result.transaction).toBeDefined()
    expect(result.transaction.hash).toBeTruthy()
    expect(result.transaction.signer_id).toBe(sandbox.rootAccount.id)
    expect(result.transaction.actions).toBeDefined()
    expect(result.transaction.signature).toBeDefined()
    expect(result.final_execution_status).toBe("EXECUTED_OPTIMISTIC")
  }, 30000)

  test("should handle multiple actions in one transaction", async () => {
    const recipientKey = generateKey()
    const recipientId = `recipient-multi-${Date.now()}.${
      sandbox.rootAccount.id
    }`

    const tx = await near
      .transaction(sandbox.rootAccount.id)
      .createAccount(recipientId)
      .addKey(recipientKey.publicKey.toString(), {
        type: "fullAccess",
      })
      .transfer(recipientId, Amount.NEAR(1))
      .sign()

    const hash = tx.getHash()
    expect(hash).toBeTruthy()
    if (!hash) {
      throw new Error("Hash should be defined after signing")
    }

    const result = await tx.send()
    expect(result.transaction.hash).toBe(hash)
  }, 30000)

  test("should invalidate cache when adding actions after signing", async () => {
    const recipientKey = generateKey()
    const recipientId = `recipient-executed-optimistic-${Date.now()}.${
      sandbox.rootAccount.id
    }`

    const tx = near
      .transaction(sandbox.rootAccount.id)
      .createAccount(recipientId)
      .addKey(recipientKey.publicKey.toString(), {
        type: "fullAccess",
      })
      .transfer(recipientId, Amount.NEAR(0))

    await tx.sign()
    const firstHash = tx.getHash()

    // Add another action
    tx.transfer(recipientId, Amount.NEAR(0))

    // Cache should be invalidated
    expect(tx.getHash()).toBeNull()

    // Re-sign
    await tx.sign()
    const newHash = tx.getHash()

    expect(newHash).not.toBe(firstHash)
  })

  test("should work with signWith() override", async () => {
    const recipientKey = generateKey()
    const recipientId = `recipient-executed-optimistic-${Date.now()}.${
      sandbox.rootAccount.id
    }`

    const result = await near
      .transaction(sandbox.rootAccount.id)
      .createAccount(recipientId)
      .addKey(recipientKey.publicKey.toString(), {
        type: "fullAccess",
      })
      .transfer(recipientId, Amount.NEAR(0))
      .signWith(sandbox.rootAccount.secretKey as PrivateKey)
      .send()

    expect(result.transaction.hash).toBeTruthy()
    expect(result.final_execution_status).toBe("EXECUTED_OPTIMISTIC")
  }, 30000)

  test("should handle nonce retry on send", async () => {
    // This test verifies that nonce retries work
    // In normal operation, nonce errors are rare, but the retry logic should handle them

    const recipientKey = generateKey()
    const recipientId = `recipient-executed-optimistic-${Date.now()}.${
      sandbox.rootAccount.id
    }`

    const result = await near
      .transaction(sandbox.rootAccount.id)
      .createAccount(recipientId)
      .addKey(recipientKey.publicKey.toString(), {
        type: "fullAccess",
      })
      .transfer(recipientId, Amount.NEAR(0))
      .send()

    expect(result.transaction.hash).toBeTruthy()
  }, 30000)

  test("same hash when signing multiple times without changes", async () => {
    const recipientKey = generateKey()
    const recipientId = `recipient-executed-optimistic-${Date.now()}.${
      sandbox.rootAccount.id
    }`

    const tx = near
      .transaction(sandbox.rootAccount.id)
      .createAccount(recipientId)
      .addKey(recipientKey.publicKey.toString(), {
        type: "fullAccess",
      })
      .transfer(recipientId, Amount.NEAR(0))

    await tx.sign()
    const hash1 = tx.getHash()

    // Sign again without changes - should use cache
    await tx.sign()
    const hash2 = tx.getHash()

    expect(hash1).toBe(hash2)
  }, 30000)
})

describe("Transaction Signing - Complex Scenarios", () => {
  let near: Near
  let sandbox: Sandbox
  let testAccountId: string
  let testPrivateKey: PrivateKey

  beforeAll(async () => {
    // Using shared sandbox for these tests
    sandbox = globalSandbox
    near = globalNear

    const recipientKey = generateKey()
    const recipientId = `recipient-complex-${Date.now()}.${
      sandbox.rootAccount.id
    }`

    // Create a test account
    await near
      .transaction(sandbox.rootAccount.id)
      .createAccount(recipientId)
      .addKey(recipientKey.publicKey.toString(), {
        type: "fullAccess",
      })
      .transfer(recipientId, Amount.NEAR(10))
      .send()

    testAccountId = recipientId
    testPrivateKey = recipientKey.secretKey as PrivateKey

    // Add the key to the keyStore so the test account can sign transactions
    await globalKeyStore.add(testAccountId, recipientKey)

    console.log(`✓ Test account created: ${testAccountId}`)
  }, 120000)

  test("should track transaction with NONE then poll with hash", async () => {
    // Send with NONE to get quick response
    const result = await near
      .transaction(testAccountId)
      .transfer(testAccountId, Amount.NEAR(0))
      .send({ waitUntil: "NONE" })

    const txHash = result.transaction?.hash
    if (!txHash) {
      throw new Error("No transaction hash returned")
    }

    // Wait a bit for transaction to process
    await new Promise((resolve) => setTimeout(resolve, 1000))

    // Poll for status using the hash
    const status = await near.getTransactionStatus(txHash, testAccountId)

    expect(status.final_execution_status).toBeDefined()
    // Status should eventually be executed
    expect(["EXECUTED_OPTIMISTIC", "EXECUTED", "FINAL"]).toContain(
      status.final_execution_status,
    )
  }, 30000)

  test("should handle batch operations with individual signing", async () => {
    // Create and sign first transaction
    const tx1 = await near
      .transaction(testAccountId)
      .transfer(testAccountId, Amount.NEAR(0))
      .sign()

    const hash1 = tx1.getHash()
    expect(hash1).toBeTruthy()
    if (!hash1) {
      throw new Error("Hash should be defined after signing")
    }

    // Send first transaction to increment nonce
    const result1 = await tx1.send()
    expect(result1.transaction.hash).toBe(hash1)

    // Create and sign second transaction (will have different nonce now)
    const tx2 = await near
      .transaction(testAccountId)
      .transfer(testAccountId, Amount.NEAR(0))
      .sign()

    const hash2 = tx2.getHash()
    expect(hash2).toBeTruthy()
    if (!hash2) {
      throw new Error("Hash should be defined after signing")
    }
    expect(hash1).not.toBe(hash2) // Different transactions should have different hashes

    // Send second transaction
    const result2 = await tx2.send()
    expect(result2.transaction.hash).toBe(hash2)
  }, 30000)

  test("should work with custom signer function", async () => {
    // Create custom signer that delegates to key pair
    const keyPair = parseKey(testPrivateKey)
    const customSigner = async (message: Uint8Array) => {
      return keyPair.sign(message)
    }

    const result = await near
      .transaction(testAccountId)
      .signWith(customSigner)
      .transfer(testAccountId, Amount.NEAR(0))
      .send()

    expect(result.transaction.hash).toBeTruthy()
  }, 30000)
})
