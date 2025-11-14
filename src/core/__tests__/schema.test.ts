/**
 * Tests for Borsh schema and action serialization
 */

import { describe, expect, test } from "bun:test"
import {
  addKey,
  createAccount,
  deleteAccount,
  deleteKey,
  deployContract,
  functionCall,
  stake,
  transfer,
} from "../actions.js"
import {
  type Action,
  ActionSchema,
  PublicKeySchema,
  publicKeyToZorsh,
  SignatureSchema,
  serializeTransaction,
  signatureToZorsh,
} from "../schema.js"
import {
  type Ed25519PublicKey,
  type Ed25519Signature,
  KeyType,
  type Secp256k1PublicKey,
  type Secp256k1Signature,
} from "../types.js"

describe("Action type inference", () => {
  test("Action type is inferred from schema", () => {
    // This test validates that the type system works correctly
    const action: Action = transfer(BigInt(100))

    // Should be a discriminated union
    if ("transfer" in action) {
      expect(action.transfer.deposit).toBe(BigInt(100))
    } else {
      throw new Error("Expected transfer action")
    }
  })

  test("Action helpers return schema-compatible shapes", () => {
    const transferAction = transfer(BigInt(1000000))
    expect("transfer" in transferAction).toBe(true)
    expect(transferAction.transfer.deposit).toBe(BigInt(1000000))

    const createAccountAction = createAccount()
    expect("createAccount" in createAccountAction).toBe(true)
    expect(createAccountAction.createAccount).toEqual({})
  })
})

describe("PublicKey conversion", () => {
  test("converts Ed25519 public key to zorsh format", () => {
    const pk: Ed25519PublicKey = {
      keyType: KeyType.ED25519,
      data: new Uint8Array(32).fill(1),
      toString: () => "ed25519:test",
    }

    const zorsh = publicKeyToZorsh(pk)
    // Type is narrowed to { ed25519Key: { data: number[] } }
    expect(zorsh.ed25519Key.data).toEqual(Array(32).fill(1))
  })

  test("converts Secp256k1 public key to zorsh format", () => {
    const pk: Secp256k1PublicKey = {
      keyType: KeyType.SECP256K1,
      data: new Uint8Array(64).fill(2),
      toString: () => "secp256k1:test",
    }

    const zorsh = publicKeyToZorsh(pk)
    // Type is narrowed to { secp256k1Key: { data: number[] } }
    expect(zorsh.secp256k1Key.data).toEqual(Array(64).fill(2))
  })
})

describe("Signature conversion", () => {
  test("converts Ed25519 signature to zorsh format", () => {
    const sig: Ed25519Signature = {
      keyType: KeyType.ED25519,
      data: new Uint8Array(64).fill(3),
    }

    const zorsh = signatureToZorsh(sig)
    // Type is narrowed to { ed25519Signature: { data: number[] } }
    expect(zorsh.ed25519Signature.data).toEqual(Array(64).fill(3))
  })

  test("converts Secp256k1 signature to zorsh format", () => {
    const sig: Secp256k1Signature = {
      keyType: KeyType.SECP256K1,
      data: new Uint8Array(65).fill(4),
    }

    const zorsh = signatureToZorsh(sig)
    // Type is narrowed to { secp256k1Signature: { data: number[] } }
    expect(zorsh.secp256k1Signature.data).toEqual(Array(65).fill(4))
  })
})

describe("Action serialization", () => {
  test("serializes transfer action", () => {
    const action = transfer(BigInt(1000000000000000000000000))

    // Should have the right shape
    expect("transfer" in action).toBe(true)
    expect(action.transfer.deposit).toBe(BigInt(1000000000000000000000000))
  })

  test("serializes function call action", () => {
    const args = new TextEncoder().encode(JSON.stringify({ param: "value" }))
    const action = functionCall(
      "test_method",
      args,
      BigInt(30000000000000),
      BigInt(0),
    )

    expect("functionCall" in action).toBe(true)
    expect(action.functionCall.methodName).toBe("test_method")
    expect(action.functionCall.args).toEqual(args)
    expect(action.functionCall.gas).toBe(BigInt(30000000000000))
    expect(action.functionCall.deposit).toBe(BigInt(0))
  })

  test("serializes stake action with converted public key", () => {
    const pk: Ed25519PublicKey = {
      keyType: KeyType.ED25519,
      data: new Uint8Array(32).fill(5),
      toString: () => "ed25519:test",
    }

    const action = stake(BigInt(1000000000000000000000000), pk)

    expect("stake" in action).toBe(true)
    expect(action.stake.stake).toBe(BigInt(1000000000000000000000000))

    // Public key should be converted to zorsh format
    // Type is narrowed thanks to specific PublicKey type
    expect(action.stake.publicKey.ed25519Key.data).toEqual(Array(32).fill(5))
  })

  test("serializes add key action with converted public key", () => {
    const pk: Ed25519PublicKey = {
      keyType: KeyType.ED25519,
      data: new Uint8Array(32).fill(6),
      toString: () => "ed25519:test",
    }

    const permission = { fullAccess: {} }
    const action = addKey(pk, permission)

    expect("addKey" in action).toBe(true)

    // Public key should be converted
    // Type is narrowed thanks to specific PublicKey type
    expect(action.addKey.publicKey.ed25519Key.data).toEqual(Array(32).fill(6))

    // Permission should be passed through
    expect(action.addKey.accessKey.permission).toEqual(permission)
    expect(action.addKey.accessKey.nonce).toBe(BigInt(0))
  })

  test("serializes delete key action with converted public key", () => {
    const pk: Ed25519PublicKey = {
      keyType: KeyType.ED25519,
      data: new Uint8Array(32).fill(7),
      toString: () => "ed25519:test",
    }

    const action = deleteKey(pk)

    expect("deleteKey" in action).toBe(true)
    // Type is narrowed thanks to specific PublicKey type
    expect(action.deleteKey.publicKey.ed25519Key.data).toEqual(
      Array(32).fill(7),
    )
  })

  test("serializes deploy contract action", () => {
    const code = new Uint8Array([0x00, 0x61, 0x73, 0x6d]) // WASM magic number
    const action = deployContract(code)

    expect("deployContract" in action).toBe(true)
    expect(action.deployContract.code).toEqual(code)
  })

  test("serializes delete account action", () => {
    const action = deleteAccount("beneficiary.near")

    expect("deleteAccount" in action).toBe(true)
    expect(action.deleteAccount.beneficiaryId).toBe("beneficiary.near")
  })
})

describe("Transaction serialization", () => {
  test("serializes complete transaction", () => {
    const pk: Ed25519PublicKey = {
      keyType: KeyType.ED25519,
      data: new Uint8Array(32).fill(8),
      toString: () => "ed25519:test",
    }

    const transaction = {
      signerId: "sender.near",
      publicKey: pk,
      nonce: BigInt(123),
      receiverId: "receiver.near",
      blockHash: new Uint8Array(32).fill(9),
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

    const serialized = serializeTransaction(transaction)

    // Should produce bytes
    expect(serialized).toBeInstanceOf(Uint8Array)
    expect(serialized.length).toBeGreaterThan(0)
  })
})

describe("Schema validation", () => {
  test("ActionSchema can serialize transfer", () => {
    const action = { transfer: { deposit: BigInt(100) } }
    const serialized = ActionSchema.serialize(action)

    expect(serialized).toBeInstanceOf(Uint8Array)
    expect(serialized.length).toBeGreaterThan(0)
  })

  test("ActionSchema can serialize function call", () => {
    const action = {
      functionCall: {
        methodName: "test",
        args: new Uint8Array([1, 2, 3]),
        gas: BigInt(30000000000000),
        deposit: BigInt(0),
      },
    }
    const serialized = ActionSchema.serialize(action)

    expect(serialized).toBeInstanceOf(Uint8Array)
    expect(serialized.length).toBeGreaterThan(0)
  })

  test("PublicKeySchema can serialize Ed25519 key", () => {
    const pk = {
      ed25519Key: {
        data: Array(32).fill(1),
      },
    }
    const serialized = PublicKeySchema.serialize(pk)

    expect(serialized).toBeInstanceOf(Uint8Array)
    expect(serialized.length).toBe(33) // 1 byte discriminant + 32 bytes data
  })

  test("SignatureSchema can serialize Ed25519 signature", () => {
    const sig = {
      ed25519Signature: {
        data: Array(64).fill(1),
      },
    }
    const serialized = SignatureSchema.serialize(sig)

    expect(serialized).toBeInstanceOf(Uint8Array)
    expect(serialized.length).toBe(65) // 1 byte discriminant + 64 bytes data
  })
})
