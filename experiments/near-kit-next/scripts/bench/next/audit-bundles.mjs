// Separate retained bundle validation/correction pass; never rewrites raw timings.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { brotliCompressSync, constants, gzipSync } from "node:zlib"
import { build, version as esbuild } from "esbuild"
const root = resolve(process.env.BENCH_WORK_DIR ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../../artifacts/bench-next")), runName = process.env.BENCH_RUN_NAME ?? "final", work = join(root, "runs", runName)
const raw = JSON.parse(await readFile(join(work, "raw.json"), "utf8"))
assert.ok(raw.finishedAt, "Wait for immutable runtime run completion")
const output = join(work, "audited-bundles"); await mkdir(output, { recursive: true })
const sha = bytes => createHash("sha256").update(bytes).digest("hex")
const classify = input => input.includes("node_modules/effect/") ? "effect" : input.includes("node_modules/@near-kit/next/") ? "candidate" : input.includes("node_modules/") ? "other-dependencies" : "application"
const specs = [
  { label: "candidate-wallet-react-app-plus-existing", platform: "browser", contents: 'export { mount as existingMount } from "./entries/react-app-existing.mjs"; export { mount as walletMount, make } from "./entries/candidate-wallet-react-app.mjs";', required: ["existingMount", "walletMount", "make"] },
  { label: "candidate-wallet-query-app-plus-existing", platform: "browser", contents: 'export { mount as existingMount } from "./entries/react-query-app-existing.mjs"; export { mount as walletMount, make } from "./entries/candidate-wallet-query-app.mjs";', required: ["existingMount", "walletMount", "make"] },
  { label: "candidate-file-export-node", platform: "node", contents: 'import * as Near from "@near-kit/next"; import * as Effect from "effect/Effect"; import { exportSnapshot } from "./examples/snapshot-export.js"; export const make = url => { const client = Near.make({ url }); return (id, path, signal) => { signal?.throwIfAborted(); return Effect.runPromise(exportSnapshot(client, id, path).pipe(Effect.provide(Near.fetchLayer)), { signal }); }; };', required: ["make"] },
]
const records = []
for (const spec of specs) {
  const options = { stdin: { contents: spec.contents, resolveDir: work, sourcefile: `${spec.label}.mjs`, loader: "js" }, bundle: true, platform: spec.platform, format: "esm", target: "es2022", treeShaking: true, legalComments: "none", write: false, define: { "process.env.NODE_ENV": '"production"' } }
  const plain = await build({ ...options, minify: false }), min = await build({ ...options, minify: true, metafile: true }), bytes = min.outputFiles[0].contents
  const out = Object.values(min.metafile.outputs)[0]
  for (const name of spec.required) assert.ok(out.exports.includes(name), `Lost observable consumer export ${name}`)
  const attribution = {}
  for (const [input, info] of Object.entries(out.inputs)) { const group = classify(input); attribution[group] = (attribution[group] ?? 0) + info.bytesInOutput }
  await writeFile(join(output, `${spec.label}.entry.mjs`), spec.contents)
  await writeFile(join(output, `${spec.label}.min.mjs`), bytes)
  await writeFile(join(output, `${spec.label}.meta.json`), JSON.stringify(min.metafile, null, 2))
  records.push({ label: spec.label, platform: spec.platform, esbuild, rawBytes: plain.outputFiles[0].contents.byteLength, minifiedBytes: bytes.byteLength, gzipBytes: gzipSync(bytes, { level: 9 }).byteLength, brotliBytes: brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).byteLength, bundleSha256: sha(bytes), entrySha256: sha(spec.contents), attributionUncompressedBytes: attribution, inputs: Object.keys(min.metafile.inputs), imports: out.imports, exports: out.exports, audited: true })
}
const report = { createdAt: new Date().toISOString(), candidateSha256: raw.provenance.candidateSha256, rawSha256: sha(await readFile(join(work, "raw.json"))), reasons: ["Combined mountable application entries require explicit aliases for their two mount exports; duplicate export-star names otherwise erase the observable mounts.", "The actual file-export consumer exports only its callable factory, rather than accidentally exporting the complete Effect namespace used by runtime measurement instrumentation."], bundles: records }
await writeFile(join(output, "results.json"), JSON.stringify(report, null, 2) + "\n")
console.log(JSON.stringify(report, null, 2))
