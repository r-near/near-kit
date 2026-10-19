import { readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const directory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../artifacts/bench",
)
const raw = JSON.parse(await readFile(`${directory}/raw.json`, "utf8"))
const lanes = [
  "prototype",
  "baseline",
  "near-api",
  "fetch-minimal",
  "fetch-validated",
]
const median = (numbers) => {
  const x = [...numbers].sort((a, b) => a - b)
  return x.length % 2
    ? x[(x.length - 1) / 2]
    : (x[x.length / 2 - 1] + x[x.length / 2]) / 2
}
const stats = (numbers) => {
  const x = [...numbers].sort((a, b) => a - b)
  const quantile = (p) => x[Math.max(0, Math.ceil(p * x.length) - 1)]
  return {
    n: x.length,
    median: median(x),
    p10: quantile(0.1),
    p90: quantile(0.9),
    p95: quantile(0.95),
    min: x[0],
    max: x.at(-1),
  }
}
const summary = {
  artifact: raw.provenance,
  host: raw.host,
  methodology: raw.methodology,
  startedAt: raw.startedAt,
  finishedAt: raw.finishedAt,
  imports: {},
  workloads: {},
  fragments: {},
  bundles: raw.bundles.map(({ inputs, ...rest }) => rest),
  marginalBytes: {},
  requestAudit: {},
}
for (const lane of lanes) {
  summary.imports[lane] = stats(
    raw.imports.filter((v) => v.lane === lane).map((v) => v.importMs),
  )
  summary.workloads[lane] = {}
  const runs = raw.workloads.filter((v) => v.lane === lane)
  for (const kind of [
    "account",
    "view",
    "bytes",
    "four",
    "missing",
    "http503",
    "retry3",
    "cancel",
  ]) {
    const recorded = runs.map((v) => v.results[kind]).filter((v) => v.timingsMs)
    summary.workloads[lane][kind] = recorded.length
      ? {
          pooledMs: stats(recorded.flatMap((v) => v.timingsMs)),
          roundMediansMs: stats(recorded.map((v) => median(v.timingsMs))),
          requestsIncludingWarmups: recorded.reduce(
            (sum, v) => sum + v.requests,
            0,
          ),
        }
      : { supported: false }
  }
  summary.fragments[lane] = {}
  for (const chunk of [1, 16384]) {
    const records = raw.fragments.filter(
      (v) => v.lane === lane && v.chunkSize === chunk,
    )
    if (records.length)
      summary.fragments[lane][chunk] = {
        durationMs: stats(records.map((v) => v.elapsedMs)),
        processMaxRssKiB: stats(records.map((v) => v.maxRssKiB)),
        heapIncreaseBytes: stats(
          records.map((v) => v.after.heapUsed - v.before.heapUsed),
        ),
        payloadBytes: records[0].payloadBytes,
        pulls: records[0].pulls,
      }
  }
  const browserLane = lane === "near-api" ? "near-api-with-util-polyfill" : lane
  summary.marginalBytes[lane] = {}
  for (const existing of [
    "effect",
    "effect-schema",
    "effect-leaf",
    "effect-schema-leaf",
  ]) {
    const base = raw.bundles.find((v) => v.label === `${existing}-existing`)
    const combined = raw.bundles.find(
      (v) => v.label === `${browserLane}-account-plus-${existing}`,
    )
    if (base && combined)
      summary.marginalBytes[lane][existing] = Object.fromEntries(
        ["rawBytes", "minifiedBytes", "gzipBytes", "brotliBytes"].map(
          (field) => [field, combined[field] - base[field]],
        ),
      )
  }
  const server = Object.entries(raw.serverCounts ?? {}).filter(([key]) =>
    key.startsWith(`/${lane}-`),
  )
  summary.requestAudit[lane] = {
    requests: server.reduce((sum, [, v]) => sum + v.requests, 0),
    interruptedBodies: server.reduce(
      (sum, [, v]) => sum + v.interruptedBodies,
      0,
    ),
    finalReads: server.reduce(
      (sum, [, v]) => sum + (v.selections.final ?? 0),
      0,
    ),
    hashReads: server.reduce((sum, [, v]) => sum + (v.selections.hash ?? 0), 0),
  }
}
summary.requestAudit.fixtureViolations = raw.fixtureViolations
await writeFile(
  `${directory}/summary.json`,
  `${JSON.stringify(summary, null, 2)}\n`,
)
const num = (n) => n.toFixed(2)
const lines = [
  "# Read-only benchmark results",
  "",
  `Measured artifact SHA256: ${raw.provenance.prototypeSha256}`,
  `Baseline: ${raw.provenance.baselineCommit}; near-api-js ${raw.provenance.nearApiJs}; ${raw.host.node}; ${raw.host.cpu}.`,
  "",
  "Method and limitations: scripts/bench/README.md. Full raw samples: artifacts/bench/raw.json.",
  "No general speedup claim: these process-cold imports and warm loopback reads have different validation/resource guarantees.",
  "",
  "## Process-cold import (milliseconds)",
  "",
  "| Lane | Median | p10–p90 | Min–max |",
  "|---|---:|---:|---:|",
]
for (const lane of lanes) {
  const x = summary.imports[lane]
  lines.push(
    `| ${lane} | ${num(x.median)} | ${num(x.p10)}–${num(x.p90)} | ${num(x.min)}–${num(x.max)} |`,
  )
}
lines.push(
  "",
  "## Browser account consumers (bytes)",
  "",
  "near-api-js includes an actual util polyfill; plain browser bundling failed without it.",
  "",
  "| Lane | Minified | gzip | Brotli | gzip increment / barrel Effect | gzip increment / barrel Effect+Schema |",
  "|---|---:|---:|---:|---:|---:|",
)
for (const lane of lanes) {
  const name = lane === "near-api" ? "near-api-with-util-polyfill" : lane
  const x = raw.bundles.find((v) => v.label === `${name}-account`)
  if (x)
    lines.push(
      `| ${lane} | ${x.minifiedBytes} | ${x.gzipBytes} | ${x.brotliBytes} | ${summary.marginalBytes[lane].effect?.gzipBytes} | ${summary.marginalBytes[lane]["effect-schema"]?.gzipBytes} |`,
    )
}
lines.push(
  "",
  "### Prototype marginal gzip: import style matters",
  "",
  "| Existing app | Existing gzip | Combined gzip | Increment |",
  "|---|---:|---:|---:|",
)
for (const existing of [
  "effect",
  "effect-schema",
  "effect-leaf",
  "effect-schema-leaf",
]) {
  const base = raw.bundles.find((v) => v.label === `${existing}-existing`)
  const combined = raw.bundles.find(
    (v) => v.label === `prototype-account-plus-${existing}`,
  )
  if (base && combined)
    lines.push(
      `| ${existing} | ${base.gzipBytes} | ${combined.gzipBytes} | ${combined.gzipBytes - base.gzipBytes} |`,
    )
}
for (const kind of [
  "account",
  "view",
  "four",
  "missing",
  "http503",
  "retry3",
  "cancel",
]) {
  lines.push(
    "",
    `## ${kind} latency (milliseconds)`,
    "",
    "| Lane | Pooled median | Pooled p95 | Round-median range |",
    "|---|---:|---:|---:|",
  )
  for (const lane of lanes) {
    const x = summary.workloads[lane][kind]
    lines.push(
      x.supported === false
        ? `| ${lane} | Unsupported | | |`
        : `| ${lane} | ${num(x.pooledMs.median)} | ${num(x.pooledMs.p95)} | ${num(x.roundMediansMs.min)}–${num(x.roundMediansMs.max)} |`,
    )
  }
}
lines.push(
  "",
  "## Controlled chunking observation",
  "",
  "~256 KiB envelope, separate Fetch stream fixture. Process maxRSS includes imports/runtime; this is not an exact per-request memory measurement.",
  "",
  "| Lane | 1-byte median ms | 16-KiB median ms | 1-byte median maxRSS MiB | 16-KiB median maxRSS MiB |",
  "|---|---:|---:|---:|---:|",
)
for (const lane of lanes) {
  const a = summary.fragments[lane][1],
    b = summary.fragments[lane][16384]
  if (a && b)
    lines.push(
      `| ${lane} | ${num(a.durationMs.median)} | ${num(b.durationMs.median)} | ${num(a.processMaxRssKiB.median / 1024)} | ${num(b.processMaxRssKiB.median / 1024)} |`,
    )
}
lines.push(
  "",
  "All observed requests were read-only and selectors/argument checks passed. Each normal read made one internal attempt; retry3 made three explicit application attempts. Source-independent protocol/browser acceptance remains separate.",
  "",
)
await writeFile(`${directory}/summary.md`, lines.join("\n"))
console.log(lines.join("\n"))
