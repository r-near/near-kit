export const reference = (at) =>
  at === "final" ? { finality: "final" } : { blockId: at }
export const wireReference = (at) =>
  at === "final" ? { finality: "final" } : { block_id: at }
export const metadata = (wire) => ({
  blockHash: wire.block_hash,
  blockHeight: wire.block_height,
})
export const projectAccount = (wire) => ({
  amount: BigInt(wire.amount),
  locked: BigInt(wire.locked),
  storageUsage: wire.storage_usage,
  codeHash: wire.code_hash,
  ...metadata(wire),
})
export function count(value) {
  if (
    value === null ||
    typeof value !== "object" ||
    typeof value.count !== "number" ||
    !Number.isFinite(value.count)
  )
    throw new Error("Result schema mismatch")
  return { count: value.count }
}
export const projectView = (wire) => ({
  value: count(
    JSON.parse(new TextDecoder().decode(new Uint8Array(wire.result))),
  ),
  logs: wire.logs,
  ...metadata(wire),
})
export const projectBytes = (wire) => ({
  value: new Uint8Array(wire.result),
  logs: wire.logs,
  ...metadata(wire),
})
export const four = (api, hash) =>
  Promise.all([
    api.account("alice.testnet", hash),
    api.account("bob.testnet", hash),
    api.view("contract.testnet", hash),
    api.view("contract.testnet", hash),
  ])
