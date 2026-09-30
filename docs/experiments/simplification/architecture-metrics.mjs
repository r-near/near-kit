import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { execFileSync } from "node:child_process"
const root = path.resolve(process.argv[2])
const require = createRequire(path.join(root, "package.json"))
const { parse } = require("@babel/parser")
const files = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
  .trim()
  .split("\n")
  .filter((f) => /^packages\/[^/]+\/src\/.*\.tsx?$/.test(f))
const totals = {
  modules: 0,
  physicalLines: 0,
  nonblankWithoutComments: 0,
  classes: 0,
  asyncFunctions: 0,
  weakMaps: 0,
  boundaryCalls: 0,
  boundaries: {},
}
const boundaryNames = new Set([
  "runPromise",
  "runPromiseExit",
  "runSync",
  "runSyncExit",
  "runFork",
  "tryPromise",
  "promise",
  "fromPromise",
  "fromSync",
  "inputEffect",
  "transactionSync",
])
const rows = []
for (const file of files) {
  const text = fs.readFileSync(path.join(root, file), "utf8")
  const ast = parse(text, {
    sourceType: "module",
    plugins: ["typescript", ...(file.endsWith("x") ? ["jsx"] : [])],
    attachComment: true,
  })
  let clean = text
  for (const c of [...ast.comments].reverse())
    clean =
      clean.slice(0, c.start) +
      clean.slice(c.start, c.end).replace(/[^\n]/g, " ") +
      clean.slice(c.end)
  const row = {
    file,
    physicalLines: text.split("\n").length - (text.endsWith("\n") ? 1 : 0),
    nonblankWithoutComments: clean.split("\n").filter((l) => l.trim()).length,
    classes: [],
    asyncFunctions: 0,
    weakMaps: 0,
    boundaries: {},
  }
  const visit = (n) => {
    if (!n || typeof n !== "object") return
    if (n.type === "ClassDeclaration" || n.type === "ClassExpression")
      row.classes.push({
        name: n.id?.name ?? "<anonymous>",
        super: n.superClass
          ? text.slice(n.superClass.start, n.superClass.end)
          : null,
      })
    if (n.async === true) row.asyncFunctions++
    if (n.type === "NewExpression" && n.callee?.name === "WeakMap")
      row.weakMaps++
    if (n.type === "CallExpression") {
      let name =
        n.callee?.type === "Identifier"
          ? n.callee.name
          : n.callee?.type === "MemberExpression" && !n.callee.computed
            ? n.callee.property.name
            : null
      if (boundaryNames.has(name))
        row.boundaries[name] = (row.boundaries[name] ?? 0) + 1
    }
    for (const [key, value] of Object.entries(n))
      if (
        ![
          "comments",
          "tokens",
          "loc",
          "leadingComments",
          "trailingComments",
          "innerComments",
        ].includes(key)
      ) {
        if (Array.isArray(value)) for (const child of value) visit(child)
        else if (value && typeof value === "object") visit(value)
      }
  }
  visit(ast.program)
  rows.push(row)
  totals.modules++
  totals.physicalLines += row.physicalLines
  totals.nonblankWithoutComments += row.nonblankWithoutComments
  totals.classes += row.classes.length
  totals.asyncFunctions += row.asyncFunctions
  totals.weakMaps += row.weakMaps
  for (const [name, count] of Object.entries(row.boundaries)) {
    totals.boundaries[name] = (totals.boundaries[name] ?? 0) + count
    totals.boundaryCalls += count
  }
}
console.log(
  JSON.stringify(
    {
      commit: execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: root,
        encoding: "utf8",
      }).trim(),
      method:
        "Tracked packages/*/src TypeScript; physical lines and Babel-comment-stripped nonblank lines include type declarations. Boundary counts are static call sites by named runner/adapter, not dynamic crossings; classify pure sync guards separately.",
      totals,
      files: rows,
    },
    null,
    2,
  ),
)
