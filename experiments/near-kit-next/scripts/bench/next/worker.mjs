import assert from "node:assert/strict"
import { readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { performance } from "node:perf_hooks"
import { pathToFileURL } from "node:url"
import { amount, hash, id, pages, previousHash } from "./fixture.mjs"

const [mode, modulePath, url = "", samplesText = "25", warmupsText = "5"] =
  process.argv.slice(2)
const start = performance.now(),
  module = await import(pathToFileURL(modulePath)),
  importMs = performance.now() - start
const print = (data) => process.stdout.write(`${JSON.stringify(data)}\n`)
if (mode === "import") {
  print({
    importMs,
    memory: process.memoryUsage(),
    maxRssKiB: process.resourceUsage().maxRSS,
  })
  process.exit(0)
}
const rawFetch = globalThis.fetch
let requests = 0,
  afterHeaders
// Install before the first operation; Effect's Fetch reference can cache identity.
globalThis.fetch = async (input, init) => {
  if (new URL(input).hostname !== "127.0.0.1")
    throw Error("External request forbidden")
  requests++
  const response = await rawFetch(input, init)
  if (afterHeaders) queueMicrotask(afterHeaders)
  return response
}
function checkAccount(value) {
  assert.equal(value.amount, BigInt(amount))
  assert.equal(value.locked, 0n)
  assert.equal(value.storageUsage, 410n)
  assert.equal(value.blockHeight, 123n)
  assert.equal(value.blockHash, hash)
  assert.equal(value.codeHash, previousHash)
}
function checkSnapshot(value) {
  const records = value
    .trim()
    .split("\n")
    .map((row) => JSON.parse(row))
  assert.deepEqual(
    records.map((row) => row.type),
    ["begin", "header", "state-page", "state-page", "state-page", "end"],
  )
  const header = records[1],
    end = records.at(-1)
  assert.equal(header.block.blockHash, hash)
  assert.equal(header.block.blockHeight, "123")
  assert.equal(header.block.timestampNanoseconds, "18446744073709551615")
  assert.equal(header.account.amount, amount)
  assert.equal(header.account.storageUsage, "410")
  assert.equal(header.account.blockHash, hash)
  assert.equal(header.keys.blockHash, hash)
  assert.equal(header.keys.keys[0].accessKey.nonce, "42")
  assert.equal(header.keys.keys[0].accessKey.permission.allowance, amount)
  assert.equal(header.accountCode.status, "available")
  assert.equal(header.accountCode.code.bytes.data, "AGFzbQEAAAA=")
  assert.equal(header.accountCode.code.blockHash, hash)
  assert.equal(header.gasPrice, amount)
  for (let i = 0; i < 3; i++) {
    const page = records[i + 2].page
    assert.equal(page.blockHash, hash)
    assert.equal(page.blockHeight, "123")
    assert.deepEqual(
      page.entries,
      pages[i].values.map((row) => ({
        key: { encoding: "base64", data: row.key },
        value: { encoding: "base64", data: row.value },
      })),
    )
    assert.equal(page.nextCursor?.data, pages[i].last_key)
  }
  assert.deepEqual(end, {
    type: "end",
    blockHash: hash,
    pages: "3",
    entries: "237",
  })
  return Buffer.byteLength(value)
}
const samples = Number(samplesText),
  warmups = Number(warmupsText),
  timingsMs = []
let operation,
  bytes = 0
if (
  mode === "account" ||
  mode === "snapshot" ||
  mode === "http503" ||
  mode === "cancel"
)
  operation = module.make(url)
if (mode === "wallet-query") {
  // A public-selector-shaped local fixture. This is not a real wallet runtime.
  operation = async () => {
    const listeners = new Map()
    let subscriptions = 0
    const state = {
      selectedWalletId: "fixture-wallet",
      accounts: [{ accountId: id, active: true }],
    }
    const selector = {
      options: { network: { networkId: "testnet" } },
      on: (event, cb) => {
        listeners.set(event, cb)
        return { remove: () => listeners.delete(event) }
      },
      store: {
        getState: () => state,
        observable: {
          subscribe: (observer) => {
            subscriptions++
            observer.next(state)
            return { unsubscribe: () => subscriptions-- }
          },
        },
      },
    }
    const source = {
      client: module.make({ url }),
      sourceKey: "benchmark-public-fixture",
      networkId: "testnet",
      revision: 0,
    }
    const observer = module.observeWalletSelector({
      selector,
      source,
      onChange: () => {},
    })
    try {
      const options = module.walletAccountQueryOptions(observer.getSnapshot())
      assert.equal(options.enabled, true)
      assert.equal(options.retry, false)
      const result = await options.queryFn({
        signal: new AbortController().signal,
      })
      assert.equal(result.status, "ready")
      checkAccount(result.account)
      listeners.get("networkChanged")({
        walletId: "fixture-wallet",
        networkId: "mainnet",
      })
      assert.equal(
        module.walletAccountQueryOptions(observer.getSnapshot()).enabled,
        false,
      )
      return result
    } finally {
      observer.dispose()
      assert.equal(subscriptions, 0)
      assert.equal(listeners.size, 0)
    }
  }
}
if (mode === "file-export") {
  const client = module.make({ url })
  operation = async (sample) => {
    const outputPath = join(
      process.cwd(),
      "files",
      `${process.pid}-${sample}.ndjson`,
    )
    const summary = await module.Effect.runPromise(
      module
        .exportSnapshot(client, id, outputPath)
        .pipe(module.Effect.provide(module.fetchLayer)),
    )
    assert.equal(summary.pages, 3n)
    assert.equal(summary.entries, 237n)
    const text = await readFile(outputPath, "utf8")
    await assert.rejects(readFile(`${outputPath}.partial`), { code: "ENOENT" })
    await rm(outputPath)
    return text
  }
}
if (mode === "cancel") {
  if (!module.supportsCancellation) {
    print({
      supported: false,
      reason:
        "Selected public API has no caller AbortSignal; no abandonment wrapper",
    })
    process.exit(0)
  }
  for (let i = 0; i < 5; i++) {
    const controller = new AbortController()
    let abortedAt
    afterHeaders = () => {
      abortedAt = performance.now()
      controller.abort()
    }
    await assert.rejects(operation(id, "final", controller.signal))
    afterHeaders = undefined
    assert.equal(typeof abortedAt, "number")
    timingsMs.push(performance.now() - abortedAt)
  }
  assert.equal(requests, 5)
} else {
  for (let i = -warmups; i < samples; i++) {
    const before = performance.now()
    if (mode === "http503") await assert.rejects(operation(id))
    else {
      const result = await operation(mode === "file-export" ? i : id)
      if (mode === "account") checkAccount(result)
      if (mode === "snapshot" || mode === "file-export")
        bytes = checkSnapshot(result)
    }
    if (i >= 0) timingsMs.push(performance.now() - before)
  }
  assert.equal(
    requests,
    (samples + warmups) * (["snapshot", "file-export"].includes(mode) ? 8 : 1),
    "Unexpected implicit requests",
  )
}
print({
  importMs,
  timingsMs,
  samples,
  warmups,
  requests,
  serializedBytes: bytes,
  memory: process.memoryUsage(),
  cpu: process.cpuUsage(),
  maxRssKiB: process.resourceUsage().maxRSS,
})
