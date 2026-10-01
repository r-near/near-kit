import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { arch, cpus, freemem, loadavg, platform, release, totalmem } from "node:os"
import { performance } from "node:perf_hooks"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { brotliCompressSync, constants, gzipSync } from "node:zlib"
import { build, version as esbuild } from "esbuild"
import { fixture, pages } from "./fixture.mjs"
const here = dirname(fileURLToPath(import.meta.url)), work = resolve(here, "../../../artifacts/bench-next")
const lanes = ["candidate", "baseline", "near-api", "fetch-minimal", "fetch-bounded"]
const rounds = Number(process.env.BENCH_ROUNDS ?? 7), samples = Number(process.env.BENCH_SAMPLES ?? 25), warmups = Number(process.env.BENCH_WARMUPS ?? 5), importRounds = Number(process.env.BENCH_IMPORT_ROUNDS ?? 15)
const runName = process.env.BENCH_RUN_NAME ?? "final"
const output = join(work, "runs", runName)
try { await readFile(join(output, "raw.json")); throw Error("Choose a new BENCH_RUN_NAME; recorded runs are immutable") } catch (error) { if (error.code !== "ENOENT") throw error }
await mkdir(output, { recursive: true }); await mkdir(join(work, "files"), { recursive: true }); await mkdir(join(output, "bundles"), { recursive: true })
await cp(join(here, "consumers"), join(output, "consumers"), { recursive: true })
await cp(join(work, "entries"), join(output, "entries"), { recursive: true })
await cp(join(work, "examples"), join(output, "examples"), { recursive: true })
await cp(here, join(output, "harness"), { recursive: true })
const sha = bytes => createHash("sha256").update(bytes).digest("hex")
const provenance = JSON.parse(await readFile(join(work, "provenance.json"), "utf8"))
if (sha(await readFile(provenance.candidatePath)) !== provenance.candidateSha256) throw Error("Measured tarball changed")
for (const [name, digest] of Object.entries(provenance.packedDist)) if (sha(await readFile(join(work, "node_modules/@near-kit/next/dist", name))) !== digest) throw Error("Installed artifact changed")
let randomState = 20261001
const shuffled = values => { const result = [...values]; for (let i = result.length - 1; i > 0; i--) { randomState ^= randomState << 13; randomState ^= randomState >>> 17; randomState ^= randomState << 5; const j = (randomState >>> 0) % (i + 1); [result[i], result[j]] = [result[j], result[i]] }; return result }
const exec = promisify(execFile)
const child = async (mode, label, path, url = "") => {
  const start = performance.now()
  const { stdout, stderr } = await exec(process.execPath, ["--expose-gc", join(output, "harness/worker.mjs"), mode, path, url, String(samples), String(warmups)], { cwd: work, env: { ...process.env, NEAR_RPC_DEBUG: "false", NODE_ENV: "production" }, timeout: 120_000, maxBuffer: 8 * 1024 * 1024 })
  if (stderr.trim()) process.stderr.write(`[${label}] ${stderr}`)
  return { label, mode, wallMs: performance.now() - start, ...JSON.parse(stdout) }
}
const consumer = (lane, workload) => join(output, "consumers", `${lane}-${workload}.mjs`)
const entry = name => join(output, "entries", `${name}.mjs`)
const imported = lanes.flatMap(lane => ["account", "snapshot"].map(workload => ({ label: `${lane}-${workload}`, path: consumer(lane, workload) }))).concat(["candidate-wallet-react", "candidate-wallet-query", "candidate-file-export", "candidate-data", "candidate-units", "candidate-operator", "effect-leaf", "effect-barrel", "effect-schema-leaf", "effect-schema-barrel", "react-existing", "react-query-existing", "candidate-wallet-react-app", "candidate-wallet-query-app"].map(label => ({ label, path: entry(label) })))
async function hashes(dir, prefix = "") {
  const found = {}
  for (const item of await readdir(dir, { withFileTypes: true })) {
    if (item.isDirectory()) Object.assign(found, await hashes(join(dir, item.name), `${prefix}${item.name}/`))
    else found[`${prefix}${item.name}`] = sha(await readFile(join(dir, item.name)))
  }
  return found
}
const raw = {
  startedAt: new Date().toISOString(), runName, provenance, runtimeHarnessHashes: await hashes(join(output, "harness")),
  host: { node: process.version, platform: platform(), arch: arch(), kernel: release(), cpu: cpus()[0]?.model, logicalCpus: cpus().length, totalMemory: totalmem(), freeMemoryAtStart: freemem(), loadAtStart: loadavg() },
  methodology: { rounds, samples, warmups, importRounds, orderSeed: 20261001,
    imports: "Fresh processes; dynamic import excludes process startup, wallMs includes it. Filesystem/OS caches warm; no reboot-cold or browser-runtime claim. Exported root package loaded normally without transformed package copies.",
    workload: "Loopback read-only HTTP. One final account request, or complete 8-request snapshot: final block then 4 concurrent account/key/code/gas reads then 3 sequential state pages of 100+100+37 entries. 64-byte binary values. Serialization and assertions included. Fixture checks every method, selector, account, prefix, limit, cursor, count. Safe represented u64 fixture numbers; this does not equate legacy clients' precision outside the safe integer range.",
    fileExport: "Actual packed Node recipe, including fs open/write/sync/close/exclusive hard-link publication; timed sample additionally reads/asserts/removes its completed output. Not compared as a pure RPC timing.",
    wallet: "Actual packed wallet observation and React Query options recipe with a local selector-shaped synchronous store; one account read, mismatch suspension, subscription cleanup. No actual extension, UI mounting, wallet setup/authentication/signing or browser launch.",
    cancellation: "Abort immediately after response headers with unfinished body; unsupported public API lanes labelled, never simulated with Promise abandonment.",
    bundles: "esbuild 0.28.2 browser ESM ES2022 production, tree-shaken/minified; gzip9/Brotli11. Node file-export bundle separately labelled. All app dependencies included, wallet selector is type-only/caller supplied. Browser near-api-js includes real util@0.12.5 polyfill; Node imports use builtin util. Combined-bundle deltas are measured, never sums of independently compressed files.",
  }, imports: [], workloads: [], cancellation: [], bundles: [], errors: [],
}
const save = () => writeFile(join(output, "raw.json"), JSON.stringify(raw, null, 2) + "\n")
for (let round = 0; round < importRounds; round++) {
  for (const item of shuffled(imported)) raw.imports.push({ round, ...await child("import", item.label, item.path) })
  await save(); console.log(`Import round ${round + 1}/${importRounds}`)
}
const server = await fixture()
try {
  const tasks = lanes.flatMap(lane => ["account", "snapshot", "http503"].map(mode => ({ label: `${lane}-${mode}`, mode, path: consumer(lane, mode === "snapshot" ? "snapshot" : "account") }))).concat([{ label: "candidate-file-export", mode: "file-export", path: entry("candidate-file-export") }, { label: "candidate-wallet-query", mode: "wallet-query", path: entry("candidate-wallet-query") }])
  for (let round = 0; round < rounds; round++) {
    for (const task of shuffled(tasks)) raw.workloads.push({ round, ...await child(task.mode, task.label, task.path, `${server.url}/${task.label}-${round}/${task.mode}`) })
    await save(); console.log(`HTTP round ${round + 1}/${rounds}`)
  }
  for (const lane of shuffled(lanes)) raw.cancellation.push(await child("cancel", lane, consumer(lane, "account"), `${server.url}/${lane}/cancel`))
  raw.serverCounts = server.counts; raw.fixtureViolations = server.violations
  if (server.violations.length) throw Error("Fixture violations")
  const expectedPerRead = samples + warmups
  for (const [path, count] of Object.entries(server.counts)) {
    if (path.endsWith("/cancel")) { if (count.requests !== 5) throw Error(`Unexpected cancellation count ${path}`); continue }
    const snapshot = /\/(snapshot|file-export)$/.test(path)
    if (count.requests !== expectedPerRead * (snapshot ? 8 : 1)) throw Error(`Request count mismatch ${path}`)
    if (snapshot) {
      if (count.selectors.final !== expectedPerRead || count.selectors.hash !== expectedPerRead * 7) throw Error("Snapshot selector counts")
      for (const cursor of ["initial", pages[0].last_key, pages[1].last_key]) if (count.cursors[cursor] !== expectedPerRead) throw Error("Cursor count mismatch")
      for (const method of ["block", "gas_price", "view_account", "view_code", "view_access_key_list"]) if (count.types[method] !== expectedPerRead) throw Error("Method count mismatch")
      if (count.types.view_state !== expectedPerRead * 3) throw Error("State count mismatch")
    }
  }
} finally { raw.serverCounts = server.counts; raw.fixtureViolations = server.violations; await server.close(); await save() }
if (process.env.BENCH_SKIP_BUNDLES !== "1") {
  const classify = input => input.includes("node_modules/effect/") ? "effect" : input.includes("node_modules/@near-kit/next/") ? "candidate" : input.includes("node_modules/near-kit/") ? "baseline" : input.includes("node_modules/near-api-js/") ? "near-api" : input.includes("node_modules/") ? "other-dependencies" : "application"
  async function bundle(label, contents, targetPlatform = "browser") {
    await writeFile(join(output, "bundles", `${label}.entry.mjs`), contents)
    const options = { stdin: { contents, sourcefile: `${label}.mjs`, resolveDir: output, loader: "js" }, bundle: true, platform: targetPlatform, format: "esm", target: "es2022", treeShaking: true, legalComments: "none", write: false, define: { "process.env.NODE_ENV": '"production"' } }
    const plain = await build({ ...options, minify: false }), min = await build({ ...options, minify: true, metafile: true })
    const bytes = min.outputFiles[0].contents, attribution = {}
    for (const output of Object.values(min.metafile.outputs)) for (const [input, info] of Object.entries(output.inputs)) { const group = classify(input); attribution[group] = (attribution[group] ?? 0) + info.bytesInOutput }
    await writeFile(join(output, "bundles", `${label}.min.mjs`), bytes)
    await writeFile(join(output, "bundles", `${label}.meta.json`), JSON.stringify(min.metafile, null, 2))
    raw.bundles.push({ label, platform: targetPlatform, esbuild, rawBytes: plain.outputFiles[0].contents.byteLength, minifiedBytes: bytes.byteLength, gzipBytes: gzipSync(bytes, { level: 9 }).byteLength, brotliBytes: brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).byteLength, bundleSha256: sha(bytes), attributionUncompressedBytes: attribution, inputs: Object.keys(min.metafile.inputs), imports: Object.values(min.metafile.outputs).flatMap(x => x.imports) })
    await save(); console.log(`Bundle ${label}`)
  }
  const effectApps = ["effect-leaf", "effect-barrel", "effect-schema-leaf", "effect-schema-barrel"]
  for (const label of [...effectApps, "react-existing", "react-query-existing", "react-app-existing", "react-query-app-existing", "candidate-data", "candidate-units", "candidate-operator", "candidate-wallet-react", "candidate-wallet-query", "candidate-wallet-react-app", "candidate-wallet-query-app"]) await bundle(label, `export * from "./entries/${label}.mjs";`)
  for (const lane of lanes) for (const kind of ["account", "snapshot"]) {
    const label = `${lane}-${kind}`, contents = `export { make } from "./consumers/${label}.mjs";`
    await bundle(label, contents)
    for (const app of effectApps) await bundle(`${label}-plus-${app}`, contents + `export * from "./entries/${app}.mjs";`)
  }
  for (const app of ["react", "react-query", "react-app", "react-query-app"]) {
    const candidate = app.includes("query") ? (app.endsWith("app") ? "candidate-wallet-query-app" : "candidate-wallet-query") : app.endsWith("app") ? "candidate-wallet-react-app" : "candidate-wallet-react"
    const combined = app.endsWith("app")
      ? `export { mount as existingMount } from "./entries/${app}-existing.mjs"; export { mount as walletMount, make } from "./entries/${candidate}.mjs";`
      : `export * from "./entries/${app}-existing.mjs"; export * from "./entries/${candidate}.mjs";`
    await bundle(`${candidate}-plus-existing`, combined)
  }
  await bundle("candidate-file-export-node", 'import * as Near from "@near-kit/next"; import * as Effect from "effect/Effect"; import { exportSnapshot } from "./examples/snapshot-export.js"; export const make = url => { const client = Near.make({ url }); return (id, path, signal) => { signal?.throwIfAborted(); return Effect.runPromise(exportSnapshot(client, id, path).pipe(Effect.provide(Near.fetchLayer)), { signal }); }; };', "node")
}
raw.finishedAt = new Date().toISOString(); raw.host.loadAtEnd = loadavg(); await save()
console.log(`Complete: ${output}/raw.json`)
