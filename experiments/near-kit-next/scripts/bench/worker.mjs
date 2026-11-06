import assert from "node:assert/strict"
import { performance } from "node:perf_hooks"
import { pathToFileURL } from "node:url"
import { account, hash } from "./fixture.mjs"

const [mode, modulePath, baseUrl, samplesText = "25", warmupsText = "5"] =
  process.argv.slice(2)
const importStart = performance.now()
const module = await import(pathToFileURL(modulePath))
const importMs = performance.now() - importStart
const print = (value) => process.stdout.write(`${JSON.stringify(value)}\n`)
if (mode === "import") {
  print({
    importMs,
    rssBytes: process.memoryUsage().rss,
    heapUsedBytes: process.memoryUsage().heapUsed,
  })
} else if (mode === "fragment") {
  const chunkSize = Number(baseUrl)
  let pulls = 0
  let payloadBytes = 0
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(init.body)
    const encoded = new TextEncoder().encode(
      JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: account,
        ignoredPadding: "x".repeat(256 * 1024),
      }),
    )
    payloadBytes = encoded.byteLength
    let offset = 0
    return new Response(
      new ReadableStream({
        pull(controller) {
          pulls++
          if (offset === encoded.length) {
            controller.close()
            return
          }
          controller.enqueue(encoded.subarray(offset, offset + chunkSize))
          offset = Math.min(offset + chunkSize, encoded.length)
        },
      }),
    )
  }
  global.gc?.()
  const before = process.memoryUsage()
  const start = performance.now()
  const result = await module
    .make("http://127.0.0.1/fragment-fixture")
    .account("alice.testnet")
  assert.equal(result.amount, BigInt(account.amount))
  const elapsedMs = performance.now() - start
  print({
    importMs,
    chunkSize,
    payloadBytes,
    pulls,
    elapsedMs,
    before,
    after: process.memoryUsage(),
    maxRssKiB: process.resourceUsage().maxRSS,
  })
} else {
  const samples = Number(samplesText),
    warmups = Number(warmupsText)
  const rawFetch = globalThis.fetch
  const observed = {}
  let afterHeaders
  globalThis.fetch = async (url, init) => {
    if (new URL(url).hostname !== "127.0.0.1")
      throw new Error("External request forbidden in benchmark")
    observed[url] = (observed[url] ?? 0) + 1
    const response = await rawFetch(url, init)
    if (afterHeaders) queueMicrotask(afterHeaders)
    return response
  }
  const results = {}
  const check = (value, kind) => {
    if (kind === "four") {
      value.forEach((v, i) => {
        check(v, i < 2 ? "account" : "view")
      })
      return
    }
    assert.equal(value.blockHash, hash)
    assert.equal(value.blockHeight, 123)
    if (kind === "account") {
      assert.equal(value.amount, BigInt(account.amount))
      assert.equal(value.locked, 0n)
      assert.equal(value.storageUsage, 410)
    } else if (kind === "bytes")
      assert.equal(new TextDecoder().decode(value.value), '{"count":7}')
    else assert.equal(value.value.count, 7)
  }
  for (const kind of [
    "account",
    "view",
    "bytes",
    "four",
    "missing",
    "http503",
    "retry3",
  ]) {
    const url = `${baseUrl}/${kind}`
    const api = module.make(url)
    const failuresExpected = ["missing", "http503", "retry3"].includes(kind)
    const timings = []
    for (let i = -warmups; i < samples; i++) {
      const start = performance.now()
      if (failuresExpected) {
        for (
          let attempt = 0;
          attempt < (kind === "retry3" ? 3 : 1);
          attempt++
        ) {
          let failed = false
          try {
            await api.account(
              kind === "missing" ? "missing.testnet" : "alice.testnet",
            )
          } catch {
            failed = true
          }
          assert.equal(failed, true)
        }
      } else {
        const value =
          kind === "four"
            ? await api.four(hash)
            : await api[kind](
                kind === "account" ? "alice.testnet" : "contract.testnet",
              )
        check(value, kind)
      }
      if (i >= 0) timings.push(performance.now() - start)
    }
    const expected =
      (samples + warmups) * (kind === "four" ? 4 : kind === "retry3" ? 3 : 1)
    assert.equal(
      observed[url],
      expected,
      `${kind}: unexpected built-in request attempts`,
    )
    results[kind] = {
      timingsMs: timings,
      requests: observed[url],
      warmups,
      samples,
    }
  }
  if (module.supportsCancellation) {
    const url = `${baseUrl}/cancel`
    const timings = []
    for (let i = 0; i < 5; i++) {
      const controller = new AbortController()
      let abortedAt
      // Keep one Fetch function identity: Effect's default Fetch reference can
      // cache it. Change the hook, not globalThis.fetch, between operations.
      afterHeaders = () => {
        abortedAt = performance.now()
        controller.abort()
      }
      await assert.rejects(
        module.make(url).account("alice.testnet", "final", controller.signal),
      )
      afterHeaders = undefined
      assert.equal(typeof abortedAt, "number")
      timings.push(performance.now() - abortedAt)
    }
    results.cancel = {
      timingsMs: timings,
      requests: observed[url],
      phase: "after headers, unfinished body",
    }
  } else
    results.cancel = {
      supported: false,
      reason:
        "Selected public read API accepts no AbortSignal; no fake cancellation shim added",
    }
  print({
    importMs,
    results,
    observed,
    memory: process.memoryUsage(),
    cpu: process.cpuUsage(),
    maxRssKiB: process.resourceUsage().maxRSS,
  })
}
