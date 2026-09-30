import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { resolve } from "node:path"
const [baseline, candidate, runs = "7"] = process.argv.slice(2)
if (!baseline || !candidate)
  throw Error(
    "Usage: node compare.mjs BASELINE_CHECKOUT CANDIDATE_CHECKOUT [RUNS]",
  )
const roots = [resolve(baseline), resolve(candidate)]
const rows = []
for (let i = 0; i < Number(runs); i++)
  for (const root of i % 2 ? [...roots].reverse() : roots) {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("./benchmark.mjs", import.meta.url)), root],
      { encoding: "utf8" },
    )
    if (result.status !== 0) throw Error(result.stderr || result.stdout)
    rows.push(JSON.parse(result.stdout))
  }
const metrics = ["importMs", "viewMs", "constructMs", "signMs"]
const summary = roots.map((root) => ({
  root,
  ...Object.fromEntries(
    metrics.map((metric) => {
      const values = rows
        .filter((r) => r.root === root)
        .map((r) => r[metric])
        .sort((a, b) => a - b)
      const mid = Math.floor(values.length / 2)
      const median =
        values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2
      return [metric, { median, min: values[0], max: values.at(-1) }]
    }),
  ),
}))
console.log(
  JSON.stringify(
    {
      node: process.version,
      method:
        "alternating fresh processes; 100 read/20 sign warmups; totals for 2000 reads,2000 constructions,200 signatures",
      summary,
      rows,
    },
    null,
    2,
  ),
)
