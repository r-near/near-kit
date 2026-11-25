import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { formatPublicKey } from "../src/data.js"
import {
  Nep413InputError,
  type Nep413Payload,
  type Nep413Proof,
  Nep413UnsupportedKeyError,
  verifyNep413Signature,
} from "../src/nep413.js"

interface Vector {
  id: string
  scheme: "ed25519" | "secp256k1"
  payload: {
    message: string
    nonceHex: string
    recipient: string
    callbackUrl?: string
  }
  proof: Nep413Proof
  negativeProofs: { id: string; proof: Nep413Proof }[]
}
const { vectors } = JSON.parse(
  readFileSync(
    new URL("./fixtures/nep413/vectors.json", import.meta.url),
    "utf8",
  ),
) as { vectors: Vector[] }
const payload = (vector: Vector): Nep413Payload => ({
  message: vector.payload.message,
  recipient: vector.payload.recipient,
  nonce: new Uint8Array(Buffer.from(vector.payload.nonceHex, "hex")),
  ...(vector.payload.callbackUrl === undefined
    ? {}
    : { callbackUrl: vector.payload.callbackUrl }),
})
const ed = vectors.find((vector) => vector.id === "ed25519-receipt")!
const secp = vectors.find((vector) => vector.id === "secp256k1-receipt")!

describe("independent Node/OpenSSL NEP-413 interoperability", () => {
  for (const vector of vectors) {
    it(`verifies ${vector.id} synchronously`, () => {
      const result = verifyNep413Signature(payload(vector), vector.proof)
      expect(result).toBe(true)
      expect(typeof result).toBe("boolean")
    })
    for (const negative of vector.negativeProofs ?? []) {
      it(`rejects ${vector.id}: ${negative.id}`, () => {
        expect(verifyNep413Signature(payload(vector), negative.proof)).toBe(
          false,
        )
      })
    }
  }
  it("binds every payload field and distinguishes absent from empty callback", () => {
    const original = payload(ed)
    for (const changed of [
      { ...original, message: `${original.message}!` },
      { ...original, recipient: `${original.recipient}/` },
      { ...original, nonce: original.nonce.map((byte) => byte ^ 1) },
      { ...original, callbackUrl: "" },
    ])
      expect(verifyNep413Signature(changed, ed.proof)).toBe(false)
    const signedEmpty = vectors.find(
      (vector) =>
        vector.scheme === "ed25519" && vector.payload.callbackUrl === "",
    )!
    expect(signedEmpty).toBeDefined()
    expect(
      Reflect.apply(verifyNep413Signature, undefined, [
        { ...payload(signedEmpty), callbackUrl: undefined },
        signedEmpty.proof,
      ]),
    ).toBe(false)
  })
})

it("accepts the bounded envelope and rejects excess before encoding", () => {
  const boundary = vectors.find(
    (vector) => vector.id === "ed25519-max-envelope",
  )!
  expect(boundary).toBeDefined()
  expect(verifyNep413Signature(payload(boundary), boundary.proof)).toBe(true)
  expect(() =>
    verifyNep413Signature(
      { ...payload(boundary), message: `${boundary.payload.message}x` },
      boundary.proof,
    ),
  ).toThrowError(new Nep413InputError("Payload", "TooLarge"))
  expect(() =>
    verifyNep413Signature(
      { ...payload(ed), message: "😃".repeat(20_000) },
      ed.proof,
    ),
  ).toThrowError(new Nep413InputError("Message", "TooLarge"))
})

it("captures fields once, owns nonce bytes and supports sliced/Buffer input", () => {
  const original = payload(ed)
  const storage = new Uint8Array(40)
  storage.set(original.nonce, 4)
  const nonce = storage.subarray(4, 36)
  Object.defineProperty(nonce, "length", { value: 9_000_000 })
  Object.defineProperty(nonce, "buffer", {
    get() {
      throw new Error("shadowed buffer")
    },
  })
  const counts = new Map<string, number>()
  const read = <A>(name: string, value: A): A => {
    counts.set(name, (counts.get(name) ?? 0) + 1)
    return value
  }
  const input: Nep413Payload = {
    get message() {
      return read("message", original.message)
    },
    get nonce() {
      return read("nonce", nonce)
    },
    get recipient() {
      return read("recipient", original.recipient)
    },
  }
  Object.defineProperty(input, "callbackUrl", {
    get() {
      return read("callbackUrl", undefined)
    },
  })
  const proof = {
    get publicKey() {
      return read("publicKey", ed.proof.publicKey)
    },
    get signature() {
      return read("signature", ed.proof.signature)
    },
  }
  expect(verifyNep413Signature(input, proof)).toBe(true)
  expect([...counts.values()]).toEqual([1, 1, 1, 1, 1, 1])
  expect(storage.slice(4, 36)).toEqual(original.nonce)
  storage[4] = storage[4]! ^ 1
  expect(verifyNep413Signature(input, proof)).toBe(false)
  expect(
    verifyNep413Signature(
      { ...original, nonce: Buffer.from(original.nonce) },
      ed.proof,
    ),
  ).toBe(true)
})

it("rejects shared, detached, oversized and malformed nonce input", () => {
  const detached = new Uint8Array(32)
  structuredClone(detached.buffer, { transfer: [detached.buffer] })
  for (const nonce of [
    new Uint8Array(31),
    new Uint8Array(33),
    new Uint8Array(1_000_000),
    new Uint8Array(new SharedArrayBuffer(32)),
    detached,
    Array(32).fill(0),
    null,
  ]) {
    expect(() =>
      Reflect.apply(verifyNep413Signature, undefined, [
        { ...payload(ed), nonce },
        ed.proof,
      ]),
    ).toThrowError(Nep413InputError)
  }
})

it("keeps caller getter defects distinct from sanitized malformed data", () => {
  const defect = new Error("caller defect")
  expect(() =>
    verifyNep413Signature(
      {
        ...payload(ed),
        get message(): string {
          throw defect
        },
      },
      ed.proof,
    ),
  ).toThrowError(defect)
  for (const bad of [null, false, "message", undefined]) {
    expect(() =>
      Reflect.apply(verifyNep413Signature, undefined, [bad, ed.proof]),
    ).toThrowError(Nep413InputError)
  }
  for (const field of ["message", "recipient", "callbackUrl"]) {
    for (const value of [null, 123, "\ud800", "\udc00", "\ud800x"]) {
      expect(() =>
        Reflect.apply(verifyNep413Signature, undefined, [
          { ...payload(ed), [field]: value },
          ed.proof,
        ]),
      ).toThrowError(Nep413InputError)
    }
  }
})

it("rejects noncanonical public keys and reports unsupported schemes separately", () => {
  for (const publicKey of [
    ed.proof.publicKey.slice(8),
    `ED25519:${ed.proof.publicKey.slice(8)}`,
    `${ed.proof.publicKey}\n`,
    "ed25519:0",
    "unknown:1111",
    "ed25519:" + "1".repeat(33),
  ]) {
    expect(() =>
      verifyNep413Signature(payload(ed), { ...ed.proof, publicKey }),
    ).toThrowError(Nep413InputError)
  }
  for (const [kind, length] of [
    ["ml-dsa-65", 1952],
    ["ml-dsa-65-hash", 32],
  ] as const) {
    expect(() =>
      verifyNep413Signature(payload(ed), {
        ...ed.proof,
        publicKey: formatPublicKey({ kind, data: new Uint8Array(length) }),
      }),
    ).toThrowError(new Nep413UnsupportedKeyError(kind))
  }
})

it("accepts only exact raw signature base64, including canonical padding bits", () => {
  const signature = ed.proof.signature
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
  const noncanonical =
    signature.slice(0, 85) +
    alphabet[alphabet.indexOf(signature[85]!) + 1] +
    "=="
  for (const invalid of [
    signature.slice(0, -2),
    `${signature}\n`,
    signature.replace(/=/g, ""),
    `ed25519:${signature}`,
    noncanonical,
    Buffer.from(signature, "base64").toString("hex"),
    Buffer.concat([
      Buffer.from([0]),
      Buffer.from(signature, "base64"),
    ]).toString("base64"),
  ]) {
    expect(() =>
      verifyNep413Signature(payload(ed), { ...ed.proof, signature: invalid }),
    ).toThrowError(Nep413InputError)
  }
})

it("rejects small-order Ed25519 authority and invalid mathematical proofs", () => {
  const identity = new Uint8Array(32)
  identity[0] = 1
  const forgery = new Uint8Array(64)
  forgery[0] = 1
  expect(
    verifyNep413Signature(payload(ed), {
      publicKey: formatPublicKey({ kind: "ed25519", data: identity }),
      signature: Buffer.from(forgery).toString("base64"),
    }),
  ).toBe(false)
  const badScalar = Buffer.from(ed.proof.signature, "base64")
  badScalar.fill(255, 32)
  expect(
    verifyNep413Signature(payload(ed), {
      ...ed.proof,
      signature: badScalar.toString("base64"),
    }),
  ).toBe(false)
  expect(
    verifyNep413Signature(payload(ed), {
      ...ed.proof,
      publicKey: formatPublicKey({
        kind: "ed25519",
        data: new Uint8Array(32).fill(255),
      }),
    }),
  ).toBe(false)
})

it("uses compact low-S secp verification and only range-checks the trailing recovery byte", () => {
  for (const recoveryId of [0, 1, 2, 3]) {
    const bytes = Buffer.from(secp.proof.signature, "base64")
    bytes[64] = recoveryId
    expect(
      verifyNep413Signature(payload(secp), {
        ...secp.proof,
        signature: bytes.toString("base64"),
      }),
    ).toBe(true)
  }
  const invalidTail = Buffer.from(secp.proof.signature, "base64")
  invalidTail[64] = 4
  expect(() =>
    verifyNep413Signature(payload(secp), {
      ...secp.proof,
      signature: invalidTail.toString("base64"),
    }),
  ).toThrowError(Nep413InputError)
  const bytes = Buffer.from(secp.proof.signature, "base64")
  const order =
    0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n
  const highS = order - BigInt(`0x${bytes.subarray(32, 64).toString("hex")}`)
  Buffer.from(highS.toString(16).padStart(64, "0"), "hex").copy(bytes, 32)
  expect(
    verifyNep413Signature(payload(secp), {
      ...secp.proof,
      signature: bytes.toString("base64"),
    }),
  ).toBe(false)
})
