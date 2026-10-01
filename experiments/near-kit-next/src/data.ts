import { base58 } from "@scure/base"

/** Public encodings only; a hash handle is not a full public key. */
export type PublicKeyReference =
  | { readonly kind: "ed25519"; readonly data: Uint8Array }
  | { readonly kind: "secp256k1"; readonly data: Uint8Array }
  | { readonly kind: "ml-dsa-65"; readonly data: Uint8Array }
  | { readonly kind: "ml-dsa-65-hash"; readonly data: Uint8Array }

export type FullPublicKey = Exclude<
  PublicKeyReference,
  { readonly kind: "ml-dsa-65-hash" }
>

/** Tests the canonical 2–64 character ASCII grammar, not account existence. */
export function isAccountId(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 2 || value.length > 64)
    return false
  let separator = true
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if ((code >= 97 && code <= 122) || (code >= 48 && code <= 57)) {
      separator = false
    } else if ((code === 45 || code === 46 || code === 95) && !separator) {
      separator = true
    } else {
      return false
    }
  }
  return !separator
}

/** Returns a canonical account ID or throws a sanitized TypeError/RangeError. */
export function parseAccountId(value: string): string {
  if (typeof value !== "string")
    throw new TypeError("Expected an account ID string")
  if (!isAccountId(value)) throw new RangeError("Invalid account ID")
  return value
}

function keyKind(value: unknown): PublicKeyReference["kind"] {
  if (typeof value !== "string")
    throw new TypeError("Expected a public key kind")
  switch (value) {
    case "ed25519":
    case "secp256k1":
    case "ml-dsa-65":
    case "ml-dsa-65-hash":
      return value
    default:
      throw new RangeError("Invalid public key kind")
  }
}

function keyLength(kind: PublicKeyReference["kind"]): number {
  switch (kind) {
    case "ed25519":
    case "ml-dsa-65-hash":
      return 32
    case "secp256k1":
      return 64
    case "ml-dsa-65":
      return 1952
  }
}

function decodeFixed(
  value: string,
  byteLength: number,
  label: "hash" | "public key",
): Uint8Array {
  // Base58 conversion is quadratic. Bound text before entering the codec.
  const maxLength = byteLength === 1952 ? 2666 : byteLength === 64 ? 88 : 44
  if (
    value.length < byteLength ||
    value.length > maxLength ||
    /[^1-9A-HJ-NP-Za-km-z]/.test(value)
  )
    throw new RangeError(`Invalid ${label} encoding`)
  let bytes: Uint8Array
  try {
    bytes = base58.decode(value)
  } catch {
    // The codec's diagnostics may include its input; do not propagate them.
    throw new RangeError(`Invalid ${label} encoding`)
  }
  if (bytes.length !== byteLength || base58.encode(bytes) !== value)
    throw new RangeError(`Invalid ${label} encoding`)
  return new Uint8Array(bytes)
}

function copyFixed(
  value: unknown,
  byteLength: number,
  label: "hash" | "public key",
): Uint8Array {
  if (!(value instanceof Uint8Array))
    throw new TypeError(`Expected ${label} bytes`)
  if (value.length !== byteLength)
    throw new RangeError(`Invalid ${label} byte length`)
  const bytes = new Uint8Array(value)
  // An arbitrary caller can shadow a typed array's length property.
  if (bytes.length !== byteLength)
    throw new RangeError(`Invalid ${label} byte length`)
  return bytes
}

/** Decodes a canonical base58 32-byte hash into a fresh owned buffer. */
export function parseHash(value: string): Uint8Array {
  if (typeof value !== "string") throw new TypeError("Expected a hash string")
  return decodeFixed(value, 32, "hash")
}

/** Encodes exactly 32 bytes; this does not calculate or verify a content hash. */
export function formatHash(value: Uint8Array): string {
  return base58.encode(copyFixed(value, 32, "hash"))
}

/**
 * Decodes an explicitly prefixed public key or view handle into owned bytes.
 * Encoding validity does not establish a valid curve point or key ownership.
 */
export function parsePublicKey(value: string): PublicKeyReference {
  if (typeof value !== "string")
    throw new TypeError("Expected a public key string")
  if (value.length > 2676) throw new RangeError("Invalid public key encoding")
  const separator = value.indexOf(":")
  if (separator < 1) throw new RangeError("Invalid public key encoding")
  const kind = keyKind(value.slice(0, separator))
  const data = decodeFixed(
    value.slice(separator + 1),
    keyLength(kind),
    "public key",
  )
  return { kind, data }
}

/** Validates the kind and exact byte length again, then returns canonical text. */
export function formatPublicKey(value: PublicKeyReference): string {
  if (typeof value !== "object" || value === null)
    throw new TypeError("Expected a public key reference")
  const kind = keyKind(value.kind)
  const data = copyFixed(value.data, keyLength(kind), "public key")
  return `${kind}:${base58.encode(data)}`
}
