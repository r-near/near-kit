import { spawnSync } from "node:child_process"
import { readFileSync, mkdtempSync, rmSync } from "node:fs"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
const root = resolve(process.argv[2] ?? "."),
  cache = mkdtempSync(join(tmpdir(), "near-kit-pack-audit-"))
try {
  const cwd = join(root, "packages", "near-kit")
  const result = spawnSync(
    "npm",
    ["--cache", cache, "pack", "--dry-run", "--ignore-scripts", "--json"],
    { cwd, encoding: "utf8" },
  )
  if (result.status !== 0) throw Error(result.stderr || result.stdout)
  const pack = JSON.parse(result.stdout)[0],
    pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"))
  const files = new Set(pack.files.map((f) => f.path))
  const missing = []
  const walk = (key, value) => {
    if (typeof value === "string") {
      if (value.startsWith("./") && !files.has(value.slice(2)))
        missing.push({ key, target: value })
    } else
      for (const [child, v] of Object.entries(value)) walk(`${key}/${child}`, v)
  }
  walk("exports", pkg.exports)
  console.log(
    JSON.stringify(
      {
        name: pkg.name,
        version: pkg.version,
        fileCount: files.size,
        packageBytes: pack.size,
        unpackedBytes: pack.unpackedSize,
        subpaths: Object.keys(pkg.exports),
        missingExportTargets: missing,
      },
      null,
      2,
    ),
  )
  if (missing.length) process.exitCode = 1
} finally {
  rmSync(cache, { recursive: true, force: true })
}
