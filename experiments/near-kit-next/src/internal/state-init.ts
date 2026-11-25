import { parseAccountId, parseHash } from "../data.js"

/** Public NEP-616 V1 storage bytes; this does not prepare an on-chain action. */
export interface StateInit {
  readonly code:
    | { readonly hash: string; readonly accountId?: never }
    | { readonly accountId: string; readonly hash?: never }
  readonly data?: ReadonlyArray<readonly [Uint8Array, Uint8Array]>
}

const u32 = 0xffff_ffff
const bufferLength = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "byteLength",
)?.get
if (bufferLength === undefined)
  throw new Error("ArrayBuffer support is required")

function copyBytes(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array))
    throw new TypeError("Expected storage bytes")
  // Read caller properties outside the input-conversion catch. Caller code
  // (including getters) is not an expected decoder failure.
  const buffer = value.buffer
  const offset = value.byteOffset
  const length = value.byteLength
  let view: Uint8Array
  try {
    // A native ArrayBuffer brand check also rejects cross-realm shared backing.
    bufferLength?.call(buffer)
    view = new Uint8Array(buffer, offset, length)
  } catch (error) {
    if (error instanceof TypeError)
      throw new TypeError("Expected attached, non-shared storage bytes")
    throw error
  }
  if (view.byteLength > u32) throw new RangeError("Storage field exceeds u32")
  return new Uint8Array(view)
}

function compareBytes(left: Uint8Array, right: Uint8Array): number {
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    const difference = (left[index] as number) - (right[index] as number)
    if (difference !== 0) return difference
  }
  return left.length - right.length
}

/** Internal fixed public-data codec; deliberately not a generic Borsh API. */
export function encodeStateInit(input: StateInit): Uint8Array {
  if (typeof input !== "object" || input === null)
    throw new TypeError("Expected public state initialization data")
  const code = input.code
  const data = input.data
  if (typeof code !== "object" || code === null)
    throw new TypeError("Expected a global code reference")
  const hash = "hash" in code
  const account = "accountId" in code
  if (hash === account)
    throw new RangeError("Expected exactly one global code reference")
  const codeBytes = hash
    ? parseHash(code.hash as string)
    : new TextEncoder().encode(parseAccountId(code.accountId as string))
  if (data !== undefined && !Array.isArray(data))
    throw new TypeError("Expected a storage entry array")
  const entries = (data ?? []).map((entry) => {
    if (!Array.isArray(entry) || entry.length !== 2)
      throw new TypeError("Expected a storage key/value tuple")
    return [copyBytes(entry[0]), copyBytes(entry[1])] as const
  })
  if (entries.length > u32) throw new RangeError("Storage count exceeds u32")
  entries.sort((left, right) => compareBytes(left[0], right[0]))
  let total = 2 + (hash ? 0 : 4) + codeBytes.length + 4
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]
    // Array.map preserves holes; a sparse entry list is invalid input.
    if (entry === undefined) throw new TypeError("Expected a storage tuple")
    const previous = entries[index - 1]
    if (previous !== undefined && compareBytes(previous[0], entry[0]) === 0)
      throw new RangeError("Duplicate storage key")
    total += 8 + entry[0].length + entry[1].length
    if (!Number.isSafeInteger(total))
      throw new RangeError("Encoded state length exceeds safe integer range")
  }
  const bytes = new Uint8Array(total)
  const view = new DataView(bytes.buffer)
  let offset = 0
  bytes[offset++] = 0 // DeterministicAccountStateInit::V1
  bytes[offset++] = hash ? 0 : 1 // GlobalContractIdentifier
  const count = (value: number) => {
    view.setUint32(offset, value, true)
    offset += 4
  }
  const append = (value: Uint8Array) => {
    bytes.set(value, offset)
    offset += value.length
  }
  if (!hash) count(codeBytes.length)
  append(codeBytes)
  count(entries.length)
  for (const [key, value] of entries) {
    count(key.length)
    append(key)
    count(value.length)
    append(value)
  }
  return bytes
}
