# Disposable off-chain NEP-413 fixtures

This directory is test-only. The generator has no package dependency and imports
no near-kit encoder, verifier, transaction serializer, signer, or wallet. Its
output is public JSON consumed by verifier and application-receipt tests. The
generator is not imported by those tests or shipped as a production API.

The fixed test account `auth-fixture.sandbox` is an uncreated label, not a claim
about a funded account. There are no network calls. The published Ed25519 seed is
32 bytes of `01`; the secp256k1 scalar is 31 zero bytes followed by `01`. These
values are disposable test material: never fund them, attach them to an account,
or reuse them outside these fixtures. No user key, credential, environment
secret, keystore, or command-line key input is read.

## Running

Run only after the authentication dependency/implementation entry gate is cleared:

```sh
node test/fixtures/nep413/generate.mjs --write
node test/fixtures/nep413/generate.mjs --check
```

`--write` signs only the fixed off-chain test inputs and writes `vectors.json`.
`--check` independently checks public fixture framing, digests and signatures;
it never loads the disposable signing keys or calls a signing operation. Neither
command installs dependencies. The output records exact Node and OpenSSL versions
and the SHA-256 of the generator source. Node 24.19.0 is the reference runtime.

Keys, envelope bytes, digests and Ed25519 signatures reproduce exactly. Node's
ECDSA signatures are randomized, so regeneration changes their public signature
bytes while preserving verified behavior. Normal tests consume the checked-in
JSON and do not regenerate it. `--check` verifies those saved signatures without
requiring byte-for-byte ECDSA regeneration.

## Independent framing and hash semantics

The generator directly concatenates the NEP-413 tag bytes `9d 01 00 80`, a
little-endian u32 UTF-8 message byte length and message, the raw 32-byte nonce,
a length-prefixed recipient, and the callback option byte plus length-prefixed
callback when present. The tag and field recipe come from
[NEP-413](https://github.com/near/NEPs/blob/master/neps/nep-0413.md).
Absent and empty callbacks have distinct encodings. Unicode and embedded NUL
fixtures exercise byte lengths without normalizing the text.

Ed25519 calls `sign(null, SHA256(envelope), key)`. Secp256k1 calls
`sign("sha256", envelope, { key, dsaEncoding: "ieee-p1363" })` with the raw
envelope. Node specifies the digest through the algorithm parameter and emits
fixed-width `r || s` for IEEE-P1363. Thus Node performs the secp256k1 envelope hash
once. Passing the already-computed digest would double-hash; a negative fixture
and independent verification check demonstrate that mismatch.
[Node 24.19.0 crypto documentation](https://nodejs.org/download/release/v24.19.0/docs/api/crypto.html#cryptosignalgorithm-data-key-callback)

The generator replaces a high ECDSA `s` with `n - s`. It appends a zero tail byte
to produce the selected 65-byte verification-profile input. That tail is only
in the accepted range 0–3; it is **not asserted to be the actual recovery ID**.
No public-key recovery or wallet-emitted signature is claimed. The supplied
64-byte x/y public key determines ordinary verification. This intentionally
tests the documented verifier profile and trailing-byte handling, not recovery.
[Nearcore 2.13.4 signature representation](https://github.com/near/nearcore/blob/2.13.4/core/crypto/src/signature.rs)

The fixed Ed25519 seed is wrapped using
[RFC 8410 PKCS#8](https://www.rfc-editor.org/rfc/rfc8410.html#section-7);
the fixed EC scalar uses
[RFC 5915 SEC1](https://www.rfc-editor.org/rfc/rfc5915.html#section-3).
Node derives the public keys. Base58 conversion is a tiny independent test-only
integer encoding, not a call to the candidate's public-key codec.

## Receipt contract and coverage

`vectors.json.app` gives the fixed clock, source, account, origin and tokens.
Token injection order is browser binding, challenge ID, session ID. The issued
time is `2026-10-01T00:00:00.000Z`; expiry is exactly 300,000 milliseconds later.
The public nonce contains byte values 0 through 31. The complete newline-delimited
receipt message is independently transcribed in this generator. Receipt tests
must compare the actual `/challenge` message, nonce and recipient against the
`ed25519-receipt` or `secp256k1-receipt` fixture before submitting its proof.

Each vector includes its payload (`nonceHex` decodes to the payload's bytes),
envelope hex, digest hex, raw public-key hex and wire proof. Both algorithms have
receipt, empty-callback, Unicode-callback and Unicode-message cases. Receipt
vectors include wrong-message, wrong-domain-tag and double-hash negative proofs; Ed25519 also
includes a raw-envelope proof. Secp256k1 includes a mathematically valid high-S
proof which OpenSSL accepts and the candidate's explicit low-S profile must deny.
One Ed25519 fixture has exactly the maximum 65,536-byte envelope. `--check` also
verifies each negative proof against the alternate input it claims to sign, so
arbitrary broken signatures cannot masquerade as domain/hash-layer evidence.

These vectors establish independent public cryptographic interoperability and
the app's exact fixture payload. They do not establish live-wallet behavior,
public-key recovery, account authority, replay resistance, or session safety.
Those last application properties require the separate controlled HTTP/RPC
receipt tests, and no wallet or transaction path is executed by this generator.
