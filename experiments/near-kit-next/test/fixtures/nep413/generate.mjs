// TEST ONLY. Fixed, published, disposable OFF-CHAIN NEP-413 fixture material.
// Do not fund these keys, attach them to an account, or use them outside tests.
// This file intentionally imports no candidate, third-party codec, or wallet code.
// It is excluded from the package and must never be imported by production code.
import assert from "node:assert/strict"
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"

const mode = process.argv[2]
if (process.argv.length !== 3 || !["--write", "--check"].includes(mode)) {
  throw new Error(
    "Use --write to generate fixed test vectors or --check to verify public vectors",
  )
}

const fixtureUrl = new URL("./vectors.json", import.meta.url)
const ORDER =
  0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n
const TEST_ED25519_SEED_HEX = "01".repeat(32)
const TEST_SECP256K1_SCALAR_HEX = "00".repeat(31) + "01"
const TEST_NONCE_HEX =
  "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"
const sources = {
  nep413: "https://github.com/near/NEPs/blob/master/neps/nep-0413.md",
  nodeCrypto:
    "https://nodejs.org/download/release/v24.19.0/docs/api/crypto.html",
  ed25519KeyEncoding: "https://www.rfc-editor.org/rfc/rfc8410.html#section-7",
  sec1KeyEncoding: "https://www.rfc-editor.org/rfc/rfc5915.html#section-3",
  nearSignatureLayout:
    "https://github.com/near/nearcore/blob/2.13.4/core/crypto/src/signature.rs",
}

const app = {
  accountId: "auth-fixture.sandbox",
  sourceId: "auth-fixture-v1",
  chain: "sandbox",
  policy: 1,
  origin: "http://127.0.0.1:8787",
  issuedAt: "2026-10-01T00:00:00.000Z",
  issuedAtMs: Date.parse("2026-10-01T00:00:00.000Z"),
  expiresAt: "2026-10-01T00:05:00.000Z",
  expiresAtMs: Date.parse("2026-10-01T00:05:00.000Z"),
  challengeId: "A".repeat(43),
  browserId: "B".repeat(43),
  sessionId: "C".repeat(43),
}
app.tokenSequence = [app.browserId, app.challengeId, app.sessionId]

// Independently transcribed from the accepted application message contract.
// Comparing the live /challenge payload with this text catches application drift.
const receiptMessage = [
  "NEAR demo login v1",
  "Origin: http://127.0.0.1:8787",
  "Source: auth-fixture-v1",
  "Chain: sandbox",
  "Account: auth-fixture.sandbox",
  "Policy: 1",
  `Challenge: ${app.challengeId}`,
  "Expires: 2026-10-01T00:05:00.000Z",
].join("\n")
const receiptPayload = {
  message: receiptMessage,
  nonceHex: TEST_NONCE_HEX,
  recipient: app.origin,
}
const cases = [
  { suffix: "receipt", payload: receiptPayload },
  { suffix: "callback-empty", payload: { ...receiptPayload, callbackUrl: "" } },
  {
    suffix: "callback-unicode",
    payload: {
      ...receiptPayload,
      callbackUrl: "http://127.0.0.1:8787/callback?label=é/🦀",
    },
  },
  {
    suffix: "message-unicode",
    payload: {
      ...receiptPayload,
      message:
        "NEAR disposable off-chain fixture\nUnicode: e\u0301 / é / 🦀\nNUL:\0",
      recipient: "recipient/é",
    },
  },
  {
    suffix: "max-envelope",
    scheme: "ed25519",
    // Fixed-field overhead with an empty recipient and absent callback is 45.
    payload: {
      message: ".".repeat(65_536 - 45),
      nonceHex: TEST_NONCE_HEX,
      recipient: "",
    },
  },
]

function casesFor(scheme) {
  return cases.filter(
    (item) => item.scheme === undefined || item.scheme === scheme,
  )
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest()
}

function u32(value) {
  const bytes = Buffer.alloc(4)
  bytes.writeUInt32LE(value)
  return bytes
}

function utf8(value) {
  const bytes = Buffer.from(value, "utf8")
  return Buffer.concat([u32(bytes.length), bytes])
}

// Independent fixed-field Borsh framing, with a literal protocol tag.
// This is deliberately a different implementation from any candidate writer.
function envelope(payload) {
  const nonce = Buffer.from(payload.nonceHex, "hex")
  assert.equal(nonce.length, 32)
  return Buffer.concat([
    Buffer.from([0x9d, 0x01, 0x00, 0x80]),
    utf8(payload.message),
    nonce,
    utf8(payload.recipient),
    payload.callbackUrl === undefined
      ? Buffer.from([0])
      : Buffer.concat([Buffer.from([1]), utf8(payload.callbackUrl)]),
  ])
}

function wrongDomainEnvelope(bytes) {
  const different = Buffer.from(bytes)
  different.writeUInt32LE(2 ** 31 + 414, 0)
  return different
}

// Test-only base58 conversion. No near-kit or @scure/base oracle is imported.
function base58(bytes) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
  let leading = 0
  while (leading < bytes.length && bytes[leading] === 0) leading++
  let value = bytes.length === 0 ? 0n : BigInt(`0x${bytes.toString("hex")}`)
  let encoded = ""
  while (value > 0n) {
    encoded = alphabet[Number(value % 58n)] + encoded
    value /= 58n
  }
  return "1".repeat(leading) + encoded
}

function scalar(bytes) {
  return BigInt(`0x${bytes.toString("hex")}`)
}

function scalarBytes(value) {
  return Buffer.from(value.toString(16).padStart(64, "0"), "hex")
}

function nearSecpSignature(compact) {
  assert.equal(compact.length, 64)
  const r = scalar(compact.subarray(0, 32))
  const s = scalar(compact.subarray(32, 64))
  assert(r > 0n && r < ORDER && s > 0n && s < ORDER)
  // (r, n-s) has the same ECDSA verification equation; the chosen profile is low-S.
  const lowS = s > ORDER / 2n ? ORDER - s : s
  // Tail zero is a valid-range verification-profile byte, NOT a recovered ID.
  // No public-key recovery is performed or claimed by this generator.
  return Buffer.concat([
    compact.subarray(0, 32),
    scalarBytes(lowS),
    Buffer.from([0]),
  ])
}

function fixedTestKeys() {
  // RFC 8410 PKCS#8: version 0; id-Ed25519; nested OCTET STRING of seed bytes.
  const edPrivate = createPrivateKey({
    key: Buffer.from(
      "302e020100300506032b657004220420" + TEST_ED25519_SEED_HEX,
      "hex",
    ),
    format: "der",
    type: "pkcs8",
  })
  // RFC 5915 SEC1: version 1; 32-byte scalar; named-curve OID 1.3.132.0.10.
  const secpPrivate = createPrivateKey({
    key: Buffer.from(
      "302e0201010420" + TEST_SECP256K1_SCALAR_HEX + "a00706052b8104000a",
      "hex",
    ),
    format: "der",
    type: "sec1",
  })
  return { ed25519: edPrivate, secp256k1: secpPrivate }
}

function publicDetails(privateKey, scheme) {
  const key = createPublicKey(privateKey)
  const jwk = key.export({ format: "jwk" })
  assert.equal(jwk.crv, scheme === "ed25519" ? "Ed25519" : "secp256k1")
  const bytes =
    scheme === "ed25519"
      ? Buffer.from(jwk.x, "base64url")
      : Buffer.concat([
          Buffer.from(jwk.x, "base64url"),
          Buffer.from(jwk.y, "base64url"),
        ])
  assert.equal(bytes.length, scheme === "ed25519" ? 32 : 64)
  return { key, bytes, text: `${scheme}:${base58(bytes)}` }
}

function publicKeyFromVector(vector) {
  const bytes = Buffer.from(vector.publicKeyHex, "hex")
  assert.equal(bytes.length, vector.scheme === "ed25519" ? 32 : 64)
  assert.equal(vector.proof.publicKey, `${vector.scheme}:${base58(bytes)}`)
  const jwk =
    vector.scheme === "ed25519"
      ? { kty: "OKP", crv: "Ed25519", x: bytes.toString("base64url") }
      : {
          kty: "EC",
          crv: "secp256k1",
          x: bytes.subarray(0, 32).toString("base64url"),
          y: bytes.subarray(32, 64).toString("base64url"),
        }
  return createPublicKey({ key: jwk, format: "jwk" })
}

function checkFixture(fixture) {
  assert.equal(fixture.fixtureVersion, 1)
  assert.deepEqual(fixture.app, app)
  assert.equal(
    fixture.provenance.generatorSha256,
    sha256(readFileSync(new URL(import.meta.url))).toString("hex"),
  )
  assert.deepEqual(fixture.provenance.sources, sources)
  assert.equal(
    fixture.vectors.length,
    casesFor("ed25519").length + casesFor("secp256k1").length,
  )
  for (const scheme of ["ed25519", "secp256k1"]) {
    for (const item of casesFor(scheme)) {
      const vector = fixture.vectors.find(
        (v) => v.id === `${scheme}-${item.suffix}`,
      )
      assert(vector, `Missing ${scheme}-${item.suffix}`)
      assert.equal(vector.scheme, scheme)
      assert.deepEqual(vector.payload, item.payload)
      const bytes = envelope(item.payload)
      const digest = sha256(bytes)
      if (item.suffix === "max-envelope") assert.equal(bytes.length, 65_536)
      assert.equal(vector.envelopeHex, bytes.toString("hex"))
      assert.equal(vector.sha256Hex, digest.toString("hex"))
      const publicKey = publicKeyFromVector(vector)
      const signature = Buffer.from(vector.proof.signature, "base64")
      assert.equal(signature.toString("base64"), vector.proof.signature)
      assert.equal(signature.length, scheme === "ed25519" ? 64 : 65)
      const valid =
        scheme === "ed25519"
          ? verify(null, digest, publicKey, signature)
          : verify(
              "sha256",
              bytes,
              { key: publicKey, dsaEncoding: "ieee-p1363" },
              signature.subarray(0, 64),
            )
      assert(valid, `${vector.id} must independently verify`)
      if (scheme === "secp256k1") {
        assert.equal(signature[64], 0)
        assert(scalar(signature.subarray(32, 64)) <= ORDER / 2n)
        // Hashing the digest instead of the envelope adds a second SHA-256 layer.
        assert.equal(
          verify(
            "sha256",
            digest,
            { key: publicKey, dsaEncoding: "ieee-p1363" },
            signature.subarray(0, 64),
          ),
          false,
        )
      }
      const expectedNegativeIds =
        item.suffix !== "receipt"
          ? []
          : scheme === "ed25519"
            ? ["raw-message", "raw-envelope", "double-hash", "wrong-domain"]
            : ["raw-message", "double-hash", "wrong-domain", "high-s"]
      assert.deepEqual(
        vector.negativeProofs.map((v) => v.id),
        expectedNegativeIds,
      )
      for (const negative of vector.negativeProofs) {
        assert.equal(negative.proof.publicKey, vector.proof.publicKey)
        const bad = Buffer.from(negative.proof.signature, "base64")
        assert.equal(bad.toString("base64"), negative.proof.signature)
        const nodeAccepts =
          scheme === "ed25519"
            ? verify(null, digest, publicKey, bad)
            : verify(
                "sha256",
                bytes,
                { key: publicKey, dsaEncoding: "ieee-p1363" },
                bad.subarray(0, 64),
              )
        if (negative.id === "high-s") {
          // OpenSSL accepts high-S mathematically. The candidate's explicit profile must deny it.
          assert(nodeAccepts)
          assert(scalar(bad.subarray(32, 64)) > ORDER / 2n)
        } else {
          assert.equal(
            nodeAccepts,
            false,
            `${vector.id}/${negative.id} must fail NEP verification`,
          )
          const edInputs = {
            "raw-message": Buffer.from(item.payload.message, "utf8"),
            "raw-envelope": bytes,
            "double-hash": sha256(digest),
            "wrong-domain": sha256(wrongDomainEnvelope(bytes)),
          }
          const secpInputs = {
            "raw-message": Buffer.from(item.payload.message, "utf8"),
            "double-hash": digest,
            "wrong-domain": wrongDomainEnvelope(bytes),
          }
          // Confirm each negative is a real signature of its stated alternate input.
          assert(
            scheme === "ed25519"
              ? verify(null, edInputs[negative.id], publicKey, bad)
              : verify(
                  "sha256",
                  secpInputs[negative.id],
                  { key: publicKey, dsaEncoding: "ieee-p1363" },
                  bad.subarray(0, 64),
                ),
          )
        }
      }
    }
  }
}

if (mode === "--check") {
  // Public verification only: no fixedTestKeys() call and no signing operation.
  const fixture = JSON.parse(readFileSync(fixtureUrl, "utf8"))
  checkFixture(fixture)
  console.log(
    `Independently checked ${fixture.vectors.length} public NEP-413 vectors`,
  )
} else {
  const keys = fixedTestKeys()
  const vectors = []
  for (const scheme of ["ed25519", "secp256k1"]) {
    const privateKey = keys[scheme]
    const pub = publicDetails(privateKey, scheme)
    for (const item of casesFor(scheme)) {
      const bytes = envelope(item.payload)
      const digest = sha256(bytes)
      // ECDSA is handed the raw envelope: Node applies SHA-256 exactly once.
      // Ed25519 is handed the NEP digest and uses ordinary Ed25519, not Ed25519ph.
      const signature =
        scheme === "ed25519"
          ? sign(null, digest, privateKey)
          : nearSecpSignature(
              sign("sha256", bytes, {
                key: privateKey,
                dsaEncoding: "ieee-p1363",
              }),
            )
      const proof = {
        publicKey: pub.text,
        signature: signature.toString("base64"),
      }
      const negativeProofs = []
      if (item.suffix === "receipt") {
        const rawMessage = Buffer.from(item.payload.message, "utf8")
        const wrongInputs =
          scheme === "ed25519"
            ? [
                [
                  "raw-message",
                  "Ed25519 over message UTF-8 instead of NEP digest",
                  rawMessage,
                ],
                [
                  "raw-envelope",
                  "Ed25519 over the envelope instead of its SHA-256 digest",
                  bytes,
                ],
                [
                  "double-hash",
                  "Ed25519 over SHA256(SHA256(envelope))",
                  sha256(digest),
                ],
                [
                  "wrong-domain",
                  "Ed25519 over SHA256(envelope with tag 2^31 + 414)",
                  sha256(wrongDomainEnvelope(bytes)),
                ],
              ]
            : [
                [
                  "raw-message",
                  "ECDSA over SHA256(message UTF-8), without the NEP envelope",
                  rawMessage,
                ],
                ["double-hash", "ECDSA over SHA256(SHA256(envelope))", digest],
                [
                  "wrong-domain",
                  "ECDSA over SHA256(envelope with tag 2^31 + 414)",
                  wrongDomainEnvelope(bytes),
                ],
              ]
        for (const [id, reason, input] of wrongInputs) {
          const negative =
            scheme === "ed25519"
              ? sign(null, input, privateKey)
              : nearSecpSignature(
                  sign("sha256", input, {
                    key: privateKey,
                    dsaEncoding: "ieee-p1363",
                  }),
                )
          negativeProofs.push({
            id,
            reason,
            proof: {
              publicKey: pub.text,
              signature: negative.toString("base64"),
            },
          })
        }
        if (scheme === "secp256k1") {
          const highS = Buffer.concat([
            signature.subarray(0, 32),
            scalarBytes(ORDER - scalar(signature.subarray(32, 64))),
            Buffer.from([0]),
          ])
          negativeProofs.push({
            id: "high-s",
            reason:
              "Mathematically valid ECDSA excluded by explicit low-S verification policy",
            proof: { publicKey: pub.text, signature: highS.toString("base64") },
          })
        }
      }
      vectors.push({
        id: `${scheme}-${item.suffix}`,
        scheme,
        payload: item.payload,
        envelopeHex: bytes.toString("hex"),
        sha256Hex: digest.toString("hex"),
        publicKeyHex: pub.bytes.toString("hex"),
        proof,
        negativeProofs,
      })
    }
  }
  const fixture = {
    fixtureVersion: 1,
    purpose:
      "Published disposable off-chain NEP-413 test fixtures; no account or wallet authority",
    app,
    provenance: {
      implementation:
        "Independent fixed-field framing and Node.js built-in OpenSSL crypto; no candidate imports",
      node: process.version,
      openssl: process.versions.openssl,
      generatorSha256: sha256(readFileSync(new URL(import.meta.url))).toString(
        "hex",
      ),
      ed25519:
        "Fixed public test seed; deterministic Ed25519(SHA256(envelope))",
      secp256k1:
        "Fixed public test scalar; Node SHA256 ECDSA over envelope; low-S; randomized signatures",
      secp256k1Tail:
        "Zero is only a valid-range verification-profile tail; actual public-key recovery ID is not derived or claimed",
      reproducibility:
        "Keys, framing, digests, Ed25519 signatures are reproducible; ECDSA signatures vary on regeneration",
      sources,
    },
    vectors,
  }
  checkFixture(fixture)
  writeFileSync(fixtureUrl, JSON.stringify(fixture, null, 2) + "\n")
  console.log(
    `Wrote and independently checked ${vectors.length} public NEP-413 vectors`,
  )
}
