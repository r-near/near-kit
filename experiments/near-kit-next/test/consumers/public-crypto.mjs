// Public fixtures only. The caller supplies the independently encoded proofs.
import { deterministicAccountId } from "@near-kit/next/address"
import { Nep413InputError, verifyNep413Signature } from "@near-kit/next/nep413"

export function publicCryptoChecks(fixture) {
  const assert = (condition, message) => {
    if (!condition) throw new Error(message)
  }
  assert(
    deterministicAccountId({ code: { accountId: "publisher.near" } }) ===
      "0s2293da2d32cd0a067950616036ff973884abab0a",
    "Public address mismatch",
  )
  let verified = 0
  for (const vector of fixture.vectors) {
    const nonce = Uint8Array.from(
      vector.payload.nonceHex.match(/../g),
      (byte) => Number.parseInt(byte, 16),
    )
    const payload = {
      message: vector.payload.message,
      recipient: vector.payload.recipient,
      nonce,
      ...(vector.payload.callbackUrl === undefined
        ? {}
        : { callbackUrl: vector.payload.callbackUrl }),
    }
    assert(verifyNep413Signature(payload, vector.proof), vector.id)
    const characters = Array.from(payload.message)
    const changedMessage =
      (characters[0] === "!" ? "?" : "!") + characters.slice(1).join("")
    assert(
      !verifyNep413Signature(
        { ...payload, message: changedMessage },
        vector.proof,
      ),
      "Wrong message accepted",
    )
    for (const negative of vector.negativeProofs ?? [])
      assert(!verifyNep413Signature(payload, negative.proof), negative.id)
    const detached = new Uint8Array(nonce)
    structuredClone(detached, { transfer: [detached.buffer] })
    let rejected = false
    try {
      verifyNep413Signature({ ...payload, nonce: detached }, vector.proof)
    } catch (error) {
      rejected = error instanceof Nep413InputError
    }
    assert(rejected, "Detached nonce accepted")
    verified++
  }
  assert(verified > 1, "Missing public proof corpus")
  return {
    address: true,
    verified,
    wrongMessageRejected: true,
    detachedRejected: true,
  }
}
