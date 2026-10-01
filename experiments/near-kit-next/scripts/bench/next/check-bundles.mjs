// Node execution of browser-targeted pure read bundles is an additional packaging
// smoke check, explicitly not browser-engine or real-wallet compatibility evidence.
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { fixture, id } from "./fixture.mjs"
const here = dirname(fileURLToPath(import.meta.url)), work = resolve(here, "../../../artifacts/bench-next"), directory = join(work, "runs", process.env.BENCH_RUN_NAME ?? "final")
const raw = JSON.parse(await readFile(join(directory, "raw.json"), "utf8")), server = await fixture(), results = []
const run = promisify(execFile)
try {
  for (const lane of ["candidate", "baseline", "near-api", "fetch-minimal", "fetch-bounded"]) for (const workload of ["account", "snapshot"]) {
    const label = `${lane}-${workload}`, path = join(directory, "bundles", `${label}.min.mjs`)
    const bytes = await readFile(path), record = raw.bundles.find(x => x.label === label)
    assert.equal(createHash("sha256").update(bytes).digest("hex"), record.bundleSha256)
    const { stdout } = await run(process.execPath, [join(directory, "harness/worker.mjs"), workload, path, `${server.url}/bundled-${lane}/${workload}`, "1", "0"], { cwd: work, env: { ...process.env, NODE_ENV: "production" }, timeout: 120000 })
    results.push({ label, testedIn: "Node, browser-targeted ESM", result: JSON.parse(stdout) })
  }
  const fileModule = await import(pathToFileURL(join(directory, "audited-bundles/candidate-file-export-node.min.mjs")))
  const output = join(work, "files", `audited-${process.pid}.ndjson`)
  const summary = await fileModule.make(`${server.url}/audited/file-export`)(id, output)
  assert.equal(summary.pages, 3n); assert.equal(summary.entries, 237n)
  const records = (await readFile(output, "utf8")).trim().split("\n").map(x => JSON.parse(x))
  assert.equal(records.length, 6); assert.equal(records.at(-1).entries, "237")
  await assert.rejects(readFile(`${output}.partial`), { code: "ENOENT" }); await rm(output)
  results.push({ label: "candidate-file-export-node", testedIn: "Node", pages: 3, entries: 237, finalPublished: true, partialAbsent: true })
  assert.deepEqual(server.violations, [])
} finally { await server.close() }
await writeFile(join(directory, "bundle-execution-checks.json"), JSON.stringify({ checkedAt: new Date().toISOString(), candidateSha256: raw.provenance.candidateSha256, note: "Packaging execution only. Does not establish real browser, wallet, network or adversarial equivalence.", results, fixtureViolations: server.violations, counts: server.counts }, null, 2) + "\n")
console.log(`Checked ${results.length} bundled workflows; zero fixture violations`)
