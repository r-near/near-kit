import { mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve, join } from "node:path"
import { spawnSync } from "node:child_process"
const root = resolve(process.argv[2] ?? "."),
  out = resolve(process.argv[3] ?? "browser-acceptance")
const cache = join(root, "node_modules", ".cache", "near-kit-acceptance")
await mkdir(cache, { recursive: true })
await mkdir(out, { recursive: true })
const input = join(cache, "browser-probe.ts")
await writeFile(
  input,
  await readFile(new URL("./browser-probe.ts", import.meta.url)),
)
const result = spawnSync(
  "bun",
  [
    "build",
    input,
    "--target",
    "browser",
    "--minify",
    "--outfile",
    join(out, "smoke.js"),
  ],
  { cwd: root, encoding: "utf8" },
)
if (result.status !== 0) throw Error(result.stderr || result.stdout)
await writeFile(
  join(out, "index.html"),
  '<!doctype html><meta charset="utf-8"><title>Running near-kit acceptance</title><body>Running browser acceptance<script type="module" src="./smoke.js"></script></body>',
)
console.log(result.stdout)
console.log(
  `Serve ${out} over localhost HTTP; open index.html and inspect the PASS/FAIL title and JSON result.`,
)
