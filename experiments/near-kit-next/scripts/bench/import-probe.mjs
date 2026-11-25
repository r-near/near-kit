// Diagnostic only: transformed copies are never installed over the measured package.
import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { brotliCompressSync, constants, gzipSync } from "node:zlib"
import { build } from "esbuild"

const here = dirname(fileURLToPath(import.meta.url))
const work = resolve(here, "../../artifacts/bench")
const probe = join(work, "import-probe")
await mkdir(probe, { recursive: true })
await cp(
  join(work, "node_modules/@near-kit/read-experiment/dist"),
  join(probe, "leaf-copy"),
  { recursive: true },
)
const leafify = (source) =>
  source.replace(
    /import\s+\{([^}]+)\}\s+from\s+["']effect["'];?/g,
    (_, names) =>
      names
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean)
        .map((name) => {
          if (!/^[A-Za-z]+$/.test(name))
            throw new Error(`Unexpected import ${name}`)
          return `import * as ${name} from "effect/${name}";`
        })
        .join("\n"),
  )
const changed = []
for (const file of await readdir(join(probe, "leaf-copy"))) {
  if (!file.endsWith(".js")) continue
  const original = await readFile(join(probe, "leaf-copy", file), "utf8")
  const transformed = leafify(original)
  await writeFile(join(probe, "leaf-copy", file), transformed)
  if (original !== transformed) changed.push(file)
}
const originalConsumer = await readFile(
  join(work, "consumers/prototype.mjs"),
  "utf8",
)
const consumer = `import {Effect, Schema} from "effect";\n${originalConsumer.replace(/^import .* from "effect(?:\/(?:Effect|Schema))?";?\r?\n/gm, "")}`
const copiedConsumer = consumer.replace(
  '"@near-kit/read-experiment"',
  '"./leaf-copy/index.js"',
)
const entries = {
  "effect-barrel": 'import * as Effect from "effect"; export {Effect};',
  "effect-leaf": 'import * as Effect from "effect/Effect"; export {Effect};',
  "effect-schema-leaves":
    'import * as Effect from "effect/Effect"; import * as Schema from "effect/Schema"; export {Effect,Schema};',
  "prototype-package-only":
    'import * as Near from "@near-kit/read-experiment"; export {Near};',
  "prototype-complete-barrel": consumer,
  "prototype-package-leaf-copy":
    'import * as Near from "./leaf-copy/index.js"; export {Near};',
  "prototype-complete-leaf-copy": leafify(copiedConsumer),
  "prototype-leaf-copy-barrel-app": copiedConsumer,
}
for (const [name, source] of Object.entries(entries))
  await writeFile(join(probe, `${name}.mjs`), source)
const exec = promisify(execFile)
const results = []
let state = 927161
for (let round = 0; round < 15; round++) {
  const order = Object.keys(entries)
  for (let i = order.length - 1; i > 0; i--) {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    const j = (state >>> 0) % (i + 1)
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  for (const name of order) {
    const { stdout } = await exec(
      process.execPath,
      [join(here, "worker.mjs"), "import", join(probe, `${name}.mjs`)],
      {
        cwd: work,
        env: { ...process.env, TMPDIR: join(work, "tmp") },
        timeout: 15_000,
      },
    )
    results.push({ round, name, ...JSON.parse(stdout) })
  }
}
const bundles = []
for (const name of [
  "prototype-complete-barrel",
  "prototype-complete-leaf-copy",
  "prototype-leaf-copy-barrel-app",
]) {
  const source = `import {make} from './${name}.mjs'; export const read=(url,id)=>make(url).account(id);`
  const result = await build({
    stdin: {
      contents: source,
      resolveDir: probe,
      sourcefile: `${name}.entry.mjs`,
    },
    bundle: true,
    platform: "browser",
    format: "esm",
    target: "es2022",
    minify: true,
    legalComments: "none",
    write: false,
    metafile: true,
  })
  const bytes = result.outputFiles[0].contents
  await writeFile(join(probe, `${name}.min.mjs`), bytes)
  bundles.push({
    name,
    minifiedBytes: bytes.byteLength,
    gzipBytes: gzipSync(bytes, { level: 9 }).byteLength,
    brotliBytes: brotliCompressSync(bytes, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
    }).byteLength,
  })
}
const summary = Object.fromEntries(
  Object.keys(entries).map((name) => {
    const values = results
      .filter((v) => v.name === name)
      .map((v) => v.importMs)
      .sort((a, b) => a - b)
    return [
      name,
      {
        medianMs: values[7],
        p10Ms: values[1],
        p90Ms: values[13],
        minMs: values[0],
        maxMs: values[14],
      },
    ]
  }),
)
const digest = (value) => createHash("sha256").update(value).digest("hex")
const output = {
  diagnosticOnly: true,
  sourceArtifact: JSON.parse(
    await readFile(join(work, "provenance.json"), "utf8"),
  ).prototypeSha256,
  changedCopyFiles: changed,
  transformation:
    "Only rewrite named runtime imports from effect into effect/Module namespace imports; original artifact untouched",
  originalConsumerSha256: digest(consumer),
  leafConsumerSha256: digest(leafify(copiedConsumer)),
  summary,
  bundles,
  samples: results,
}
await writeFile(
  join(probe, "results.json"),
  `${JSON.stringify(output, null, 2)}\n`,
)
console.log(JSON.stringify({ summary, bundles }, null, 2))
