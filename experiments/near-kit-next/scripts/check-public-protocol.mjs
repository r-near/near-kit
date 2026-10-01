// Opt-in public reads, separate from the offline test suite. No setup writes.
// Run after `npm run build`: node scripts/check-public-protocol.mjs --live
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { gzipSync } from "node:zlib"
import * as Near from "@near-kit/next"
import * as Operator from "@near-kit/next/operator"
import { base58 } from "@scure/base"
import * as Effect from "effect/Effect"
import * as FetchHttpClient from "effect/http/FetchHttpClient"

if (process.argv.length !== 3 || process.argv[2] !== "--live") {
  throw new Error(
    "Explicit public reads require --live; ordinary tests are offline",
  )
}
const manifest = JSON.parse(
  await readFile("test/fixtures/protocol/manifest.json", "utf8"),
)
const root = `artifacts/public-protocol-live/${Date.now()}`
await mkdir(root, { recursive: true })
const evidence = []
const capture = async (input, init) => {
  const name = String(evidence.length + 1).padStart(2, "0")
  await writeFile(`${root}/${name}-request.json`, init.body)
  const response = await fetch(input, init)
  const bytes = new Uint8Array(await response.arrayBuffer())
  await writeFile(`${root}/${name}-response.json.gz`, gzipSync(bytes))
  evidence.push({
    name,
    endpoint: String(input),
    recordedAt: new Date().toISOString(),
    status: response.status,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  })
  return new Response(bytes, {
    status: response.status,
    headers: response.headers,
  })
}
const run = (program) =>
  Effect.runPromise(
    program.pipe(
      Effect.timeout("30 seconds"),
      Effect.provide(Near.fetchLayer),
      Effect.provideService(FetchHttpClient.Fetch, capture),
    ),
  )
// Official archival endpoints keep fixed historical selectors reproducible.
// Source: https://docs.near.org/api/rpc/providers
const clients = {
  mainnet: Near.make({ url: "https://archival-rpc.mainnet.near.org" }),
  "archive-testnet": Near.make({
    url: "https://archival-rpc.testnet.near.org",
  }),
}
const results = []
try {
  for (const [network, client] of Object.entries(clients)) {
    results.push({ network, status: await run(Near.status(client)) })
  }
  for (const item of manifest.captures) {
    const client = clients[item.network]
    const at = { hash: item.expected.blockHash }
    if (item.operation === "globalCode") {
      const code = await run(Near.globalCode(client, item.reference, { at }))
      assert.equal(code.blockHeight, BigInt(item.expected.blockHeight))
      assert.equal(code.bytes.length, item.expected.bytes)
      assert.equal(code.codeHash, item.expected.codeHash)
      assert.equal(
        base58.encode(createHash("sha256").update(code.bytes).digest()),
        code.codeHash,
      )
      results.push({
        name: item.name,
        blockHash: code.blockHash,
        codeHash: code.codeHash,
        bytes: code.bytes.length,
      })
    } else {
      const effects = await run(Operator.blockEffects(client, at))
      const pairs = (changes) =>
        changes.map((c) => `${c.kind}:${c.accountId}`).sort()
      assert.deepEqual(pairs(effects.changes), pairs(item.expected.changes))
      results.push({
        name: item.name,
        blockHash: effects.blockHash,
        changes: effects.changes.length,
      })
    }
  }
  console.log(
    JSON.stringify(
      { root, results },
      (_key, value) => (typeof value === "bigint" ? value.toString() : value),
      2,
    ),
  )
} finally {
  await writeFile(
    `${root}/evidence.json`,
    JSON.stringify(
      { evidence, results },
      (_key, value) => (typeof value === "bigint" ? value.toString() : value),
      2,
    ),
  )
}
