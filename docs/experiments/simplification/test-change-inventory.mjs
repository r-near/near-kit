import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
const require = createRequire(process.cwd() + "/package.json")
const { parse } = require("@babel/parser")
// Run from the repository root with two immutable commit references.
const refs = process.argv.slice(2)
if (refs.length !== 2)
  throw new Error("Usage: node test-change-inventory.mjs BASELINE CANDIDATE")
function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim()
}
function base(n) {
  if (!n) return ""
  if (n.type === "Identifier") return n.name
  if (n.type === "MemberExpression") return base(n.object)
  if (n.type === "CallExpression") return base(n.callee)
  return ""
}
function inventory(ref) {
  const out = []
  for (const file of git("ls-tree", "-r", "--name-only", ref)
    .split("\n")
    .filter((x) => /^packages\/.*\/tests\/.*\.test\.tsx?$/.test(x))) {
    const text = git("show", `${ref}:${file}`)
    const ast = parse(text, {
      sourceType: "module",
      plugins: ["typescript", ...(file.endsWith("x") ? ["jsx"] : [])],
    })
    function visit(n) {
      if (!n || typeof n !== "object") return
      if (
        n.type === "CallExpression" &&
        ["it", "test"].includes(base(n.callee)) &&
        n.arguments[0]?.type === "StringLiteral"
      )
        out.push({ file, title: n.arguments[0].value, line: n.loc.start.line })
      for (const [k, v] of Object.entries(n)) {
        if (
          [
            "loc",
            "comments",
            "leadingComments",
            "trailingComments",
            "innerComments",
          ].includes(k)
        )
          continue
        if (Array.isArray(v)) v.forEach(visit)
        else if (v && typeof v === "object") visit(v)
      }
    }
    visit(ast.program)
  }
  return out
}
const [before, after] = refs.map(inventory)
function subtract(a, b) {
  const counts = new Map()
  for (const t of b) {
    const k = t.file + "\n" + t.title
    counts.set(k, (counts.get(k) || 0) + 1)
  }
  return a.filter((t) => {
    const k = t.file + "\n" + t.title
    const count = counts.get(k) || 0
    if (count) {
      counts.set(k, count - 1)
      return false
    }
    return true
  })
}
console.log(
  JSON.stringify(
    {
      baseline: refs[0],
      candidate: refs[1],
      method:
        "Static literal test declarations, not expanded runtime case counts. A renamed or table-consolidated declaration appears in both lists; see test-retention.md for reviewed behavioral ownership.",
      removedOrRenamed: subtract(before, after),
      addedOrRenamed: subtract(after, before),
    },
    null,
    2,
  ),
)
