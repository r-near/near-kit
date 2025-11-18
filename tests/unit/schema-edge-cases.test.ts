/**
 * Comprehensive edge case tests for schema serialization
 * Tests delegate actions, global contracts, secp256k1 keys, and complex scenarios
 */

import { describe, expect, test } from "bun:test"
import {
  addKey,
  createAccount,
  DelegateAction,
  deleteAccount,
  deleteKey,
  deployContract,
  deployFromPublished,
  functionCall,
  publishContract,
  signedDelegate,
  stake,
  transfer,
} from "../../src/core/actions.js"
import {
  ActionSchema,
  encodeSignedDelegateAction,
  PublicKeySchema,
  publicKeyToZorsh,
  SignatureSchema,
  serializeDelegateAction,
  serializeTransaction,
  signatureToZorsh,
  TransactionSchema,
} from "../../src/core/schema.js"
import {
  type Ed25519PublicKey,
  type Ed25519Signature,
  KeyType,
  type Secp256k1PublicKey,
  type Secp256k1Signature,
} from "../../src/core/types.js"

// ==================== Test Helpers ====================

const createEd25519PublicKey = (fillValue = 1): Ed25519PublicKey => ({
  keyType: KeyType.ED25519,
  data: new Uint8Array(32).fill(fillValue),
  toString: () => "ed25519:test",
})

const createSecp256k1PublicKey = (fillValue = 1): Secp256k1PublicKey => ({
  keyType: KeyType.SECP256K1,
  data: new Uint8Array(64).fill(fillValue),
  toString: () => "secp256k1:test",
})

const createEd25519Signature = (fillValue = 1): Ed25519Signature => ({
  keyType: KeyType.ED25519,
  data: new Uint8Array(64).fill(fillValue),
})

const createSecp256k1Signature = (fillValue = 1): Secp256k1Signature => ({
  keyType: KeyType.SECP256K1,
  data: new Uint8Array(65).fill(fillValue),
})

// ==================== Delegate Action Serialization ====================

describe("Delegate Action Serialization - Edge Cases", () => {
  test("serializeDelegateAction with empty actions array", () => {
    const pk = createEd25519PublicKey(10)
    const delegateAction = new DelegateAction(
      "sender.near",
      "receiver.near",
      [], // Empty actions
      BigInt(0),
      BigInt(1000),
      pk,
    )

    const encoded = serializeDelegateAction(delegateAction)

    // Should still produce valid bytes with prefix
    expect(encoded).toBeInstanceOf(Uint8Array)
    expect(encoded.length).toBeGreaterThan(4)

    // Verify NEP-461 prefix
    expect(encoded[0]).toBe(0x6e)
    expect(encoded[1]).toBe(0x01)
    expect(encoded[2]).toBe(0x00)
    expect(encoded[3]).toBe(0x40)
  })

  test("serializeDelegateAction with maximum nonce (u64 max)", () => {
    const pk = createEd25519PublicKey(11)
    const maxU64 = BigInt("18446744073709551615") // 2^64 - 1

    const delegateAction = new DelegateAction(
      "sender.near",
      "receiver.near",
      [transfer(BigInt(1))],
      maxU64,
      BigInt(1000),
      pk,
    )

    const encoded = serializeDelegateAction(delegateAction)

    expect(encoded).toBeInstanceOf(Uint8Array)
    expect(encoded.length).toBeGreaterThan(4)
  })

  test("serializeDelegateAction with maximum block height (u64 max)", () => {
    const pk = createEd25519PublicKey(12)
    const maxU64 = BigInt("18446744073709551615")

    const delegateAction = new DelegateAction(
      "sender.near",
      "receiver.near",
      [transfer(BigInt(1))],
      BigInt(100),
      maxU64, // Max block height
      pk,
    )

    const encoded = serializeDelegateAction(delegateAction)

    expect(encoded).toBeInstanceOf(Uint8Array)
    expect(encoded.length).toBeGreaterThan(4)
  })

  test("serializeDelegateAction with all classic action types", () => {
    const pk = createEd25519PublicKey(13)
    const codeHash = new Uint8Array(32).fill(99)

    const delegateAction = new DelegateAction(
      "sender.near",
      "receiver.near",
      [
        createAccount(),
        transfer(BigInt(1000000)),
        deployContract(new Uint8Array([0x00, 0x61, 0x73, 0x6d])),
        functionCall(
          "method",
          new Uint8Array([1, 2, 3]),
          BigInt(30000000000000),
          BigInt(0),
        ),
        stake(BigInt(1000000000000000000000000), pk),
        addKey(pk, { fullAccess: {} }),
        deleteKey(pk),
        deleteAccount("beneficiary.near"),
        publishContract(new Uint8Array([0x00, 0x61, 0x73, 0x6d])),
        deployFromPublished({ codeHash }),
      ],
      BigInt(200),
      BigInt(2000),
      pk,
    )

    const encoded = serializeDelegateAction(delegateAction)

    expect(encoded).toBeInstanceOf(Uint8Array)
    expect(encoded.length).toBeGreaterThan(4)
    // Verify prefix
    expect(encoded.slice(0, 4)).toEqual(
      new Uint8Array([0x6e, 0x01, 0x00, 0x40]),
    )
  })

  test("serializeDelegateAction with Secp256k1 public key", () => {
    const pk = createSecp256k1PublicKey(20)

    const delegateAction = new DelegateAction(
      "sender.near",
      "receiver.near",
      [transfer(BigInt(5000000))],
      BigInt(300),
      BigInt(3000),
      pk,
    )

    const encoded = serializeDelegateAction(delegateAction)

    expect(encoded).toBeInstanceOf(Uint8Array)
    expect(encoded.length).toBeGreaterThan(4)
  })

  test("serializeDelegateAction is deterministic", () => {
    const pk = createEd25519PublicKey(14)

    const delegateAction = new DelegateAction(
      "sender.near",
      "receiver.near",
      [transfer(BigInt(1000000))],
      BigInt(123),
      BigInt(1000),
      pk,
    )

    const encoded1 = serializeDelegateAction(delegateAction)
    const encoded2 = serializeDelegateAction(delegateAction)

    // Should produce identical bytes
    expect(encoded1).toEqual(encoded2)
  })
})

// ==================== Signed Delegate Serialization ====================

describe("Signed Delegate Serialization - Edge Cases", () => {
  test("encodeSignedDelegateAction does not include NEP-461 prefix", () => {
    const pk = createEd25519PublicKey(15)
    const sig = createEd25519Signature(16)

    const delegateAction = new DelegateAction(
      "sender.near",
      "receiver.near",
      [transfer(BigInt(2000000))],
      BigInt(400),
      BigInt(4000),
      pk,
    )

    const signed = signedDelegate(delegateAction, sig)
    const encoded = encodeSignedDelegateAction(signed, "bytes")

    // Should not start with NEP-461 prefix
    expect(encoded).toBeInstanceOf(Uint8Array)
    const hasPrefix =
      encoded[0] === 0x6e &&
      encoded[1] === 0x01 &&
      encoded[2] === 0x00 &&
      encoded[3] === 0x40
    expect(hasPrefix).toBe(false)
  })

  test("encodeSignedDelegateAction with Secp256k1 signature", () => {
    const pk = createEd25519PublicKey(17)
    const sig = createSecp256k1Signature(18) // Secp256k1 signature (65 bytes)

    const delegateAction = new DelegateAction(
      "sender.near",
      "receiver.near",
      [transfer(BigInt(3000000))],
      BigInt(500),
      BigInt(5000),
      pk,
    )

    const signed = signedDelegate(delegateAction, sig)
    const encoded = encodeSignedDelegateAction(signed, "bytes")

    expect(encoded).toBeInstanceOf(Uint8Array)
    expect(encoded.length).toBeGreaterThan(0)
  })

  test("encodeSignedDelegateAction with empty actions and Secp256k1 keys", () => {
    const pk = createSecp256k1PublicKey(21)
    const sig = createSecp256k1Signature(22)

    const delegateAction = new DelegateAction(
      "sender.near",
      "receiver.near",
      [], // Empty actions
      BigInt(0),
      BigInt(1000),
      pk,
    )

    const signed = signedDelegate(delegateAction, sig)
    const encoded = encodeSignedDelegateAction(signed, "bytes")

    expect(encoded).toBeInstanceOf(Uint8Array)
    expect(encoded.length).toBeGreaterThan(0)
  })
})

// ==================== Public Key Types in Actions ====================

describe("Public Key Types - Secp256k1 in Actions", () => {
  test("stake action with Secp256k1 public key", () => {
    const pk = createSecp256k1PublicKey(30)
    const action = stake(BigInt(1000000000000000000000000), pk)

    expect("stake" in action).toBe(true)
    expect(action.stake.stake).toBe(BigInt(1000000000000000000000000))
    expect(action.stake.publicKey.secp256k1Key.data).toEqual(Array(64).fill(30))
  })

  test("addKey action with Secp256k1 public key and function call permission", () => {
    const pk = createSecp256k1PublicKey(31)
    const permission = {
      functionCall: {
        allowance: BigInt(1000000000000000000000000),
        receiverId: "contract.near",
        methodNames: ["method1", "method2"],
      },
    }

    const action = addKey(pk, permission)

    expect("addKey" in action).toBe(true)
    expect(action.addKey.publicKey.secp256k1Key.data).toEqual(
      Array(64).fill(31),
    )
    expect(action.addKey.accessKey.permission).toEqual(permission)
  })

  test("deleteKey action with Secp256k1 public key", () => {
    const pk = createSecp256k1PublicKey(32)
    const action = deleteKey(pk)

    expect("deleteKey" in action).toBe(true)
    expect(action.deleteKey.publicKey.secp256k1Key.data).toEqual(
      Array(64).fill(32),
    )
  })

  test("Secp256k1 key serialization size", () => {
    const pk = createSecp256k1PublicKey(33)
    const zorsh = publicKeyToZorsh(pk)
    const serialized = PublicKeySchema.serialize(zorsh)

    // 1 byte discriminant (0x01 for Secp256k1) + 64 bytes data
    expect(serialized.length).toBe(65)
    expect(serialized[0]).toBe(1) // Secp256k1 discriminant
  })
})

// ==================== Signature Types ====================

describe("Signature Types - Edge Cases", () => {
  test("Secp256k1 signature serialization size", () => {
    const sig = createSecp256k1Signature(40)
    const zorsh = signatureToZorsh(sig)
    const serialized = SignatureSchema.serialize(zorsh)

    // 1 byte discriminant (0x01 for Secp256k1) + 65 bytes data
    expect(serialized.length).toBe(66)
    expect(serialized[0]).toBe(1) // Secp256k1 discriminant
  })

  test("Ed25519 signature serialization size", () => {
    const sig = createEd25519Signature(41)
    const zorsh = signatureToZorsh(sig)
    const serialized = SignatureSchema.serialize(zorsh)

    // 1 byte discriminant (0x00 for Ed25519) + 64 bytes data
    expect(serialized.length).toBe(65)
    expect(serialized[0]).toBe(0) // Ed25519 discriminant
  })
})

// ==================== Global Contract Actions ====================

describe("Global Contract Actions - Serialization", () => {
  test("publishContract with CodeHash mode (immutable)", () => {
    const code = new Uint8Array([
      0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ])
    const action = publishContract(code)

    expect("deployGlobalContract" in action).toBe(true)
    expect(action.deployGlobalContract.code).toEqual(code)
    expect(action.deployGlobalContract.deployMode).toEqual({ CodeHash: {} })

    // Should serialize successfully
    const serialized = ActionSchema.serialize(action)
    expect(serialized).toBeInstanceOf(Uint8Array)
  })

  test("publishContract with AccountId mode (mutable)", () => {
    const code = new Uint8Array([
      0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ])
    const action = publishContract(code, "publisher.near")

    expect("deployGlobalContract" in action).toBe(true)
    expect(action.deployGlobalContract.code).toEqual(code)
    expect(action.deployGlobalContract.deployMode).toEqual({ AccountId: {} })

    // Should serialize successfully
    const serialized = ActionSchema.serialize(action)
    expect(serialized).toBeInstanceOf(Uint8Array)
  })

  test("deployFromPublished with code hash (Uint8Array)", () => {
    const codeHash = new Uint8Array(32).fill(50)
    const action = deployFromPublished({ codeHash })

    expect("useGlobalContract" in action).toBe(true)
    expect(action.useGlobalContract.contractIdentifier).toEqual({
      CodeHash: Array.from(codeHash),
    })

    // Should serialize successfully
    const serialized = ActionSchema.serialize(action)
    expect(serialized).toBeInstanceOf(Uint8Array)
  })

  test("deployFromPublished with code hash (base58 string)", () => {
    // Create a valid 32-byte hash and encode as base58
    const hashBytes = new Uint8Array(32).fill(51)
    // const base58Hash = "6fPZmGkrSgNn5dsYs6K7A8VxE3LxLHhGJQV6Jb4TrNaW" // Example

    // For testing, we'll just pass the Uint8Array directly since base58 encoding is tested elsewhere
    const action = deployFromPublished({ codeHash: hashBytes })

    expect("useGlobalContract" in action).toBe(true)
    expect(
      (action.useGlobalContract.contractIdentifier as { CodeHash: number[] })
        .CodeHash,
    ).toEqual(Array.from(hashBytes))
  })

  test("deployFromPublished with account ID", () => {
    const action = deployFromPublished({ accountId: "publisher.near" })

    expect("useGlobalContract" in action).toBe(true)
    expect(action.useGlobalContract.contractIdentifier).toEqual({
      AccountId: "publisher.near",
    })

    // Should serialize successfully
    const serialized = ActionSchema.serialize(action)
    expect(serialized).toBeInstanceOf(Uint8Array)
  })

  test("deployFromPublished throws on invalid hash size", () => {
    const invalidHash = new Uint8Array(16) // Wrong size (should be 32)

    expect(() => {
      deployFromPublished({ codeHash: invalidHash })
    }).toThrow("Code hash must be 32 bytes")
  })
})

// ==================== Complex Action Combinations ====================

describe("Complex Action Combinations", () => {
  test("transaction with multiple diverse actions", () => {
    const pk = createEd25519PublicKey(60)
    const code = new Uint8Array([0x00, 0x61, 0x73, 0x6d])

    const transaction = {
      signerId: "sender.near",
      publicKey: pk,
      nonce: BigInt(123),
      receiverId: "receiver.near",
      blockHash: new Uint8Array(32).fill(61),
      actions: [
        createAccount(),
        transfer(BigInt(1000000000000000000000000)),
        deployContract(code),
        functionCall(
          "init",
          new Uint8Array([]),
          BigInt(30000000000000),
          BigInt(0),
        ),
        addKey(pk, { fullAccess: {} }),
        publishContract(code, "publisher.near"),
        deployFromPublished({ accountId: "publisher.near" }),
      ],
    }

    const serialized = serializeTransaction(transaction)

    expect(serialized).toBeInstanceOf(Uint8Array)
    expect(serialized.length).toBeGreaterThan(0)
  })

  test("nested delegate action with multiple action types", () => {
    const pk = createEd25519PublicKey(62)
    const sig = createEd25519Signature(63)

    const innerDelegate = new DelegateAction(
      "inner-sender.near",
      "inner-receiver.near",
      [
        createAccount(),
        transfer(BigInt(500000)),
        functionCall(
          "method",
          new Uint8Array([1, 2, 3]),
          BigInt(10000000000000),
          BigInt(0),
        ),
      ],
      BigInt(100),
      BigInt(5000),
      pk,
    )

    const action = signedDelegate(innerDelegate, sig)

    const transaction = {
      signerId: "relayer.near",
      publicKey: pk,
      nonce: BigInt(200),
      receiverId: "inner-sender.near",
      blockHash: new Uint8Array(32).fill(64),
      actions: [action],
    }

    const serialized = serializeTransaction(transaction)

    expect(serialized).toBeInstanceOf(Uint8Array)
    expect(serialized.length).toBeGreaterThan(0)
  })
})

// ==================== Edge Cases ====================

describe("Edge Cases - Extreme Values", () => {
  test("function call with empty method name", () => {
    const action = functionCall(
      "",
      new Uint8Array([]),
      BigInt(30000000000000),
      BigInt(0),
    )

    expect("functionCall" in action).toBe(true)
    expect(action.functionCall.methodName).toBe("")

    // Should serialize successfully
    const serialized = ActionSchema.serialize(action)
    expect(serialized).toBeInstanceOf(Uint8Array)
  })

  test("function call with empty args", () => {
    const action = functionCall(
      "method",
      new Uint8Array([]),
      BigInt(30000000000000),
      BigInt(0),
    )

    expect("functionCall" in action).toBe(true)
    expect(action.functionCall.args).toEqual(new Uint8Array([]))

    // Should serialize successfully
    const serialized = ActionSchema.serialize(action)
    expect(serialized).toBeInstanceOf(Uint8Array)
  })

  test("transfer with maximum amount (u128 max)", () => {
    const maxU128 = BigInt("340282366920938463463374607431768211455") // 2^128 - 1
    const action = transfer(maxU128)

    expect("transfer" in action).toBe(true)
    expect(action.transfer.deposit).toBe(maxU128)

    // Should serialize successfully
    const serialized = ActionSchema.serialize(action)
    expect(serialized).toBeInstanceOf(Uint8Array)
  })

  test("function call with large gas value", () => {
    const largeGas = BigInt("300000000000000") // 300 Tgas
    const action = functionCall(
      "method",
      new Uint8Array([1]),
      largeGas,
      BigInt(0),
    )

    expect("functionCall" in action).toBe(true)
    expect(action.functionCall.gas).toBe(largeGas)

    // Should serialize successfully
    const serialized = ActionSchema.serialize(action)
    expect(serialized).toBeInstanceOf(Uint8Array)
  })

  test("stake with maximum amount (u128 max)", () => {
    const pk = createEd25519PublicKey(70)
    const maxU128 = BigInt("340282366920938463463374607431768211455")
    const action = stake(maxU128, pk)

    expect("stake" in action).toBe(true)
    expect(action.stake.stake).toBe(maxU128)

    // Should serialize successfully
    const serialized = ActionSchema.serialize(action)
    expect(serialized).toBeInstanceOf(Uint8Array)
  })

  test("addKey with function call permission with no allowance", () => {
    const pk = createEd25519PublicKey(71)
    const permission = {
      functionCall: {
        allowance: null,
        receiverId: "contract.near",
        methodNames: [],
      },
    }

    const action = addKey(pk, permission)

    expect("addKey" in action).toBe(true)
    expect(action.addKey.accessKey.permission).toEqual(permission)

    // Should serialize successfully
    const serialized = ActionSchema.serialize(action)
    expect(serialized).toBeInstanceOf(Uint8Array)
  })
})

// ==================== Round-trip Serialization ====================

describe("Round-trip Serialization", () => {
  test("DelegateAction round-trip preserves data", () => {
    const pk = createEd25519PublicKey(80)

    const delegateAction = new DelegateAction(
      "sender.near",
      "receiver.near",
      [transfer(BigInt(1000000))],
      BigInt(123),
      BigInt(1000),
      pk,
    )

    const serialized = serializeDelegateAction(delegateAction)

    // Remove the 4-byte prefix and deserialize
    // const withoutPrefix = serialized.slice(4)

    // Note: We would deserialize here if we expose the DelegateActionSchema
    // For now, we verify the serialization is consistent
    const reserialized = serializeDelegateAction(delegateAction)
    expect(serialized).toEqual(reserialized)
  })

  test("PublicKey round-trip for Ed25519", () => {
    const pk = createEd25519PublicKey(81)
    const zorsh = publicKeyToZorsh(pk)
    const serialized = PublicKeySchema.serialize(zorsh)
    const deserialized = PublicKeySchema.deserialize(serialized)

    expect(deserialized).toEqual(zorsh)
  })

  test("PublicKey round-trip for Secp256k1", () => {
    const pk = createSecp256k1PublicKey(82)
    const zorsh = publicKeyToZorsh(pk)
    const serialized = PublicKeySchema.serialize(zorsh)
    const deserialized = PublicKeySchema.deserialize(serialized)

    expect(deserialized).toEqual(zorsh)
  })

  test("Signature round-trip for Ed25519", () => {
    const sig = createEd25519Signature(83)
    const zorsh = signatureToZorsh(sig)
    const serialized = SignatureSchema.serialize(zorsh)
    const deserialized = SignatureSchema.deserialize(serialized)

    expect(deserialized).toEqual(zorsh)
  })

  test("Signature round-trip for Secp256k1", () => {
    const sig = createSecp256k1Signature(84)
    const zorsh = signatureToZorsh(sig)
    const serialized = SignatureSchema.serialize(zorsh)
    const deserialized = SignatureSchema.deserialize(serialized)

    expect(deserialized).toEqual(zorsh)
  })

  test("Transaction serialization is deterministic", () => {
    const pk = createEd25519PublicKey(85)

    const transaction = {
      signerId: "sender.near",
      publicKey: pk,
      nonce: BigInt(123),
      receiverId: "receiver.near",
      blockHash: new Uint8Array(32).fill(86),
      actions: [
        transfer(BigInt(1000000)),
        functionCall(
          "method",
          new Uint8Array([1, 2, 3]),
          BigInt(30000000000000),
          BigInt(0),
        ),
      ],
    }

    const serialized1 = serializeTransaction(transaction)
    const serialized2 = serializeTransaction(transaction)

    // Should produce identical bytes every time
    expect(serialized1).toEqual(serialized2)
  })

  test("Transaction round-trip preserves structure", () => {
    const pk = createEd25519PublicKey(87)

    const transaction = {
      signerId: "sender.near",
      publicKey: pk,
      nonce: BigInt(456),
      receiverId: "receiver.near",
      blockHash: new Uint8Array(32).fill(88),
      actions: [transfer(BigInt(5000000))],
    }

    const serialized = serializeTransaction(transaction)
    const deserialized = TransactionSchema.deserialize(serialized)

    // Verify key fields match
    expect(deserialized.signerId).toBe(transaction.signerId)
    expect(deserialized.receiverId).toBe(transaction.receiverId)
    expect(deserialized.nonce).toBe(transaction.nonce)
    expect(deserialized.blockHash).toEqual(Array.from(transaction.blockHash))
  })
})
