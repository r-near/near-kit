import { once } from "node:events"
import { createServer } from "node:http"

export const hash = "56xEo2LorUFVNbkFhCncFSWNiobdp1kzm14nZ47b5JVW"
export const previousHash = "11111111111111111111111111111111"
export const id = "fixture.testnet"
export const meta = { block_hash: hash, block_height: 123 }
export const amount = "340282366920938463463374607431768211455"
export const account = {
  ...meta,
  amount,
  locked: "0",
  storage_usage: 410,
  storage_paid_at: 0,
  code_hash: previousHash,
}
export const block = {
  author: "node.testnet",
  chunks: [],
  header: {
    hash,
    prev_hash: previousHash,
    height: 123,
    timestamp_nanosec: "18446744073709551615",
    gas_price: amount,
    epoch_id: hash,
    next_epoch_id: hash,
    prev_state_root: hash,
    chunk_receipts_root: hash,
    chunk_headers_root: hash,
    chunk_tx_root: hash,
    outcome_root: hash,
    chunks_included: 0,
    challenges_root: hash,
    timestamp: 123,
    random_value: hash,
    validator_proposals: [],
    chunk_mask: [],
    total_supply: amount,
    challenges_result: [],
    last_final_block: hash,
    last_ds_final_block: hash,
    next_bp_hash: hash,
    block_merkle_root: hash,
    approvals: [],
    signature: "ed25519:fixture",
    latest_protocol_version: 84,
  },
}
export const keys = {
  ...meta,
  keys: [
    {
      public_key: `ed25519:${hash}`,
      access_key: {
        nonce: 42,
        permission: {
          FunctionCall: {
            allowance: amount,
            receiver_id: "contract.testnet",
            method_names: ["read"],
          },
        },
      },
    },
  ],
}
export const code = { ...meta, hash: previousHash, code_base64: "AGFzbQEAAAA=" }
export const pages = Array.from({ length: 3 }, (_, page) => {
  const values = Array.from({ length: page === 2 ? 37 : 100 }, (_, row) => {
    const key = Buffer.alloc(2)
    key.writeUInt16BE(page * 100 + row)
    const value = Buffer.from(
      Array.from({ length: 64 }, (_, i) => (page * 100 + row + i) % 256),
    )
    return { key: key.toString("base64"), value: value.toString("base64") }
  })
  return {
    ...meta,
    values,
    ...(page < 2 ? { last_key: values.at(-1).key } : {}),
  }
})

export async function fixture() {
  const counts = {},
    violations = []
  const server = createServer(async (request, response) => {
    const path = request.url
    counts[path] ??= {
      requests: 0,
      types: {},
      selectors: {},
      cursors: {},
      interruptedBodies: 0,
    }
    const count = counts[path]
    count.requests++
    response.on("close", () => {
      if (!response.writableEnded) count.interruptedBodies++
    })
    try {
      const chunks = []
      for await (const part of request) chunks.push(part)
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"))
      const p = body.params
      if (
        request.method !== "POST" ||
        body.jsonrpc !== "2.0" ||
        !["block", "gas_price", "query"].includes(body.method)
      )
        throw Error("Non-read method")
      const type = body.method === "query" ? p.request_type : body.method
      if (
        ![
          "block",
          "gas_price",
          "view_account",
          "view_code",
          "view_access_key_list",
          "view_state",
        ].includes(type)
      )
        throw Error("Unsupported read")
      count.types[type] = (count.types[type] ?? 0) + 1
      const snapshot = /\/(snapshot|file-export)$/.test(path)
      const expected = snapshot && type !== "block" ? "hash" : "final"
      const actual =
        type === "gas_price"
          ? p.length === 1 && p[0] === hash
            ? "hash"
            : "invalid"
          : p.finality === "final" && !Object.hasOwn(p, "block_id")
            ? "final"
            : p.block_id === hash && !Object.hasOwn(p, "finality")
              ? "hash"
              : "invalid"
      count.selectors[actual] = (count.selectors[actual] ?? 0) + 1
      if (actual !== expected) throw Error(`Expected ${expected} selector`)
      if (body.method === "query" && p.account_id !== id)
        throw Error("Wrong account")
      let result
      if (type === "block") result = block
      if (type === "gas_price") result = { gas_price: amount }
      if (type === "view_account") result = account
      if (type === "view_code") result = code
      if (type === "view_access_key_list") result = keys
      if (type === "view_state") {
        if (p.prefix_base64 !== "" || p.limit !== 100 || p.include_proof)
          throw Error("Wrong state paging arguments")
        const cursor = p.after_key_base64 ?? "initial"
        const index =
          cursor === "initial"
            ? 0
            : pages.findIndex((page) => page.last_key === cursor) + 1
        if (
          index < 0 ||
          index >= pages.length ||
          (index === 0 && cursor !== "initial")
        )
          throw Error("Wrong cursor")
        count.cursors[cursor] = (count.cursors[cursor] ?? 0) + 1
        result = pages[index]
      }
      if (path.endsWith("/http503"))
        return response
          .writeHead(503, { "content-type": "application/json" })
          .end('{"unavailable":true}')
      if (path.endsWith("/cancel")) {
        response.writeHead(200, { "content-type": "application/json" })
        response.flushHeaders()
        response.write('{"jsonrpc":"2.0",')
        return
      }
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }))
    } catch (error) {
      violations.push({ path, message: error.message })
      response.writeHead(400).end("Fixture validation failed")
    }
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    counts,
    violations,
    close: async () => {
      server.closeAllConnections()
      server.close()
      await once(server, "close")
    },
  }
}
