import { ed25519 } from "@noble/curves/ed25519.js"
import { secp256k1 } from "@noble/curves/secp256k1.js"
import { sha256 } from "@noble/hashes/sha2.js"
import { base64 } from "@scure/base"
import { parsePublicKey } from "./data.js"

/** Exact NEP-413 fields. Account, network and state are not signed fields. */
export interface Nep413Payload {
  readonly message: string
  readonly nonce: Uint8Array
  readonly recipient: string
  readonly callbackUrl?: string
}
export interface Nep413Proof {
  readonly publicKey: string
  /** Canonical padded base64 containing raw signature bytes. */
  readonly signature: string
}
type Field =
  | "Payload"
  | "Message"
  | "Nonce"
  | "Recipient"
  | "CallbackUrl"
  | "PublicKey"
  | "Signature"
type Reason = "Type" | "Encoding" | "Length" | "TooLarge"

export class Nep413InputError extends Error {
  readonly _tag = "Nep413InputError"
  constructor(
    readonly field: Field,
    readonly reason: Reason,
  ) {
    super(`Invalid NEP-413 ${field}: ${reason}`)
    this.name = this._tag
  }
}
export class Nep413UnsupportedKeyError extends Error {
  readonly _tag = "Nep413UnsupportedKeyError"
  constructor(readonly kind: "ml-dsa-65" | "ml-dsa-65-hash") {
    super(`NEP-413 verification does not support ${kind}`)
    this.name = this._tag
  }
}

const maxEnvelopeBytes = 65_536
const encoder = new TextEncoder()
const alphabet =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
const typedArrayBuffer = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  "buffer",
)?.get as (this: Uint8Array) => ArrayBufferLike
const typedArrayLength = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  "byteLength",
)?.get as (this: Uint8Array) => number
const arrayBufferLength = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "byteLength",
)?.get as (this: ArrayBufferLike) => number

function textLength(value: unknown, field: Field): number {
  if (typeof value !== "string") throw new Nep413InputError(field, "Type")
  if (value.length > maxEnvelopeBytes)
    throw new Nep413InputError(field, "TooLarge")
  let length = 0
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index)
    if (unit < 0x80) length++
    else if (unit < 0x800) length += 2
    else if (unit < 0xd800 || unit > 0xdfff) length += 3
    else {
      const next = value.charCodeAt(++index)
      if (unit > 0xdbff || !(next >= 0xdc00 && next <= 0xdfff))
        throw new Nep413InputError(field, "Encoding")
      length += 4
    }
    if (length > maxEnvelopeBytes) throw new Nep413InputError(field, "TooLarge")
  }
  return length
}

function copyNonce(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array))
    throw new Nep413InputError("Nonce", "Type")
  // Intrinsic getters avoid shadowed .buffer/.length properties. Shared input
  // cannot be captured atomically; the ArrayBuffer getter rejects its brand.
  try {
    const buffer = typedArrayBuffer.call(value)
    arrayBufferLength.call(buffer)
    // A zero-length view checks detachment without copying oversized input.
    new Uint8Array(buffer, 0, 0)
  } catch (error) {
    if (error instanceof TypeError) throw new Nep413InputError("Nonce", "Type")
    throw error
  }
  if (typedArrayLength.call(value) !== 32)
    throw new Nep413InputError("Nonce", "Length")
  let nonce: Uint8Array
  try {
    nonce = new Uint8Array(value)
  } catch (error) {
    if (error instanceof TypeError) throw new Nep413InputError("Nonce", "Type")
    throw error
  }
  if (nonce.length !== 32) throw new Nep413InputError("Nonce", "Length")
  return nonce
}

function decodeSignature(value: string, kind: "ed25519" | "secp256k1") {
  if (value.length !== 88) throw new Nep413InputError("Signature", "Length")
  const canonical =
    kind === "ed25519"
      ? /^[A-Za-z0-9+/]{86}==$/.test(value) &&
        (alphabet.indexOf(value[85]!) & 15) === 0
      : /^[A-Za-z0-9+/]{87}=$/.test(value) &&
        (alphabet.indexOf(value[86]!) & 3) === 0
  if (!canonical) throw new Nep413InputError("Signature", "Encoding")
  // All alphabet, padding and unused-bit checks precede the codec. A failure
  // after those checks is a dependency defect, not a bad-credentials result.
  const signature = base64.decode(value)
  if (kind === "secp256k1" && signature[64]! > 3)
    throw new Nep413InputError("Signature", "Encoding")
  return signature
}

/**
 * Verify only the exact public NEP-413 signature, synchronously.
 *
 * True does not authenticate an account or consume a challenge. The server
 * must check its stored payload, current full-access key and atomic replay
 * state before issuing a session. Ed25519 uses strict (non-ZIP215) verification.
 * Inputs must remain stable during capture; getter/proxy defects propagate.
 */
export function verifyNep413Signature(
  payload: Nep413Payload,
  proof: Nep413Proof,
): boolean {
  if (typeof payload !== "object" || payload === null)
    throw new Nep413InputError("Payload", "Type")
  if (typeof proof !== "object" || proof === null)
    throw new Nep413InputError("PublicKey", "Type")
  // Capture once before any validation or encoding. Getter exceptions belong
  // to the caller and are intentionally outside all input-error catches.
  const message = payload.message
  const suppliedNonce = payload.nonce
  const recipient = payload.recipient
  const callbackUrl = payload.callbackUrl
  const publicKey = proof.publicKey
  const signatureText = proof.signature
  const messageLength = textLength(message, "Message")
  const recipientLength = textLength(recipient, "Recipient")
  const callbackLength =
    callbackUrl === undefined ? 0 : textLength(callbackUrl, "CallbackUrl")
  const nonce = copyNonce(suppliedNonce)
  const length =
    45 +
    messageLength +
    recipientLength +
    (callbackUrl === undefined ? 0 : 4 + callbackLength)
  if (length > maxEnvelopeBytes)
    throw new Nep413InputError("Payload", "TooLarge")
  if (typeof publicKey !== "string")
    throw new Nep413InputError("PublicKey", "Type")
  if (typeof signatureText !== "string")
    throw new Nep413InputError("Signature", "Type")
  let key: ReturnType<typeof parsePublicKey>
  try {
    key = parsePublicKey(publicKey)
  } catch (error) {
    if (error instanceof TypeError || error instanceof RangeError)
      throw new Nep413InputError("PublicKey", "Encoding")
    throw error
  }
  if (key.kind === "ml-dsa-65" || key.kind === "ml-dsa-65-hash")
    throw new Nep413UnsupportedKeyError(key.kind)
  const signature = decodeSignature(signatureText, key.kind)
  const envelope = new Uint8Array(length)
  const view = new DataView(envelope.buffer)
  let offset = 0
  const u32 = (number: number) => {
    view.setUint32(offset, number, true)
    offset += 4
  }
  const string = (value: string, size: number) => {
    u32(size)
    encoder.encodeInto(value, envelope.subarray(offset, offset + size))
    offset += size
  }
  u32(2 ** 31 + 413)
  string(message, messageLength)
  envelope.set(nonce, offset)
  offset += 32
  string(recipient, recipientLength)
  envelope[offset++] = callbackUrl === undefined ? 0 : 1
  if (callbackUrl !== undefined) string(callbackUrl, callbackLength)
  const digest = sha256(envelope)
  if (key.kind === "ed25519")
    return ed25519.verify(signature, digest, key.data, { zip215: false })
  const sec1 = new Uint8Array(65)
  sec1[0] = 4
  sec1.set(key.data, 1)
  return secp256k1.verify(signature.subarray(0, 64), digest, sec1, {
    format: "compact",
    lowS: true,
    prehash: false,
  })
}
