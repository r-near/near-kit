export const metadata = wire => ({ blockHash: wire.block_hash, blockHeight: BigInt(wire.block_height) })
export const projectAccount = wire => ({ amount: BigInt(wire.amount), locked: BigInt(wire.locked), storageUsage: BigInt(wire.storage_usage), codeHash: wire.code_hash, ...metadata(wire) })
export const reference = at => at === "final" ? { finality: "final" } : { blockId: at }
export const wireReference = at => at === "final" ? { finality: "final" } : { block_id: at }
