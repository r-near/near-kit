import { isDeepStrictEqual } from "node:util"
import { createRequire } from "node:module"
const { resolve } = await import("node:path")
if (!process.argv[2] || !process.argv[3])
  throw Error(
    "Usage: node schema-parity-deep.mjs BASELINE_CHECKOUT CANDIDATE_CHECKOUT",
  )
const baseline = resolve(process.argv[2])
const root = resolve(process.argv[3])
const require = createRequire(root + "/package.json")
const { z } = require("zod")
const { Schema } = await import(require.resolve("effect"))
const legacy = await import(
  baseline + "/packages/near-kit/dist/core/rpc/rpc-schemas.js"
)
const native = await import(
  root + "/packages/near-kit/dist/effect/protocol-schemas.js"
)
function sample(s, seed, depth = 0) {
  if (depth > 18) return null
  if (s.const !== undefined) return s.const
  if (s.enum) return s.enum[seed % s.enum.length]
  const union = s.anyOf ?? s.oneOf
  if (union)
    return sample(
      union[seed % union.length],
      Math.floor(seed / union.length) + 1,
      depth + 1,
    )
  switch (s.type) {
    case "object":
      return Object.fromEntries(
        Object.entries(s.properties ?? {})
          .filter(([k]) => seed % 2 || s.required?.includes(k))
          .map(([k, v]) => [k, sample(v, seed + 1, depth + 1)]),
      )
    case "array":
      return seed % 3 ? [sample(s.items ?? {}, seed + 1, depth + 1)] : []
    case "number":
    case "integer":
      return 7
    case "string":
      return "fixture"
    case "null":
      return null
    case "boolean":
      return true
    default:
      return "extension"
  }
}
let cases = 0,
  matched = 0,
  valid = 0
const differences = []
for (const [name, schema] of Object.entries(legacy)) {
  if (!native[name]) continue
  matched++
  const json = z.toJSONSchema(schema, { unrepresentable: "any" })
  for (let seed = 0; seed < 30; seed++) {
    const value = sample(json, seed)
    const variants = [value, null, undefined, 0, {}, []]
    function mutatePaths(v, parts = [], depth = 0) {
      if (depth > 7 || v === null || typeof v !== "object") return
      for (const key of Object.keys(v)) {
        const path = [...parts, key]
        for (const replacement of [
          undefined,
          null,
          {},
          [],
          42,
          "value",
          true,
          Infinity,
          NaN,
        ]) {
          const copy = structuredClone(value)
          let parent = copy
          for (const p of path.slice(0, -1)) parent = parent[p]
          parent[path.at(-1)] = replacement
          variants.push(copy)
        }
        mutatePaths(v[key], path, depth + 1)
      }
    }
    mutatePaths(value)
    for (const input of variants) {
      cases++
      const a = schema.safeParse(input)
      let b,
        ok = true
      try {
        b = Schema.decodeUnknownSync(native[name])(input)
      } catch {
        ok = false
      }
      if (a.success) valid++
      if (a.success !== ok || (a.success && !isDeepStrictEqual(a.data, b)))
        differences.push({
          name,
          seed,
          input,
          old: a.success ? a.data : "reject",
          native: ok ? b : "reject",
        })
    }
  }
}
console.log(
  JSON.stringify(
    {
      matched,
      cases,
      valid,
      differences: differences.slice(0, 30),
      differenceCount: differences.length,
    },
    null,
    2,
  ),
)
