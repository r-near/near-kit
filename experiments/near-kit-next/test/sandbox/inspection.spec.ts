import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import * as Near from "@near-kit/next"
import * as Data from "@near-kit/next/data"
import * as Operator from "@near-kit/next/operator"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import { expect, it } from "vitest"
import { exportSnapshot } from "../../examples/snapshot-export.js"

const url = process.env.NEAR_SANDBOX_URL
if (!url) throw new Error("NEAR_SANDBOX_URL is required")
const client = Near.make({ url })
const run = <A, E>(
  program: Effect.Effect<A, E, import("effect/http/HttpClient").HttpClient>,
) =>
  Effect.runPromise(
    program.pipe(Effect.timeout("15 seconds"), Effect.provide(Near.fetchLayer)),
  )
const fixture = JSON.parse(
  readFileSync("artifacts/sandbox/fixture.json", "utf8"),
) as {
  codeHash: string
  fixtureAmount: string
  wasmSha256: string
  data: Array<{ key: string; value: string }>
  keys: Array<{ publicKey: string; nonce: string }>
  nonces: string[]
  genesis: {
    chainId: string
    protocolVersion: number
    genesisHeight: string
    epochLength: string
    totalSupply: string
  }
}
const endpoint = url
const firstKey = fixture.keys[0]
const gasKey = fixture.keys[3]
if (!firstKey || !gasKey) throw new Error("Incomplete public-key fixture")
const encoded = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64")
const selector = async () => ({
  hash: (await run(Near.block(client))).blockHash,
})

it("inspects all public permission variants and exact u64 nonces on a pinned node", async () => {
  const at = await selector()
  const account = await run(Near.account(client, "fixture.sandbox", { at }))
  expect(account.amount).toBe(BigInt(fixture.fixtureAmount))
  const keys = await run(Near.accessKeys(client, "fixture.sandbox", { at }))
  expect(keys.keys).toHaveLength(fixture.keys.length)
  expect(keys.blockHash).toBe(at.hash)
  expect(
    new Set(keys.keys.map((key) => key.accessKey.permission.kind)),
  ).toEqual(
    new Set([
      "FullAccess",
      "FunctionCall",
      "GasKeyFullAccess",
      "GasKeyFunctionCall",
    ]),
  )
  for (const expected of fixture.keys) {
    const found = keys.keys.find(
      (item) => Data.formatPublicKey(item.publicKey) === expected.publicKey,
    )
    expect(found?.accessKey.nonce).toBe(BigInt(expected.nonce))
    if (!expected.publicKey.startsWith("ml-dsa-65-hash:"))
      expect(
        (
          await run(
            Near.accessKey(client, "fixture.sandbox", expected.publicKey, {
              at,
            }),
          )
        ).nonce,
      ).toBe(BigInt(expected.nonce))
  }
  const lanes = await run(
    Near.gasKeyNonces(client, "fixture.sandbox", gasKey.publicKey, {
      at,
    }),
  )
  expect(lanes.nonces).toEqual(fixture.nonces.map(BigInt))
  expect(
    await run(
      Near.gasKeyNonces(client, "fixture.sandbox", firstKey.publicKey, {
        at,
      }).pipe(Effect.flip),
    ),
  ).toMatchObject({ _tag: "RpcError", kind: "GasKeyUnavailable" })
  expect(
    await run(
      Near.accessKey(client, "empty.sandbox", firstKey.publicKey, {
        at,
      }).pipe(Effect.flip),
    ),
  ).toMatchObject({ _tag: "AccessKeyNotFound" })
  expect(
    (await run(Near.accessKeys(client, "empty.sandbox", { at }))).keys,
  ).toEqual([])
  expect(
    (await run(Near.accessKeys(client, "missing.sandbox", { at }))).keys,
  ).toEqual([])
  // Preserve a separate raw response oracle. No rounded JS fixture generated it.
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "exact-lanes",
      method: "query",
      params: {
        request_type: "view_gas_key_nonces",
        account_id: "fixture.sandbox",
        public_key: gasKey.publicKey,
        block_id: at.hash,
      },
    }),
    signal: AbortSignal.timeout(3000),
  })
  const text = await response.text()
  expect(response.ok).toBe(true)
  expect(text).toContain("9007199254740993")
  expect(text).toContain("18446744073709551615")
  writeFileSync("artifacts/sandbox/exact-nonces-response.json", text)
})
it("downloads known local code and distinguishes code absence from dangling global references", async () => {
  const at = await selector()
  const result = await run(Near.code(client, "fixture.sandbox", { at }))
  expect(result.bytes).toEqual(
    new Uint8Array(readFileSync("artifacts/sandbox/views.wasm")),
  )
  expect(createHash("sha256").update(result.bytes).digest("hex")).toBe(
    fixture.wasmSha256,
  )
  expect(result.codeHash).toBe(fixture.codeHash)
  expect(
    await run(Near.code(client, "empty.sandbox", { at }).pipe(Effect.flip)),
  ).toMatchObject({ _tag: "RpcError", kind: "CodeUnavailable" })
  expect(
    (await run(Near.account(client, "global-hash.sandbox", { at })))
      .globalContractHash,
  ).toBe(fixture.codeHash)
  expect(
    (await run(Near.account(client, "global-publisher.sandbox", { at })))
      .globalContractAccountId,
  ).toBe("publisher.sandbox")
  for (const reference of [
    { hash: fixture.codeHash },
    { publisher: "publisher.sandbox" },
  ])
    expect(
      await run(Near.globalCode(client, reference, { at }).pipe(Effect.flip)),
    ).toMatchObject({ _tag: "RpcError", kind: "GlobalCodeUnavailable" })
})
it("traverses binary state at one block, including an empty nonterminal cursor", async () => {
  const at = await selector()
  const first = await run(
    Near.statePage(client, "fixture.sandbox", { at, pageSize: 1 }),
  )
  expect(first.nextCursor).toEqual(new Uint8Array())
  const second = await run(
    Near.statePage(client, "fixture.sandbox", {
      at,
      pageSize: 1,
      after: first.nextCursor ?? new Uint8Array(),
    }),
  )
  expect(second.entries[0]?.key).toEqual(new Uint8Array([0]))
  const pages = await run(
    Near.statePages(client, "fixture.sandbox", { at, pageSize: 2 }).pipe(
      Stream.runCollect,
    ),
  )
  expect(
    pages.every(
      (page) =>
        page.blockHash === at.hash && page.blockHeight === first.blockHeight,
    ),
  ).toBe(true)
  expect(
    pages.flatMap((page) =>
      page.entries.map((row) => ({
        key: encoded(row.key),
        value: encoded(row.value),
      })),
    ),
  ).toEqual(fixture.data)
  expect(pages.at(-1)?.nextCursor).toBeUndefined()
  const prefixed = await run(
    Near.statePages(client, "fixture.sandbox", {
      at,
      prefix: new Uint8Array([0]),
      pageSize: 1,
    }).pipe(Stream.runCollect),
  )
  expect(
    prefixed.flatMap((page) => page.entries.map((row) => Array.from(row.key))),
  ).toEqual([[0], [0, 0], [0, 255]])
  const proof = await run(
    Near.statePage(client, "fixture.sandbox", { at, proof: true }),
  )
  expect(proof.entries).toHaveLength(fixture.data.length)
  expect(proof.proof?.length).toBeGreaterThan(0)
  expect(
    (await run(Near.statePage(client, "empty.sandbox", { at }))).entries,
  ).toEqual([])
  expect(
    await run(
      Near.statePage(client, "missing.sandbox", { at }).pipe(Effect.flip),
    ),
  ).toMatchObject({ _tag: "AccountNotFound" })
})
it("honors the server byte cap without treating a short page as exhaustion", async () => {
  const page = await run(
    Near.statePage(client, "large.sandbox", { pageSize: 100 }),
  )
  expect(page.entries.length).toBeLessThan(100)
  expect(page.nextCursor).toBeDefined()
  const pages = await run(
    Near.statePages(client, "large.sandbox", { pageSize: 100 }).pipe(
      Stream.runCollect,
    ),
  )
  expect(pages.flatMap((page) => page.entries)).toHaveLength(4)
  expect(
    await run(
      Near.statePage(client, "large.sandbox", { proof: true }).pipe(
        Effect.flip,
      ),
    ),
  ).toMatchObject({ _tag: "RpcError", kind: "StateTooLarge" })
})
it("reads exact gas/genesis and named operator shapes without inventing provenance", async () => {
  const at = await selector()
  expect(await run(Near.gasPrice(client, at))).toBeGreaterThan(0n)
  const genesis = await run(Operator.genesisSummary(client))
  expect(genesis).toMatchObject({
    ...fixture.genesis,
    genesisHeight: BigInt(fixture.genesis.genesisHeight),
    epochLength: BigInt(fixture.genesis.epochLength),
    totalSupply: BigInt(fixture.genesis.totalSupply),
  })
  const effects = await run(Operator.blockEffects(client, at))
  expect(effects.blockHash).toBe(at.hash)
  expect(
    effects.changes.every((change) => change.kind === "account_touched"),
  ).toBe(true)
  expect(await run(Operator.maintenanceWindows(client, "sandbox"))).toEqual([])
  const windows = await run(
    Operator.maintenanceWindows(client, "fixture.sandbox"),
  )
  expect(windows.every((window) => window.start <= window.end)).toBe(true)
  writeFileSync(
    "artifacts/sandbox/operator-evidence.json",
    JSON.stringify(
      { genesis, effects, windows },
      (_key, value) => (typeof value === "bigint" ? value.toString() : value),
      2,
    ),
  )
})

it("exports a naturally complete exact snapshot from the real node, including a no-code account", async () => {
  for (const id of ["fixture.sandbox", "empty.sandbox"]) {
    const path = `artifacts/sandbox/${id}-snapshot.ndjson`
    const summary = await run(exportSnapshot(client, id, path))
    const rows = readFileSync(path, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
    expect(rows[0].type).toBe("begin")
    expect(rows.at(-1)).toMatchObject({
      type: "end",
      blockHash: summary.blockHash,
    })
    const header = rows.find((row) => row.type === "header")
    expect(header.account.amount).toBe(fixture.fixtureAmount)
    expect(header.block.blockHash).toBe(summary.blockHash)
    expect(header.account.blockHash).toBe(summary.blockHash)
    expect(header.keys.blockHash).toBe(summary.blockHash)
    const pages = rows.filter((row) => row.type === "state-page")
    expect(pages.every((row) => row.page.blockHash === summary.blockHash)).toBe(
      true,
    )
    expect(summary.entries).toBe(
      id === "fixture.sandbox" ? BigInt(fixture.data.length) : 0n,
    )
    expect(header.accountCode.status).toBe(
      id === "fixture.sandbox" ? "available" : "unavailable",
    )
    if (id === "fixture.sandbox") {
      expect(
        pages
          .flatMap((row) => row.page.entries)
          .map((row) => ({ key: row.key.data, value: row.value.data })),
      ).toEqual(fixture.data)
      expect(
        header.keys.keys.some(
          (key: { accessKey: { nonce: string } }) =>
            key.accessKey.nonce === "18446744073709551615",
        ),
      ).toBe(true)
    }
  }
})

it("runs the explicit full-wire inspection CLI for block, chunk and protocol config", async () => {
  const at = await selector()
  const raw = (...args: string[]) =>
    execFileSync("sh", ["examples/raw-inspection.sh", endpoint, ...args], {
      encoding: "utf8",
      timeout: 20000,
      maxBuffer: 4 * 1024 * 1024,
    })
  const blockText = raw("block", at.hash)
  const block = JSON.parse(blockText)
  expect(block.result.header.hash).toBe(at.hash)
  const chunkHash = block.result.chunks[0]?.chunk_hash
  expect(typeof chunkHash).toBe("string")
  const chunk = JSON.parse(raw("chunk", chunkHash))
  expect(chunk.result.header.chunk_hash).toBe(chunkHash)
  expect(chunk.result.transactions).toEqual([])
  const config = JSON.parse(raw("config"))
  expect(config.result.runtime_config).toBeDefined()
  const genesis = JSON.parse(raw("genesis"))
  expect(genesis.result.chain_id).toBe(fixture.genesis.chainId)
  writeFileSync("artifacts/sandbox/raw-block-response.json", blockText)
})
