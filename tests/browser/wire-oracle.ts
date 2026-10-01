/** Independent, deliberately small NEAR wire oracle: no SDK encoders/crypto. */
import { createHash, createPublicKey, verify } from "node:crypto"

const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
export function base58(bytes: Uint8Array): string {
  let n = BigInt(`0x${Buffer.from(bytes).toString("hex") || "0"}`)
  let text = ""
  while (n > 0n) {
    text = alphabet[Number(n % 58n)] + text
    n /= 58n
  }
  for (const byte of bytes) {
    if (byte !== 0) break
    text = "1" + text
  }
  return text
}
function unbase58(text: string): Buffer {
  let n = 0n
  for (const character of text) {
    const value = alphabet.indexOf(character)
    if (value < 0) throw new Error("Invalid base58")
    n = n * 58n + BigInt(value)
  }
  const hex = n
    .toString(16)
    .padStart(Math.ceil(n.toString(16).length / 2) * 2, "0")
  return Buffer.concat([
    Buffer.alloc(text.match(/^1*/)?.[0].length ?? 0),
    n ? Buffer.from(hex, "hex") : Buffer.alloc(0),
  ])
}
function verifyEd25519(
  publicKey: Uint8Array,
  signature: Uint8Array,
  payload: Uint8Array,
) {
  const key = createPublicKey({
    key: Buffer.concat([
      Buffer.from("302a300506032b6570032100", "hex"),
      publicKey,
    ]),
    format: "der",
    type: "spki",
  })
  return verify(
    null,
    createHash("sha256").update(payload).digest(),
    key,
    signature,
  )
}
export interface WireAction {
  kind: "transfer" | "functionCall"
  deposit: string
  method?: string
  args?: Record<string, unknown>
  gas?: string
}
export interface WireTransaction {
  version: 0 | 1
  signerId: string
  receiverId: string
  publicKey: string
  nonce: number
  nonceIndex?: number
  strict: boolean
  blockHash: string
  actions: WireAction[]
  hash: string
  signatureValid: boolean
}
export function inspectSignedTransaction(encoded: string): WireTransaction {
  const bytes = Buffer.from(encoded, "base64")
  let offset = 0
  function take(size: number): Buffer {
    if (offset + size > bytes.length) throw new Error("Truncated transaction")
    const result = bytes.subarray(offset, offset + size)
    offset += size
    return result
  }
  const u8 = () => take(1).readUInt8()
  const u32 = () => take(4).readUInt32LE()
  const u64 = () => take(8).readBigUInt64LE()
  const string = () => take(u32()).toString("utf8")
  const u128 = () => {
    const low = u64()
    return (low + (u64() << 64n)).toString()
  }
  const version = bytes[0] === 1 ? 1 : 0
  if (version === 1) u8()
  const signerId = string()
  if (u8() !== 0) throw new Error("Oracle expects disposable Ed25519 keys")
  const publicBytes = take(32)
  const nonceKind = version === 1 ? u8() : 0
  if (nonceKind > 1) throw new Error("Unknown nonce kind")
  const nonce = Number(u64())
  const nonceIndex = nonceKind === 1 ? take(2).readUInt16LE() : undefined
  const receiverId = string()
  const blockHash = base58(take(32))
  const actions: WireAction[] = []
  const count = u32()
  for (let i = 0; i < count; i++) {
    const kind = u8()
    if (kind === 3) actions.push({ kind: "transfer", deposit: u128() })
    else if (kind === 2) {
      const method = string()
      const args: Record<string, unknown> = JSON.parse(string())
      const gas = u64().toString()
      actions.push({ kind: "functionCall", method, args, gas, deposit: u128() })
    } else throw new Error(`Unexpected action ${kind}`)
  }
  const strict = version === 1 ? u8() === 1 : false
  const unsigned = bytes.subarray(0, offset)
  if (u8() !== 0) throw new Error("Unexpected signature algorithm")
  const signature = take(64)
  if (offset !== bytes.length) throw new Error("Trailing transaction bytes")
  return {
    version,
    signerId,
    receiverId,
    nonce,
    strict,
    blockHash,
    actions,
    ...(nonceIndex === undefined ? {} : { nonceIndex }),
    publicKey: `ed25519:${base58(publicBytes)}`,
    hash: base58(createHash("sha256").update(unsigned).digest()),
    signatureValid: verifyEd25519(publicBytes, signature, unsigned),
  }
}
export function verifyMessage(
  signed: { publicKey: string; signature: string },
  params: {
    message: string
    recipient: string
    nonce: number[]
    callbackUrl?: string
  },
): boolean {
  const u32 = (n: number) => {
    const b = Buffer.alloc(4)
    b.writeUInt32LE(n)
    return b
  }
  const string = (s: string) =>
    Buffer.concat([u32(Buffer.byteLength(s)), Buffer.from(s)])
  const payload = Buffer.concat([
    u32(2 ** 31 + 413),
    string(params.message),
    Buffer.from(params.nonce),
    string(params.recipient),
    params.callbackUrl === undefined
      ? Buffer.from([0])
      : Buffer.concat([Buffer.from([1]), string(params.callbackUrl)]),
  ])
  return verifyEd25519(
    unbase58(signed.publicKey.slice("ed25519:".length)),
    Buffer.from(signed.signature, "base64"),
    payload,
  )
}
