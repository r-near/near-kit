/**
 * Tests for transaction signing functionality
 */

import { describe, expect, test } from "vitest"
import { RpcClient } from "../../src/core/rpc/rpc.js"
import { TransactionBuilder } from "../../src/core/transaction.js"
import { InMemoryKeyStore } from "../../src/keys/index.js"
import { Amount } from "../../src/utils/amount.js"
import { parseKey } from "../../src/utils/key.js"

// Valid test keys
const TEST_PRIVATE_KEY =
  "ed25519:3D4YudUahN1nawWogh8pAKSj92sUNMdbZGjn7kERKzYoTy8oryFtvLGoBnu1J6N4qVWY9jXwfLiNWnaTzKkHNfqG"
const TEST_PUBLIC_KEY = "ed25519:DcA2MzgpJbrUATQLLceocVckhhAqrkingax4oJ9kZ847"

// Helper to create a transaction builder for testing with mocked RPC
function createBuilderWithMocks(): {
  builder: TransactionBuilder
  rpc: RpcClient
  keyStore: InMemoryKeyStore
} {
  const rpc = new RpcClient("https://rpc.testnet.fastnear.com")
  const keyStore = new InMemoryKeyStore()

  // Mock RPC methods to avoid network calls
  ;(rpc as unknown as Record<string, unknown>)["getAccessKey"] = async () => ({
    nonce: 100,
    permission: "FullAccess",
    block_height: 1000,
    block_hash: "11111111111111111111111111111111",
  })
  ;(rpc as unknown as Record<string, unknown>)["getStatus"] = async () => ({
    sync_info: {
      latest_block_hash: "GwVStJW8yLesiDA1Fhd7tkMx48ViJQBoTMBBLXa2YUhP",
    },
  })
  ;(rpc as unknown as Record<string, unknown>)["getBlock"] = async () => ({
    header: {
      hash: "GwVStJW8yLesiDA1Fhd7tkMx48ViJQBoTMBBLXa2YUhP",
      height: 12345,
    },
  })

  const builder = new TransactionBuilder("alice.near", rpc, keyStore)

  return { builder, rpc, keyStore }
}

describe("TransactionBuilder - .sign() method", () => {
  test("should sign a transaction and cache the result", async () => {
    const { builder, keyStore } = createBuilderWithMocks()

    // Add a key to the keyStore
    const keyPair = parseKey(TEST_PRIVATE_KEY)
    await keyStore.add("alice.near", keyPair)

    // Build and sign
    const signedBuilder = await builder
      .transfer("bob.near", Amount.NEAR(1))
      .sign()

    // Should return the same builder instance
    expect(signedBuilder).toBe(builder)

    // Should have a hash available
    const hash = signedBuilder.getHash()
    expect(hash).toBeTruthy()
    expect(typeof hash).toBe("string")
    expect(hash?.length).toBeGreaterThan(0)
  })

  test("should return cached result on second .sign() call", async () => {
    const { builder, keyStore } = createBuilderWithMocks()

    const keyPair = parseKey(TEST_PRIVATE_KEY)
    await keyStore.add("alice.near", keyPair)

    await builder.transfer("bob.near", Amount.NEAR(1)).sign()
    const firstHash = builder.getHash()

    // Sign again - should use cache
    await builder.sign()
    const secondHash = builder.getHash()

    expect(firstHash).toBe(secondHash)
  })

  test("should invalidate cache when adding actions", async () => {
    const { builder, keyStore } = createBuilderWithMocks()

    const keyPair = parseKey(TEST_PRIVATE_KEY)
    await keyStore.add("alice.near", keyPair)

    // Sign first transaction
    await builder.transfer("bob.near", Amount.NEAR(1)).sign()
    const firstHash = builder.getHash()

    // Add another action - should invalidate cache
    builder.transfer("carol.near", Amount.NEAR(2))
    const hashAfterAction = builder.getHash()

    // Hash should be null since cache was invalidated
    expect(hashAfterAction).toBeNull()

    // Re-sign with new actions
    await builder.sign()
    const newHash = builder.getHash()

    // New hash should be different
    expect(newHash).not.toBe(firstHash)
  })

  test("should invalidate cache for all action methods", async () => {
    const { builder, keyStore } = createBuilderWithMocks()

    const keyPair = parseKey(TEST_PRIVATE_KEY)
    await keyStore.add("alice.near", keyPair)

    // Sign
    await builder.transfer("bob.near", Amount.NEAR(1)).sign()
    expect(builder.getHash()).not.toBeNull()

    // Each action method should invalidate cache
    builder.functionCall("contract.near", "method", {})
    expect(builder.getHash()).toBeNull()

    await builder.sign()
    expect(builder.getHash()).not.toBeNull()

    builder.createAccount("new.near")
    expect(builder.getHash()).toBeNull()

    await builder.sign()
    expect(builder.getHash()).not.toBeNull()

    builder.deleteAccount({ beneficiary: "beneficiary.near" })
    expect(builder.getHash()).toBeNull()

    await builder.sign()
    expect(builder.getHash()).not.toBeNull()

    builder.deployContract("contract.near", new Uint8Array())
    expect(builder.getHash()).toBeNull()

    await builder.sign()
    expect(builder.getHash()).not.toBeNull()

    builder.stake(TEST_PUBLIC_KEY, Amount.NEAR(100))
    expect(builder.getHash()).toBeNull()

    await builder.sign()
    expect(builder.getHash()).not.toBeNull()

    builder.addKey(TEST_PUBLIC_KEY, { type: "fullAccess" })
    expect(builder.getHash()).toBeNull()

    await builder.sign()
    expect(builder.getHash()).not.toBeNull()

    builder.deleteKey("alice.near", TEST_PUBLIC_KEY)
    expect(builder.getHash()).toBeNull()
  })

  test("should invalidate cache when changing signer with signWith()", async () => {
    const { builder, keyStore } = createBuilderWithMocks()

    const keyPair = parseKey(TEST_PRIVATE_KEY)
    await keyStore.add("alice.near", keyPair)

    // Sign
    await builder.transfer("bob.near", Amount.NEAR(1)).sign()
    expect(builder.getHash()).toBeTruthy()

    // Change signer - should invalidate cache
    builder.signWith(TEST_PRIVATE_KEY)
    expect(builder.getHash()).toBeNull()

    // Re-sign
    await builder.sign()
    const newHash = builder.getHash()

    // Hash might be same or different depending on if key is same,
    // but important thing is cache was invalidated
    expect(newHash).toBeTruthy()
  })

  test("getHash() should return null before signing", () => {
    const { builder } = createBuilderWithMocks()

    builder.transfer("bob.near", Amount.NEAR(1))

    expect(builder.getHash()).toBeNull()
  })

  test("getHash() should return base58 string after signing", async () => {
    const { builder, keyStore } = createBuilderWithMocks()

    const keyPair = parseKey(TEST_PRIVATE_KEY)
    await keyStore.add("alice.near", keyPair)

    await builder.transfer("bob.near", Amount.NEAR(1)).sign()

    const hash = builder.getHash()
    expect(hash).toBeTruthy()
    expect(typeof hash).toBe("string")
    expect(hash?.length).toBeGreaterThan(40) // Base58 hashes are typically 44 chars
  })

  test("should throw error when signing without receiver", async () => {
    const { builder, keyStore } = createBuilderWithMocks()

    const keyPair = parseKey(TEST_PRIVATE_KEY)
    await keyStore.add("alice.near", keyPair)

    // Don't add any actions (no receiverId set)
    await expect(builder.sign()).rejects.toThrow("No receiver ID set")
  })

  test("should throw error when signing without key", async () => {
    const { builder } = createBuilderWithMocks()

    // Don't add key to keyStore
    builder.transfer("bob.near", Amount.NEAR(1))

    await expect(builder.sign()).rejects.toThrow("No key found")
  })
})

describe("TransactionBuilder - .serialize() method", () => {
  test("should serialize signed transaction to bytes", async () => {
    const { builder, keyStore } = createBuilderWithMocks()

    const keyPair = parseKey(TEST_PRIVATE_KEY)
    await keyStore.add("alice.near", keyPair)

    await builder.transfer("bob.near", Amount.NEAR(1)).sign()

    const bytes = builder.serialize()

    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(bytes.length).toBeGreaterThan(0)
  })

  test("should throw error when serializing before signing", () => {
    const { builder } = createBuilderWithMocks()

    builder.transfer("bob.near", Amount.NEAR(1))

    expect(() => builder.serialize()).toThrow(
      "Transaction must be signed before serializing",
    )
  })

  test("should throw error when serializing after cache invalidation", async () => {
    const { builder, keyStore } = createBuilderWithMocks()

    const keyPair = parseKey(TEST_PRIVATE_KEY)
    await keyStore.add("alice.near", keyPair)

    await builder.transfer("bob.near", Amount.NEAR(1)).sign()

    // Invalidate cache
    builder.transfer("carol.near", Amount.NEAR(2))

    // Should throw since cache was invalidated
    expect(() => builder.serialize()).toThrow(
      "Transaction must be signed before serializing",
    )
  })

  test("serialized bytes should be deterministic", async () => {
    const { builder, keyStore } = createBuilderWithMocks()

    const keyPair = parseKey(TEST_PRIVATE_KEY)
    await keyStore.add("alice.near", keyPair)

    await builder.transfer("bob.near", Amount.NEAR(1)).sign()

    const bytes1 = builder.serialize()
    const bytes2 = builder.serialize()

    // Multiple calls should return same bytes
    expect(bytes1).toEqual(bytes2)
  })
})

describe("TransactionBuilder - sign and send workflow", () => {
  test("should allow signing then sending later", async () => {
    const { builder, keyStore, rpc } = createBuilderWithMocks()

    const keyPair = parseKey(TEST_PRIVATE_KEY)
    await keyStore.add("alice.near", keyPair)

    // Mock sendTransaction
    let capturedHash: string | undefined
    ;(rpc as unknown as Record<string, unknown>)["sendTransaction"] = async (
      _bytes: Uint8Array,
      _waitUntil: string,
    ) => {
      return {
        final_execution_status: "EXECUTED_OPTIMISTIC",
        status: { SuccessValue: "" },
        transaction: {
          hash: capturedHash,
          signer_id: "alice.near",
          receiver_id: "bob.near",
          nonce: 101,
          public_key: TEST_PUBLIC_KEY,
          actions: [],
          signature: "sig...",
        },
        transaction_outcome: {
          id: "tx123",
          outcome: {
            logs: [],
            receipt_ids: [],
            gas_burnt: 1000000,
            tokens_burnt: "0",
            executor_id: "alice.near",
            status: { SuccessValue: "" },
          },
        },
        receipts_outcome: [],
      }
    }

    // Sign first
    await builder.transfer("bob.near", Amount.NEAR(1)).sign()
    const hash = builder.getHash()
    if (!hash) {
      throw new Error("Hash should be defined after signing")
    }
    capturedHash = hash

    // Send later
    const result = await builder.send()

    expect(result.transaction.hash).toBe(capturedHash)
  })

  test("should use cached signed tx when sending", async () => {
    const { builder, keyStore, rpc } = createBuilderWithMocks()

    const keyPair = parseKey(TEST_PRIVATE_KEY)
    await keyStore.add("alice.near", keyPair)

    let signCallCount = 0
    const originalSign = builder.sign.bind(builder)
    builder.sign = async () => {
      signCallCount++
      return originalSign()
    }

    // Mock sendTransaction
    ;(rpc as unknown as Record<string, unknown>)["sendTransaction"] =
      async () => ({
        final_execution_status: "EXECUTED_OPTIMISTIC",
        status: { SuccessValue: "" },
        transaction: {
          hash: "hash123",
          signer_id: "alice.near",
          receiver_id: "bob.near",
          nonce: 101,
          public_key: TEST_PUBLIC_KEY,
          actions: [],
          signature: "sig...",
        },
        transaction_outcome: {
          id: "tx123",
          outcome: {
            logs: [],
            receipt_ids: [],
            gas_burnt: 1000000,
            tokens_burnt: "0",
            executor_id: "alice.near",
            status: { SuccessValue: "" },
          },
        },
        receipts_outcome: [],
      })

    // Sign then send
    await builder.transfer("bob.near", Amount.NEAR(1)).sign()
    expect(signCallCount).toBe(1)

    await builder.send()
    // Should not sign again since we used cached tx
    expect(signCallCount).toBe(1)
  })
})

describe("TransactionBuilder - hash in NONE finality responses", () => {
  test("should inject transaction hash for NONE finality", async () => {
    const { builder, keyStore, rpc } = createBuilderWithMocks()

    const keyPair = parseKey(TEST_PRIVATE_KEY)
    await keyStore.add("alice.near", keyPair)

    // Mock sendTransaction to return NONE response
    ;(rpc as unknown as Record<string, unknown>)["sendTransaction"] =
      async () => ({
        final_execution_status: "NONE",
      })

    const result = await builder
      .transfer("bob.near", Amount.NEAR(1))
      .send({ waitUntil: "NONE" })

    // Should have injected transaction fields
    expect(result.transaction).toBeDefined()
    expect(result.transaction?.hash).toBeTruthy()
    expect(result.transaction?.signer_id).toBe("alice.near")
    expect(result.transaction?.receiver_id).toBe("bob.near")
    // Nonce should be > 100 (base nonce from mock)
    // Note: May be higher due to nonce manager caching across tests
    expect(result.transaction?.nonce).toBeGreaterThan(100)
  })

  test("should inject transaction hash for INCLUDED finality", async () => {
    const { builder, keyStore, rpc } = createBuilderWithMocks()

    const keyPair = parseKey(TEST_PRIVATE_KEY)
    await keyStore.add("alice.near", keyPair)

    ;(rpc as unknown as Record<string, unknown>)["sendTransaction"] =
      async () => ({
        final_execution_status: "INCLUDED",
      })

    const result = await builder
      .transfer("bob.near", Amount.NEAR(1))
      .send({ waitUntil: "INCLUDED" })

    expect(result.transaction).toBeDefined()
    expect(result.transaction?.hash).toBeTruthy()
    expect(result.transaction?.signer_id).toBe("alice.near")
    expect(result.transaction?.receiver_id).toBe("bob.near")
  })

  test("should inject transaction hash for INCLUDED_FINAL finality", async () => {
    const { builder, keyStore, rpc } = createBuilderWithMocks()

    const keyPair = parseKey(TEST_PRIVATE_KEY)
    await keyStore.add("alice.near", keyPair)

    ;(rpc as unknown as Record<string, unknown>)["sendTransaction"] =
      async () => ({
        final_execution_status: "INCLUDED_FINAL",
      })

    const result = await builder
      .transfer("bob.near", Amount.NEAR(1))
      .send({ waitUntil: "INCLUDED_FINAL" })

    expect(result.transaction).toBeDefined()
    expect(result.transaction?.hash).toBeTruthy()
  })

  test("should not override transaction for EXECUTED_OPTIMISTIC", async () => {
    const { builder, keyStore, rpc } = createBuilderWithMocks()

    const keyPair = parseKey(TEST_PRIVATE_KEY)
    await keyStore.add("alice.near", keyPair)

    const expectedHash = "rpc_provided_hash_123"
    ;(rpc as unknown as Record<string, unknown>)["sendTransaction"] =
      async () => ({
        final_execution_status: "EXECUTED_OPTIMISTIC",
        status: { SuccessValue: "" },
        transaction: {
          hash: expectedHash,
          signer_id: "alice.near",
          receiver_id: "bob.near",
          nonce: 101,
          public_key: TEST_PUBLIC_KEY,
          actions: [],
          signature: "sig...",
        },
        transaction_outcome: {
          id: "tx123",
          outcome: {
            logs: [],
            receipt_ids: [],
            gas_burnt: 1000000,
            tokens_burnt: "0",
            executor_id: "alice.near",
            status: { SuccessValue: "" },
          },
        },
        receipts_outcome: [],
      })

    const result = await builder
      .transfer("bob.near", Amount.NEAR(1))
      .send({ waitUntil: "EXECUTED_OPTIMISTIC" })

    // Should use RPC-provided hash, not inject
    expect(result.transaction.hash).toBe(expectedHash)
  })
})
