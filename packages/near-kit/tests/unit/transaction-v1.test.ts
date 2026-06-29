/**
 * Tests for the versioned (V1) transaction encoding (gas keys / strict nonce, NEAR 2.13).
 *
 * Wire-format facts (from nearcore core/primitives/src/transaction.rs):
 * - A V0 transaction is serialized TAG-LESS (legacy struct); a V1 transaction is
 *   `[0x01] ++ borsh(TransactionV1)`.
 * - Deserialization reads 2 bytes: 2nd byte 0 => V0; 1st byte 1 & 2nd != 0 => V1.
 * - TransactionNonce: 0 = Nonce { nonce: u64 }, 1 = GasKeyNonce { nonce: u64, nonce_index: u16 }.
 * - NonceMode: 0 = Monotonic, 1 = Strict.
 * - TransactionV1 field order: signer_id, public_key, nonce, receiver_id,
 *   block_hash, actions, nonce_mode.
 */

import { describe, expect, test } from "vitest"
import { transfer } from "../../src/core/actions.js"
import {
  NonceModeSchema,
  serializeSignedTransactionV1,
  serializeTransaction,
  serializeTransactionV1,
  TransactionNonceSchema,
  type TransactionV1,
  TransactionV1Schema,
} from "../../src/core/schema.js"
import {
  type Ed25519PublicKey,
  type Ed25519Signature,
  KeyType,
} from "../../src/core/types.js"

const pk: Ed25519PublicKey = {
  keyType: KeyType.ED25519,
  data: new Uint8Array(32).fill(7),
  toString: () => "ed25519:test",
}

const sig: Ed25519Signature = {
  keyType: KeyType.ED25519,
  data: new Uint8Array(64).fill(9),
}

const baseV1 = (): TransactionV1 => ({
  signerId: "alice.near",
  publicKey: pk,
  nonce: { gasKeyNonce: { nonce: 42n, nonceIndex: 3 } },
  receiverId: "bob.near",
  blockHash: new Uint8Array(32).fill(5),
  actions: [transfer(1000n)],
  nonceMode: { monotonic: {} },
})

describe("TransactionNonce schema", () => {
  test("Nonce variant is discriminant 0", () => {
    const bytes = TransactionNonceSchema.serialize({ nonce: { nonce: 1n } })
    expect(bytes[0]).toBe(0)
    // disc(1) + u64(8)
    expect(bytes.length).toBe(1 + 8)
  })

  test("GasKeyNonce variant is discriminant 1 with nonce + index", () => {
    const bytes = TransactionNonceSchema.serialize({
      gasKeyNonce: { nonce: 1n, nonceIndex: 2 },
    })
    expect(bytes[0]).toBe(1)
    // disc(1) + u64(8) + u16(2)
    expect(bytes.length).toBe(1 + 8 + 2)
  })

  test("round-trips both variants", () => {
    for (const value of [
      { nonce: { nonce: 123n } },
      { gasKeyNonce: { nonce: 456n, nonceIndex: 7 } },
    ]) {
      const bytes = TransactionNonceSchema.serialize(value)
      expect(TransactionNonceSchema.deserialize(bytes)).toEqual(value)
    }
  })
})

describe("NonceMode schema", () => {
  test("Monotonic is discriminant 0, Strict is discriminant 1", () => {
    expect(NonceModeSchema.serialize({ monotonic: {} })[0]).toBe(0)
    expect(NonceModeSchema.serialize({ strict: {} })[0]).toBe(1)
  })
})

describe("V1 transaction serialization", () => {
  test("prepends the 0x01 version tag", () => {
    const bytes = serializeTransactionV1(baseV1())
    expect(bytes[0]).toBe(1)
  })

  test("V1 wire bytes are V1 per nearcore's 2-byte discriminator", () => {
    // 1st byte == 1 (version tag); 2nd byte is the low byte of the signer_id
    // length prefix (10 for "alice.near"), which is nonzero => V1.
    const bytes = serializeTransactionV1(baseV1())
    expect(bytes[0]).toBe(1)
    expect(bytes[1]).not.toBe(0)
  })

  test("V0 stays tag-less and reads as V0 (2nd byte 0)", () => {
    // The default (V0) encoding must remain backward compatible: its 2nd byte is
    // the high byte of the signer_id u32 length, which is 0 for any real id.
    const v0 = serializeTransaction({
      signerId: "alice.near",
      publicKey: pk,
      nonce: 42n,
      receiverId: "bob.near",
      blockHash: new Uint8Array(32).fill(5),
      actions: [transfer(1000n)],
    })
    expect(v0[1]).toBe(0)
  })

  test("round-trips the inner struct after stripping the tag", () => {
    const v1 = baseV1()
    const bytes = serializeTransactionV1(v1)
    // Deserialize the struct (skip the 1-byte version tag).
    const decoded = TransactionV1Schema.deserialize(bytes.slice(1))

    expect(decoded.signerId).toBe("alice.near")
    expect(decoded.receiverId).toBe("bob.near")
    expect(decoded.nonce).toEqual({
      gasKeyNonce: { nonce: 42n, nonceIndex: 3 },
    })
    expect(decoded.nonceMode).toEqual({ monotonic: {} })
    expect(decoded.publicKey).toEqual({
      ed25519Key: { data: Array(32).fill(7) },
    })
  })

  test("signed V1 = tagged tx bytes followed by the signature", () => {
    const v1 = baseV1()
    const txBytes = serializeTransactionV1(v1)
    const signed = serializeSignedTransactionV1(v1, sig)

    expect(signed.length).toBe(txBytes.length + 1 + 64)
    // First bytes equal the tagged transaction.
    expect(Array.from(signed.slice(0, txBytes.length))).toEqual(
      Array.from(txBytes),
    )
    // Signature: ed25519 discriminant 0 then 64 bytes of 9.
    expect(signed[txBytes.length]).toBe(0)
    expect(signed[txBytes.length + 1]).toBe(9)
  })

  test("strict nonce mode flips the trailing mode byte", () => {
    const monotonic = serializeTransactionV1(baseV1())
    const strict = serializeTransactionV1({
      ...baseV1(),
      nonceMode: { strict: {} },
    })
    // Same length; differ only in the trailing nonce_mode discriminant byte.
    expect(strict.length).toBe(monotonic.length)
    expect(strict[strict.length - 1]).toBe(1)
    expect(monotonic[monotonic.length - 1]).toBe(0)
  })
})
