/**
 * Tests for DelegateV2 meta-transactions (gas keys, NEAR 2.13).
 *
 * Wire-format facts (from nearcore core/primitives/src/action/delegate.rs and
 * signable_message.rs):
 * - Action::DelegateV2 = discriminant 14.
 * - The signed payload is the *versioned payload enum*
 *   `VersionedDelegateActionPayload::V2(DelegateActionV2)` (variant tag 0x00),
 *   prefixed with the NEP-461 domain tag for NEP-611 = 2^30 + 611 = 1073742435.
 *   This DIFFERS from the V1 delegate tag (2^30 + 366 = 1073742190), so a V1
 *   signature is never valid for a V2 action.
 * - DelegateActionV2 nonce is a TransactionNonce (gas-key capable).
 */

import { describe, expect, test } from "vitest"
import {
  DelegateActionV2,
  signedDelegateV2,
  transfer,
} from "../../src/core/actions.js"
import {
  ActionSchema,
  DELEGATE_ACTION_PREFIX,
  DELEGATE_ACTION_V2_PREFIX,
  decodeSignedDelegateActionV2,
  encodeSignedDelegateActionV2,
  serializeDelegateActionV2,
} from "../../src/core/schema.js"
import {
  type Ed25519PublicKey,
  type Ed25519Signature,
  KeyType,
} from "../../src/core/types.js"

const pk: Ed25519PublicKey = {
  keyType: KeyType.ED25519,
  data: new Uint8Array(32).fill(8),
  toString: () => "ed25519:test",
}

const sig: Ed25519Signature = {
  keyType: KeyType.ED25519,
  data: new Uint8Array(64).fill(12),
}

const baseAction = () =>
  new DelegateActionV2(
    "alice.near",
    "bob.near",
    [transfer(1000n)],
    { gasKeyNonce: { nonce: 5n, nonceIndex: 2 } },
    1000n,
    pk,
  )

describe("DelegateV2 domain tag", () => {
  test("V2 prefix is 2^30 + 611 and distinct from V1", () => {
    expect(DELEGATE_ACTION_V2_PREFIX).toBe(1073742435)
    expect(DELEGATE_ACTION_V2_PREFIX).not.toBe(DELEGATE_ACTION_PREFIX)
  })

  test("serializeDelegateActionV2 starts with the V2 prefix (LE u32)", () => {
    const bytes = serializeDelegateActionV2(baseAction().toBorsh())
    // 1073742435 = 0x40000263, little-endian: 63 02 00 40
    expect(bytes[0]).toBe(0x63)
    expect(bytes[1]).toBe(0x02)
    expect(bytes[2]).toBe(0x00)
    expect(bytes[3]).toBe(0x40)
  })

  test("the versioned payload variant tag (0x00) follows the prefix", () => {
    const bytes = serializeDelegateActionV2(baseAction().toBorsh())
    // After the 4-byte prefix comes the VersionedDelegateActionPayload enum tag.
    expect(bytes[4]).toBe(0)
  })

  test("V2 signing bytes differ from a hypothetical V1 prefix", () => {
    // A V1 delegate signature is not valid for V2: the signed bytes start with a
    // different domain tag, so the hashes (and thus signatures) cannot collide.
    const v2 = serializeDelegateActionV2(baseAction().toBorsh())
    const v1Prefix = new Uint8Array([0x6e, 0x01, 0x00, 0x40]) // 1073742190 LE
    expect(Array.from(v2.slice(0, 4))).not.toEqual(Array.from(v1Prefix))
  })
})

describe("DelegateV2 action", () => {
  test("Action::DelegateV2 serializes with discriminant 14", () => {
    const action = signedDelegateV2(baseAction(), sig)
    expect("delegateV2" in action).toBe(true)

    const bytes = ActionSchema.serialize(action)
    expect(bytes[0]).toBe(14)
  })

  test("signedDelegateV2 carries the versioned payload and signature", () => {
    const action = signedDelegateV2(baseAction(), sig)
    expect(action.delegateV2.delegateAction.v2.senderId).toBe("alice.near")
    expect(action.delegateV2.delegateAction.v2.nonce).toEqual({
      gasKeyNonce: { nonce: 5n, nonceIndex: 2 },
    })
  })

  test("Action::DelegateV2 round-trips through ActionSchema", () => {
    const action = signedDelegateV2(baseAction(), sig)
    const bytes = ActionSchema.serialize(action)
    expect(ActionSchema.deserialize(bytes)).toEqual(action)
  })

  test("an ordinary-nonce V2 delegate uses the Nonce variant", () => {
    const action = signedDelegateV2(
      new DelegateActionV2(
        "alice.near",
        "bob.near",
        [transfer(1n)],
        { nonce: { nonce: 9n } },
        500n,
        pk,
      ),
      sig,
    )
    expect(action.delegateV2.delegateAction.v2.nonce).toEqual({
      nonce: { nonce: 9n },
    })
  })
})

describe("DelegateV2 encode/decode", () => {
  test("round-trips to bytes and base64", () => {
    const action = signedDelegateV2(baseAction(), sig)

    const bytes = encodeSignedDelegateActionV2(action, "bytes")
    expect(decodeSignedDelegateActionV2(bytes)).toEqual(action)

    const b64 = encodeSignedDelegateActionV2(action)
    expect(typeof b64).toBe("string")
    expect(decodeSignedDelegateActionV2(b64)).toEqual(action)
  })
})
