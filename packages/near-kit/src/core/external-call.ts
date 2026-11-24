/**
 * External contract calls (NEP-667, nearcore 2.15, protocol version 89).
 *
 * An external call has no signer, key, nonce or signature: the contract named
 * by `contractId` authorizes it in its reserved `__external_call` method and
 * pays for it from its own balance. This module holds the wire format and the
 * ids derived from it.
 *
 * @see https://github.com/near/NEPs/pull/667
 */

import { sha256 } from "@noble/hashes/sha2.js"
import { base58 } from "@scure/base"
import { InvalidAccountIdError } from "../errors/index.js"
import { isValidAccountId } from "../utils/validation.js"

/** The contract method an external call runs. */
export const EXTERNAL_CALL_METHOD_NAME = "__external_call"

/**
 * First byte of an encoded external call. No signed transaction starts with
 * it, which is how a `TransactionEnvelope` tells the two kinds apart.
 */
export const EXTERNAL_CALL_ESCAPE_BYTE = 0xff

/** Version of the external call encoding, the byte after the escape byte. */
export const EXTERNAL_CALL_VERSION = 0

const MAX_U32 = 0xffff_ffff
const MAX_U64 = 0xffff_ffff_ffff_ffffn

/**
 * An external contract call.
 */
export interface ExternalCall {
  /** The contract that authorizes, pays for and receives the call. */
  contractId: string
  /** Opaque input, passed to `__external_call` as its input. */
  payload: Uint8Array
  /**
   * The raw bytes of a universal (`0u`) account's `UniversalStateInit`,
   * installed before the run when the account is not initialized yet.
   */
  stateInit?: Uint8Array
}

function encodeU32(value: number): Uint8Array {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setUint32(0, value, true)
  return out
}

function encodeBytes(bytes: Uint8Array): Uint8Array[] {
  if (bytes.length > MAX_U32) {
    throw new Error(`Byte string too long to encode: ${bytes.length} bytes`)
  }
  return [encodeU32(bytes.length), bytes]
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

/**
 * Borsh-encode an external call, as `send_tx` takes it in
 * `external_call_base64` and as a chunk holds it:
 * `0xFF || version || borsh(contract_id) || borsh(payload) || borsh(state_init)`.
 *
 * @throws {InvalidAccountIdError} If `contractId` is not a valid account ID.
 */
export function encodeExternalCall(call: ExternalCall): Uint8Array {
  if (!isValidAccountId(call.contractId)) {
    throw new InvalidAccountIdError(call.contractId)
  }
  const contractId = new TextEncoder().encode(call.contractId)
  const stateInit =
    call.stateInit === undefined
      ? [Uint8Array.of(0)]
      : [Uint8Array.of(1), ...encodeBytes(call.stateInit)]
  return concat([
    Uint8Array.of(EXTERNAL_CALL_ESCAPE_BYTE, EXTERNAL_CALL_VERSION),
    ...encodeBytes(contractId),
    ...encodeBytes(call.payload),
    ...stateInit,
  ])
}

/**
 * Decode a borsh-encoded external call.
 *
 * @throws {Error} If the bytes are not a version 0 external call, are
 * truncated, or have bytes left over.
 */
export function decodeExternalCall(bytes: Uint8Array): ExternalCall {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 0
  const take = (length: number): Uint8Array => {
    if (offset + length > bytes.length) {
      throw new Error("Truncated external call")
    }
    const out = bytes.slice(offset, offset + length)
    offset += length
    return out
  }
  const takeBytes = (): Uint8Array => {
    if (offset + 4 > bytes.length) {
      throw new Error("Truncated external call")
    }
    const length = view.getUint32(offset, true)
    offset += 4
    return take(length)
  }

  const [escapeByte, version] = take(2)
  if (escapeByte !== EXTERNAL_CALL_ESCAPE_BYTE) {
    throw new Error(`Invalid external call escape byte: ${escapeByte}`)
  }
  if (version !== EXTERNAL_CALL_VERSION) {
    throw new Error(`Unsupported external call version: ${version}`)
  }
  const contractId = new TextDecoder("utf-8", { fatal: true }).decode(
    takeBytes(),
  )
  const payload = takeBytes()
  const [tag] = take(1)
  let stateInit: Uint8Array | undefined
  if (tag === 1) {
    stateInit = takeBytes()
  } else if (tag !== 0) {
    throw new Error(`Invalid option tag for state_init: ${tag}`)
  }
  if (offset !== bytes.length) {
    throw new Error(
      `Unexpected ${bytes.length - offset} trailing bytes after external call`,
    )
  }
  if (!isValidAccountId(contractId)) {
    throw new InvalidAccountIdError(contractId)
  }
  return stateInit === undefined
    ? { contractId, payload }
    : { contractId, payload, stateInit }
}

/**
 * The call hash: the SHA-256 of the call's encoding without its state init.
 *
 * Every copy of the call gets its unique id from this hash, whether or not
 * the copy carries the state init, and a waiting `send_tx` finds the copy
 * that landed by it.
 *
 * @returns The 32-byte hash.
 */
export function externalCallHashBytes(call: ExternalCall): Uint8Array {
  return sha256(
    encodeExternalCall({ contractId: call.contractId, payload: call.payload }),
  )
}

/**
 * The call hash as a base58 string. See {@link externalCallHashBytes}.
 */
export function externalCallHash(call: ExternalCall): string {
  return base58.encode(externalCallHashBytes(call))
}

function toHeight(height: number | bigint): bigint {
  if (typeof height === "number" && !Number.isSafeInteger(height)) {
    throw new Error(`Block height must be a safe integer, got ${height}`)
  }
  const value = BigInt(height)
  if (value < 0n || value > MAX_U64) {
    throw new Error(`Block height out of the u64 range: ${height}`)
  }
  return value
}

function toHashBytes(hash: string | Uint8Array): Uint8Array {
  const bytes = typeof hash === "string" ? base58.decode(hash) : hash
  if (bytes.length !== 32) {
    throw new Error(`Call hash must be 32 bytes, got ${bytes.length} bytes`)
  }
  return bytes
}

/**
 * The unique id of the copy of a call included in the block at `height`:
 * `sha256(call_hash || height as u64 little endian)`. It is the copy's
 * outcome id, the `transaction_id` of its transaction view, and the
 * `tx_hash` to look it up by.
 *
 * @param call - The call, or its call hash (base58 or 32 bytes).
 * @param height - Height of the block that includes the copy.
 * @returns The unique id as a base58 string.
 */
export function externalCallUniqueId(
  call: ExternalCall | string | Uint8Array,
  height: number | bigint,
): string {
  const callHash =
    typeof call === "string" || call instanceof Uint8Array
      ? toHashBytes(call)
      : externalCallHashBytes(call)
  const input = new Uint8Array(40)
  input.set(callHash, 0)
  new DataView(input.buffer).setBigUint64(32, toHeight(height), true)
  return base58.encode(sha256(input))
}
