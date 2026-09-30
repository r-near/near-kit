import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, mkdtempSync, rmSync } from "node:fs"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { gzipSync } from "node:zlib"

const root = resolve(process.argv[2] ?? ".")
const out = mkdtempSync(join(tmpdir(), "near-kit-bundle-audit-"))
try {
  const source = join(root, "packages/near-kit/src")
  const entries = [join(source, "index.ts")]
  if (existsSync(join(source, "effect/index.ts")))
    entries.push(join(source, "effect/index.ts"))
  const meta = join(out, "meta.json")
  const build = spawnSync(
    "bun",
    [
      "build",
      ...entries,
      "--target=browser",
      "--minify",
      `--outdir=${out}`,
      `--metafile=${meta}`,
    ],
    { cwd: root, encoding: "utf8" },
  )
  if (build.status !== 0) throw Error(build.stderr || build.stdout)
  const graph = JSON.parse(readFileSync(meta, "utf8"))
  const outputs = [
    "index.js",
    ...(entries.length === 2 ? ["effect/index.js"] : []),
  ]
  console.log(
    JSON.stringify(
      {
        method:
          "All available source entrypoints built together; browser target; minify; Node gzip level 9",
        node: process.version,
        zlib: process.versions.zlib,
        entries: outputs.map((entry) => {
          const bytes = readFileSync(join(out, entry))
          return {
            entry,
            rawBytes: bytes.length,
            gzip9Bytes: gzipSync(bytes, { level: 9 }).length,
          }
        }),
        zodInputs: Object.keys(graph.inputs)
          .filter((file) => /[/\\]zod[/\\]/.test(file))
          .map(modulePath),
        compatibilitySchemaInputs: Object.keys(graph.inputs)
          .filter((file) =>
            /[/\\](schemas[/\\]index|credential-schemas)\./.test(file),
          )
          .map(modulePath),
        externalImports: Object.values(graph.outputs).flatMap((output) =>
          (output.imports ?? []).filter((item) => item.external),
        ),
      },
      null,
      2,
    ),
  )
} finally {
  rmSync(out, { recursive: true, force: true })
}

function modulePath(file) {
  const dependency = file.lastIndexOf("node_modules/")
  if (dependency >= 0) return file.slice(dependency)
  const source = file.indexOf("packages/")
  return source >= 0 ? file.slice(source) : file
}
