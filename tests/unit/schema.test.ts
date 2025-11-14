/**
 * Tests for Borsh schema and action serialization
 */

import { describe, expect, test } from "bun:test"
import {
  addKey,
  createAccount,
  DelegateAction,
  deleteAccount,
  deleteKey,
  deployContract,
  functionCall,
  SignedDelegate,
  signedDelegate,
  stake,
  transfer,
} from "../../src/core/actions.js"
import {
  type Action,
  ActionSchema,
  DELEGATE_ACTION_PREFIX,
  PublicKeySchema,
  publicKeyToZorsh,
  SignatureSchema,
  serializeDelegateAction,
  serializeSignedDelegate,
  serializeTransaction,
  signatureToZorsh,
} from "../../src/core/schema.js"
import {
  type Ed25519PublicKey,
  type Ed25519Signature,
  KeyType,
  type Secp256k1PublicKey,
  type Secp256k1Signature,
} from "../../src/core/types.js"

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

describe("Delegate Action prefix (NEP-461)", () => {
  test("DELEGATE_ACTION_PREFIX has correct value", () => {
    // 2^30 + 366 = 1073742190
    expect(DELEGATE_ACTION_PREFIX).toBe(1073742190)
  })

  test("serializeDelegateAction prepends prefix to serialized delegate action", () => {
    const pk: Ed25519PublicKey = {
      keyType: KeyType.ED25519,
      data: new Uint8Array(32).fill(10),
      toString: () => "ed25519:test",
    }

    const delegateAction = new DelegateAction(
      "sender.near",
      "receiver.near",
      [transfer(BigInt(1000000))],
      BigInt(123),
      BigInt(1000),
      pk,
    )

    const encoded = serializeDelegateAction(delegateAction)

    // Should produce bytes
    expect(encoded).toBeInstanceOf(Uint8Array)
    expect(encoded.length).toBeGreaterThan(4) // At least prefix (4 bytes) + some data

    // First 4 bytes should be the prefix in little-endian format
    // 1073742190 = 0x4000016E
    // Little-endian: 6E 01 00 40
    expect(encoded[0]).toBe(0x6e)
    expect(encoded[1]).toBe(0x01)
    expect(encoded[2]).toBe(0x00)
    expect(encoded[3]).toBe(0x40)
  })

  test("serializeDelegateAction with multiple actions", () => {
    const pk: Ed25519PublicKey = {
      keyType: KeyType.ED25519,
      data: new Uint8Array(32).fill(11),
      toString: () => "ed25519:test",
    }

    const delegateAction = new DelegateAction(
      "sender.near",
      "receiver.near",
      [
        transfer(BigInt(1000000)),
        functionCall(
          "test_method",
          new TextEncoder().encode("{}"),
          BigInt(30000000000000),
          BigInt(0),
        ),
      ],
      BigInt(456),
      BigInt(2000),
      pk,
    )

    const encoded = serializeDelegateAction(delegateAction)

    // Should produce bytes with prefix
    expect(encoded).toBeInstanceOf(Uint8Array)
    expect(encoded.length).toBeGreaterThan(4)

    // Verify prefix is present
    expect(encoded[0]).toBe(0x6e)
    expect(encoded[1]).toBe(0x01)
    expect(encoded[2]).toBe(0x00)
    expect(encoded[3]).toBe(0x40)
  })
})

describe("Signed Delegate Action", () => {
  test("creates SignedDelegate with DelegateAction and signature", () => {
    const pk: Ed25519PublicKey = {
      keyType: KeyType.ED25519,
      data: new Uint8Array(32).fill(12),
      toString: () => "ed25519:test",
    }

    const sig: Ed25519Signature = {
      keyType: KeyType.ED25519,
      data: new Uint8Array(64).fill(13),
    }

    const delegateAction = new DelegateAction(
      "sender.near",
      "receiver.near",
      [transfer(BigInt(5000000))],
      BigInt(789),
      BigInt(3000),
      pk,
    )

    const signed = new SignedDelegate(delegateAction, sig)

    expect(signed.delegateAction).toBe(delegateAction)
    expect(signed.signature).toBe(sig)
  })

  test("serializeSignedDelegate produces valid bytes", () => {
    const pk: Ed25519PublicKey = {
      keyType: KeyType.ED25519,
      data: new Uint8Array(32).fill(14),
      toString: () => "ed25519:test",
    }

    const sig: Ed25519Signature = {
      keyType: KeyType.ED25519,
      data: new Uint8Array(64).fill(15),
    }

    const delegateAction = new DelegateAction(
      "sender.near",
      "receiver.near",
      [transfer(BigInt(2000000))],
      BigInt(999),
      BigInt(4000),
      pk,
    )

    const signed = new SignedDelegate(delegateAction, sig)
    const encoded = serializeSignedDelegate(signed)

    // Should produce bytes
    expect(encoded).toBeInstanceOf(Uint8Array)
    expect(encoded.length).toBeGreaterThan(0)

    // Note: This encoding does NOT include the NEP-461 prefix
    // The prefix is only used when signing the DelegateAction
    // Verify it doesn't start with the prefix
    const hasPrefix =
      encoded[0] === 0x6e &&
      encoded[1] === 0x01 &&
      encoded[2] === 0x00 &&
      encoded[3] === 0x40
    expect(hasPrefix).toBe(false)
  })

  test("signedDelegate helper creates valid action", () => {
    const pk: Ed25519PublicKey = {
      keyType: KeyType.ED25519,
      data: new Uint8Array(32).fill(16),
      toString: () => "ed25519:test",
    }

    const sig: Ed25519Signature = {
      keyType: KeyType.ED25519,
      data: new Uint8Array(64).fill(17),
    }

    const delegateAction = new DelegateAction(
      "sender.near",
      "receiver.near",
      [createAccount(), transfer(BigInt(3000000))],
      BigInt(111),
      BigInt(5000),
      pk,
    )

    const action = signedDelegate(delegateAction, sig)

    // Should have the right shape
    expect("signedDelegate" in action).toBe(true)
    expect(action.signedDelegate.delegateAction.senderId).toBe("sender.near")
    expect(action.signedDelegate.delegateAction.receiverId).toBe(
      "receiver.near",
    )
    expect(action.signedDelegate.delegateAction.nonce).toBe(BigInt(111))
  })
})

describe("Delegate Action integration", () => {
  test("serializes transaction with SignedDelegate action", () => {
    const pk: Ed25519PublicKey = {
      keyType: KeyType.ED25519,
      data: new Uint8Array(32).fill(18),
      toString: () => "ed25519:test",
    }

    const sig: Ed25519Signature = {
      keyType: KeyType.ED25519,
      data: new Uint8Array(64).fill(19),
    }

    const delegateAction = new DelegateAction(
      "user.near",
      "contract.near",
      [
        functionCall(
          "do_something",
          new TextEncoder().encode('{"value":42}'),
          BigInt(50000000000000),
          BigInt(1000000),
        ),
      ],
      BigInt(555),
      BigInt(6000),
      pk,
    )

    const transaction = {
      signerId: "relayer.near",
      publicKey: pk,
      nonce: BigInt(777),
      receiverId: "user.near", // DelegateAction receiver should match user
      blockHash: new Uint8Array(32).fill(20),
      actions: [signedDelegate(delegateAction, sig)],
    }

    const serialized = serializeTransaction(transaction)

    // Should produce bytes
    expect(serialized).toBeInstanceOf(Uint8Array)
    expect(serialized.length).toBeGreaterThan(0)
  })
})
