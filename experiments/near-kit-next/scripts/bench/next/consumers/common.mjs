import { metadata } from "./account-common.mjs"

export { projectAccount } from "./account-common.mjs"

import { base58, base64 } from "@scure/base"
export const projectBlock = ({ header: h }) => ({
  blockHash: h.hash,
  blockHeight: BigInt(h.height),
  previousHash: h.prev_hash,
  timestampNanoseconds: BigInt(h.timestamp_nanosec),
  gasPrice: BigInt(h.gas_price),
})
export const projectKeys = (wire) => ({
  ...metadata(wire),
  keys: wire.keys.map((key) => ({
    publicKey: {
      kind: "ed25519",
      data: base58.decode(key.public_key.slice(8)),
    },
    accessKey: {
      nonce: BigInt(key.access_key.nonce),
      permission:
        key.access_key.permission === "FullAccess"
          ? { kind: "FullAccess" }
          : {
              kind: "FunctionCall",
              allowance:
                key.access_key.permission.FunctionCall.allowance === null
                  ? null
                  : BigInt(key.access_key.permission.FunctionCall.allowance),
              receiverId: key.access_key.permission.FunctionCall.receiver_id,
              methodNames: key.access_key.permission.FunctionCall.method_names,
            },
    },
  })),
})
export const projectCode = (wire) => ({
  ...metadata(wire),
  bytes: base64.decode(wire.code_base64),
  codeHash: wire.hash,
})
export const projectPage = (wire) => ({
  ...metadata(wire),
  entries: wire.values.map((row) => ({
    key: base64.decode(row.key),
    value: base64.decode(row.value),
  })),
  ...(wire.last_key === undefined
    ? {}
    : { nextCursor: base64.decode(wire.last_key) }),
})
export const line = (value) =>
  `${JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString(10) : v instanceof Uint8Array ? { encoding: "base64", data: base64.encode(v) } : v))}\n`
export const begin = (accountId) => ({
  type: "begin",
  format: "near-kit-snapshot-v1",
  accountId,
  bigints: "decimal-string",
  bytes: "tagged-base64",
})
// Shared application composition, not SDK-level validation or atomic file publication.
export const collectSnapshot = async (api, accountId, signal) => {
  const lines = [line(begin(accountId))]
  const block = await api.block(signal),
    hash = block.blockHash
  const [account, keys, code, gasPrice] = await Promise.all([
    api.account(accountId, hash, signal),
    api.keys(accountId, hash, signal),
    api.code(accountId, hash, signal),
    api.gas(hash, signal),
  ])
  lines.push(
    line({
      type: "header",
      block,
      account,
      keys,
      accountCode: { status: "available", code },
      gasPrice,
    }),
  )
  let pages = 0n,
    entries = 0n,
    cursor
  do {
    const page = await api.page(accountId, hash, cursor, signal)
    lines.push(line({ type: "state-page", page }))
    pages++
    entries += BigInt(page.entries.length)
    cursor =
      page.nextCursor === undefined ? undefined : base64.encode(page.nextCursor)
  } while (cursor !== undefined)
  lines.push(line({ type: "end", blockHash: hash, pages, entries }))
  return lines.join("")
}
