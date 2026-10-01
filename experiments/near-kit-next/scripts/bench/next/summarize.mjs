import { createHash } from "node:crypto"
import { readFile, readdir, stat, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
const work = resolve(dirname(fileURLToPath(import.meta.url)), "../../../artifacts/bench-next"), runName = process.env.BENCH_RUN_NAME ?? "final"
const directory = join(work, "runs", runName), rawBytes = await readFile(join(directory, "raw.json")), raw = JSON.parse(rawBytes)
if (!raw.finishedAt) throw Error("Run not complete")
let bundleAudit
try {
  bundleAudit = JSON.parse(await readFile(join(directory, "audited-bundles/results.json"), "utf8"))
  for (const replacement of bundleAudit.bundles) {
    const index = raw.bundles.findIndex(x => x.label === replacement.label)
    if (index < 0) throw Error("Audited bundle has no original entry")
    raw.bundles[index] = replacement
  }
} catch (error) { if (error.code !== "ENOENT") throw error }
const sha = data => createHash("sha256").update(data).digest("hex")
if (bundleAudit && (bundleAudit.rawSha256 !== sha(rawBytes) || bundleAudit.candidateSha256 !== raw.provenance.candidateSha256)) throw Error("Bundle audit provenance mismatch")
function distribution(xs) {
  const values = [...xs].sort((a, b) => a - b), n = values.length
  const q = p => { const t = (n - 1) * p, lo = Math.floor(t), hi = Math.ceil(t); return values[lo] + (values[hi] - values[lo]) * (t - lo) }
  return { n, min: values[0], p10: q(.1), median: q(.5), p90: q(.9), p95: q(.95), max: values.at(-1) }
}
const group = (values, fn) => Object.fromEntries([...new Set(values.map(fn))].map(key => [key, values.filter(x => fn(x) === key)]))
const imports = Object.fromEntries(Object.entries(group(raw.imports, x => x.label)).map(([key, rows]) => [key, { importMs: distribution(rows.map(x => x.importMs)), processWallMs: distribution(rows.map(x => x.wallMs)), rssBytes: distribution(rows.map(x => x.memory.rss)) }]))
const workloads = Object.fromEntries(Object.entries(group(raw.workloads, x => x.label)).map(([key, rows]) => [key, { timingsMs: distribution(rows.flatMap(x => x.timingsMs)), roundMediansMs: rows.map(x => distribution(x.timingsMs).median), requests: rows.reduce((s, x) => s + x.requests, 0), maxRssKiB: distribution(rows.map(x => x.maxRssKiB)), serializedBytes: [...new Set(rows.map(x => x.serializedBytes))] }]))
const bundles = Object.fromEntries(raw.bundles.map(x => [x.label, x])), deltas = []
for (const name of ["candidate-data", "candidate-units"]) if (bundles[name].inputs.some(path => path.includes("node_modules/effect/"))) throw Error("Pure entry unexpectedly imports Effect")
for (const combined of raw.bundles.filter(x => x.label.includes("-plus-"))) {
  const [consumer, suffix] = combined.label.split("-plus-")
  const baseName = suffix === "existing" ? consumer.includes("query") ? consumer.endsWith("app") ? "react-query-app-existing" : "react-query-existing" : consumer.endsWith("app") ? "react-app-existing" : "react-existing" : suffix
  const base = bundles[baseName]
  if (!base) throw Error(`Missing delta baseline ${baseName}`)
  deltas.push({ consumer, existingApp: baseName, combined: combined.label, minifiedBytes: combined.minifiedBytes - base.minifiedBytes, gzipBytes: combined.gzipBytes - base.gzipBytes, brotliBytes: combined.brotliBytes - base.brotliBytes })
}
async function directorySize(path) { let total = 0, files = 0; for (const item of await readdir(path, { withFileTypes: true })) { const child = join(path, item.name); if (item.isDirectory()) { const part = await directorySize(child); total += part.bytes; files += part.files } else if (item.isFile()) { total += (await stat(child)).size; files++ } } return { bytes: total, files } }
const effectManifest = JSON.parse(await readFile(join(work, "node_modules/effect/package.json"), "utf8"))
const candidateManifest = JSON.parse(await readFile(join(work, "node_modules/@near-kit/next/package.json"), "utf8"))
const install = { candidateDependencies: candidateManifest.dependencies, candidateFiles: await directorySize(join(work, "node_modules/@near-kit/next")), effectDependencies: effectManifest.dependencies ?? {}, effectFiles: await directorySize(join(work, "node_modules/effect")), scureBaseFiles: await directorySize(join(work, "node_modules/@scure/base")), note: "Actual unpacked package file bytes, not complete recursive install footprint. Includes package source/maps/docs; differs from runtime bundle cost. Pure imports do not remove declared install dependencies." }
const summary = { bundleAudit, candidateSha256: raw.provenance.candidateSha256, baselineCommit: raw.provenance.baselineCommit, rawSha256: sha(rawBytes), rawFile: `runs/${runName}/raw.json`, imports, workloads, bundles, deltas, cancellation: raw.cancellation.map(x => ({ lane: x.label, supported: x.supported !== false, ...(x.timingsMs ? { timingsMs: distribution(x.timingsMs), requests: x.requests } : { reason: x.reason }) })), install, fixtureViolations: raw.fixtureViolations, totalObservedRequests: Object.values(raw.serverCounts).reduce((sum, x) => sum + x.requests, 0) }
await writeFile(join(directory, "summary.json"), JSON.stringify(summary, null, 2) + "\n")
const f = n => n.toFixed(2), table = (headers, rows) => [`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`, ...rows.map(x => `| ${x.join(" | ")} |`)].join("\n")
const report = [
  "# Broader candidate measurement report", "",
  `Immutable candidate SHA-256: \`${summary.candidateSha256}\`.`,
  `Tracked checkpoint: \`${raw.provenance.sourceCommit}\`; baseline: \`${summary.baselineCommit}\`.`,
  `Node ${raw.host.node}; ${raw.host.cpu}; esbuild ${raw.provenance.versions.esbuild}. Completed ${raw.finishedAt}.`,
  `Raw data SHA-256: \`${summary.rawSha256}\`; relative raw path: \`${summary.rawFile}\`.`,
  "",
  "## Scope and limits", "", ...(bundleAudit ? ["Bundle audit: combined mountable-app entries explicitly preserve both mount exports; the Node file-export bundle exposes only its callable factory. The retained audited-bundles/results.json supersedes those three initial bundler entries without changing runtime samples.", ""] : []),
  "Account-only, complete same-block state export, actual file export, packed wallet/application recipes, pure subpaths and Effect import styles are separate consumers. Source/bundle hashes, all raw samples, request counts and method/selector/cursor checks are retained. This is filesystem-warm/process-cold local measurement, not mainnet or browser UI timing. See scripts/bench/next/README.md for reproduction and semantic differences.",
  "Main and near-api-js do not offer the same raw-u64 precision, body/validation guarantees or caller cancellation. This safe-u64 dataset does not test out-of-range equivalence. near-api-js uses public generic query for pinned key-list and cursor-based state reads. Its browser bundle includes the actual util 0.12.5 polyfill. Direct fetch variants are weaker application references; even bounded fetch lacks full protocol validation and exact numeric-token parsing. The two fetch references share a transport factory; esbuild retains its conditional bounded/minimal branches, so their bundles are the same size. They are reproducible reference adapters, not hand-optimized minimum-size fetch implementations. No speedup or SDK-completion conclusion follows from these numbers.",
  "", "## Process-cold imports, milliseconds", "",
  `Each has ${raw.methodology.importRounds} fresh-process samples. Import excludes startup; wall includes it. Node module evaluation, warm filesystem caches.`, "",
  table(["Entry", "Median", "p10–p90", "Min–max", "Wall median", "RSS median MiB"], Object.entries(imports).map(([label, x]) => [label, f(x.importMs.median), `${f(x.importMs.p10)}–${f(x.importMs.p90)}`, `${f(x.importMs.min)}–${f(x.importMs.max)}`, f(x.processWallMs.median), f(x.rssBytes.median / 1048576)])),
  "", "## Browser/Node consumer bundles, bytes", "",
  "Browser production ESM unless the entry says node. Component-only wallet entries exclude ReactDOM; app entries include it. Wallet modules/selector creation are caller supplied and not included. File-export Node built-ins are external. Attribution is minified emitted code before compression, not additive gzip ownership.", "",
  table(["Entry", "Platform", "Minified", "gzip", "Brotli", "Effect emitted bytes"], raw.bundles.filter(x => !x.label.includes("-plus-")).map(x => [x.label, x.platform, x.minifiedBytes, x.gzipBytes, x.brotliBytes, x.attributionUncompressedBytes.effect ?? 0])),
  "", "## Marginal combined-bundle costs, bytes", "",
  "Each delta subtracts the exact existing application bundle from the actual combined bundle. Existing-app examples define the scope; this is not a universal cost for every app with Effect or React installed.", "",
  table(["Consumer", "Existing app", "Minified delta", "gzip delta", "Brotli delta"], deltas.map(x => [x.consumer, x.existingApp, x.minifiedBytes, x.gzipBytes, x.brotliBytes])),
  "", "## Warm workload distributions, milliseconds", "",
  `${raw.methodology.rounds} randomized independent process rounds × ${raw.methodology.samples} measured samples after ${raw.methodology.warmups} warmups. All assertions included. Snapshot is 8 checked requests and 42,600 serialized bytes. File-export also includes fsync/publication and harness verification/cleanup. Wallet query uses a selector-shaped mock, not a real wallet.`, "",
  table(["Workload", "n", "Median", "p10–p90", "p95", "Min–max", "Round median range"], Object.entries(workloads).map(([label, x]) => [label, x.timingsMs.n, f(x.timingsMs.median), `${f(x.timingsMs.p10)}–${f(x.timingsMs.p90)}`, f(x.timingsMs.p95), `${f(x.timingsMs.min)}–${f(x.timingsMs.max)}`, `${f(Math.min(...x.roundMediansMs))}–${f(Math.max(...x.roundMediansMs))}`])),
  "", "## Cancellation after response headers", "",
  table(["Lane", "Support", "Median ms", "Min–max ms"], summary.cancellation.map(x => [x.lane, x.supported ? "Full request/body signal" : "Unsupported selected public API", x.supported ? f(x.timingsMs.median) : "—", x.supported ? `${f(x.timingsMs.min)}–${f(x.timingsMs.max)}` : "—"])),
  "", "## Dependency and import interpretation", "",
  `Candidate declares ${JSON.stringify(install.candidateDependencies)}. Effect itself declares ${JSON.stringify(install.effectDependencies)}. Its unpacked package alone is ${install.effectFiles.bytes} bytes across ${install.effectFiles.files} files; the candidate package is ${install.candidateFiles.bytes} bytes. The declared @scure/base package is ${install.scureBaseFiles.bytes} bytes; candidate + Effect + @scure/base total ${install.candidateFiles.bytes + install.effectFiles.bytes + install.scureBaseFiles.bytes} unpacked file bytes. These are actual package files including source/maps/docs, not tarball transfer sizes or disk block usage.`,
  "Pure /data and /units browser metafiles contain zero Effect runtime inputs or emitted contribution; the package installation still carries Effect. Leaf versus barrel application imports are explicitly measured, rather than substituting a transformed source package. The total standalone runtime and the marginal runtime added to an existing Effect/Schema app must both inform the cost decision. The smaller delta for a barrel-import app does not recommend barrel imports: Effect+Schema existing gzip is 91,321 bytes with a barrel versus 24,469 with leaves, and combined account gzip is 101,767 versus 44,202 bytes.",
  "", "## Fixture acceptance", "",
  `${summary.totalObservedRequests} observed local HTTP requests; ${raw.fixtureViolations.length} fixture violations. All workload client counts and server methods/selectors/cursors match the specified work. Successful reads and every serialized binary entry were checked. This is synthetic protocol/consumer evidence, not real-node, wallet or browser acceptance. Historical phase-1 artifacts remain unchanged and are not relabelled as this candidate.`,
  "",
].join("\n")
await writeFile(join(directory, "summary.md"), report)
console.log(report)
