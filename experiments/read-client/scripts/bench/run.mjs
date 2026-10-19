import { execFile } from "node:child_process"
import { cp, mkdir, readFile, writeFile } from "node:fs/promises"
import {
  arch,
  cpus,
  freemem,
  loadavg,
  platform,
  release,
  totalmem,
} from "node:os"
import { dirname, join, resolve } from "node:path"
import { performance } from "node:perf_hooks"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { brotliCompressSync, constants, gzipSync } from "node:zlib"
import { build, version as esbuildVersion } from "esbuild"
import { fixture } from "./fixture.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const work = resolve(here, "../../artifacts/bench")
const lanes = [
  "prototype",
  "baseline",
  "near-api",
  "fetch-minimal",
  "fetch-validated",
]
const rounds = Number(process.env.BENCH_ROUNDS ?? 7)
const samples = Number(process.env.BENCH_SAMPLES ?? 25)
const importRounds = Number(process.env.BENCH_IMPORT_ROUNDS ?? 15)
const fragmentRounds = Number(process.env.BENCH_FRAGMENT_ROUNDS ?? 3)
const warmups = 5
await mkdir(join(work, "consumers"), { recursive: true })
await cp(join(here, "consumers"), join(work, "consumers"), { recursive: true })
await mkdir(join(work, "bundles"), { recursive: true })
let randomState = 20260930
function shuffled(values) {
  const out = [...values]
  for (let i = out.length - 1; i > 0; i--) {
    randomState ^= randomState << 13
    randomState ^= randomState >>> 17
    randomState ^= randomState << 5
    const j = (randomState >>> 0) % (i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}
const exec = promisify(execFile)
const child = async (mode, lane, url = "", extra = []) => {
  const start = performance.now()
  const { stdout, stderr } = await exec(
    process.execPath,
    [
      "--expose-gc",
      join(here, "worker.mjs"),
      mode,
      join(work, "consumers", `${lane}.mjs`),
      url,
      String(samples),
      String(warmups),
      ...extra,
    ],
    {
      cwd: work,
      env: {
        ...process.env,
        TMPDIR: join(work, "tmp"),
        NEAR_RPC_DEBUG: "false",
      },
      timeout: 120_000,
      maxBuffer: 8 * 1024 * 1024,
    },
  )
  if (stderr.trim()) process.stderr.write(`[${lane}/${mode}] ${stderr}`)
  return { lane, wallMs: performance.now() - start, ...JSON.parse(stdout) }
}
const raw = {
  startedAt: new Date().toISOString(),
  host: {
    node: process.version,
    arch: arch(),
    platform: platform(),
    kernel: release(),
    cpu: cpus()[0]?.model,
    logicalCpus: cpus().length,
    totalMemory: totalmem(),
    freeMemoryAtStart: freemem(),
    loadAtStart: loadavg(),
  },
  methodology: {
    rounds,
    samples,
    importRounds,
    fragmentRounds,
    warmups,
    orderSeed: 20260930,
    timing:
      "Fresh process imports exclude process startup; wallMs includes startup. Workload timing includes result assertion. Independent process per lane/round, reused client per operation, sequential samples; four-read workload has concurrency four. Single internal attempt; retry3 explicitly calls the failing read three times without delay. Loopback HTTP only.",
    fragment:
      "Separate local Fetch/ReadableStream fixture, 256KiB ignored envelope padding, one-byte versus 16KiB chunks; fresh process per sample. maxRSS is process-wide including import and is not precise allocation attribution. No network timings in this observation.",
  },
  provenance: JSON.parse(await readFile(join(work, "provenance.json"), "utf8")),
  imports: [],
  workloads: [],
  fragments: [],
  bundles: [],
}
const save = () =>
  writeFile(join(work, "raw.json"), `${JSON.stringify(raw, null, 2)}\n`)
for (let round = 0; round < importRounds; round++) {
  for (const lane of shuffled(lanes))
    raw.imports.push({ round, ...(await child("import", lane)) })
}
await save()
console.log("Fresh-process import samples complete")
const server = await fixture()
try {
  for (let round = 0; round < rounds; round++) {
    for (const lane of shuffled(lanes))
      raw.workloads.push({
        round,
        ...(await child("work", lane, `${server.url}/${lane}-${round}`)),
      })
    await save()
    console.log(`Local HTTP round ${round + 1}/${rounds} complete`)
  }
  raw.serverCounts = server.counts
  raw.fixtureViolations = server.violations
  if (server.violations.length)
    throw new Error("Fixture detected mismatched reads; inspect raw evidence")
} finally {
  await server.close()
  await save()
}
for (let round = 0; round < fragmentRounds; round++) {
  for (const lane of shuffled(lanes)) {
    for (const chunk of shuffled([1, 16384]))
      raw.fragments.push({
        round,
        ...(await child("fragment", lane, String(chunk))),
      })
  }
  await save()
}
console.log("Fragmented-body observations complete")

const appEffect =
  'import { Effect } from "effect"; export const existingEffectWork = () => Effect.runPromise(Effect.succeed(1));\n'
const appSchema =
  'import { Effect, Schema } from "effect"; const User = Schema.Struct({ id: Schema.String }); export const existingEffectWork = (input) => Effect.runPromise(Schema.decodeUnknownEffect(User)(input));\n'
const appEffectLeaf =
  'import * as Effect from "effect/Effect"; export const existingEffectWork = () => Effect.runPromise(Effect.succeed(1));\n'
const appSchemaLeaf =
  'import * as Effect from "effect/Effect"; import * as Schema from "effect/Schema"; const User = Schema.Struct({ id: Schema.String }); export const existingEffectWork = (input) => Effect.runPromise(Schema.decodeUnknownEffect(User)(input));\n'
async function bundle(label, contents) {
  const sourcePath = join(work, "bundles", `${label}.entry.mjs`)
  await writeFile(sourcePath, contents)
  const options = {
    stdin: {
      contents,
      resolveDir: work,
      sourcefile: `${label}.mjs`,
      loader: "js",
    },
    bundle: true,
    platform: "browser",
    format: "esm",
    target: "es2022",
    treeShaking: true,
    legalComments: "none",
    write: false,
  }
  const plain = await build({ ...options, minify: false })
  const minified = await build({ ...options, minify: true, metafile: true })
  const bytes = minified.outputFiles[0].contents
  await writeFile(join(work, "bundles", `${label}.min.mjs`), bytes)
  await writeFile(
    join(work, "bundles", `${label}.meta.json`),
    JSON.stringify(minified.metafile, null, 2),
  )
  const record = {
    label,
    esbuild: esbuildVersion,
    rawBytes: plain.outputFiles[0].contents.byteLength,
    minifiedBytes: bytes.byteLength,
    gzipBytes: gzipSync(bytes, { level: 9 }).byteLength,
    brotliBytes: brotliCompressSync(bytes, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
    }).byteLength,
    inputs: Object.keys(minified.metafile.inputs),
  }
  raw.bundles.push(record)
}
await bundle("effect-existing", appEffect)
await bundle("effect-schema-existing", appSchema)
await bundle("effect-leaf-existing", appEffectLeaf)
await bundle("effect-schema-leaf-existing", appSchemaLeaf)
for (const lane of lanes) {
  for (const operation of ["account", "view", "four"]) {
    // Exact consumer sources are retained. All lanes' measurement adapters
    // expose the same small factory; that extra application glue is included.
    const entry = `import { make } from "./consumers/${lane}.mjs"; export const read = (url, input) => make(url).${operation}(input);\n`
    const name = lane === "near-api" ? "near-api-with-util-polyfill" : lane
    await bundle(`${name}-${operation}`, entry)
    if (operation === "account") {
      await bundle(`${name}-account-plus-effect`, appEffect + entry)
      await bundle(`${name}-account-plus-effect-schema`, appSchema + entry)
      await bundle(`${name}-account-plus-effect-leaf`, appEffectLeaf + entry)
      await bundle(
        `${name}-account-plus-effect-schema-leaf`,
        appSchemaLeaf + entry,
      )
    }
  }
}
raw.finishedAt = new Date().toISOString()
raw.host.loadAtEnd = loadavg()
await save()
console.log(`Raw measurements saved: ${join(work, "raw.json")}`)
