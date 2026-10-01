import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { transform, version as esbuild } from "esbuild"
import { bootstrapBaseline } from "./bootstrap-baseline.mjs"
const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, "../../.."), repo = resolve(root, "../.."), work = resolve(process.env.BENCH_WORK_DIR ?? join(root, "artifacts/bench-next"))
const [tarballArg, expected] = process.argv.slice(2)
if (!tarballArg || !/^[a-f0-9]{64}$/.test(expected ?? "")) throw Error("Usage: node scripts/bench/next/setup.mjs TARBALL SHA256")
const sha = bytes => createHash("sha256").update(bytes).digest("hex"), tarball = resolve(tarballArg)
if (sha(await readFile(tarball)) !== expected) throw Error("Candidate tarball hash mismatch")
await mkdir(work, { recursive: true })
const run = (cmd, args, cwd = work) => execFileSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, env: { ...process.env, npm_config_cache: "/tmp/near-bench-next-cache", npm_config_update_notifier: "false" } })
// Setup writes only a new candidate checkpoint; recorded evidence is immutable.
try { await stat(join(work, "provenance.json")); throw Error("Choose a fresh BENCH_WORK_DIR; checkpoint provenance already exists") }
catch (error) { if (error.code !== "ENOENT") throw error }
const historical = await bootstrapBaseline(work)
const installed = join(work, "node_modules/@near-kit/next")
await mkdir(installed, { recursive: true })
run("tar", ["-xzf", tarball, "--strip-components=1", "-C", installed])
const packedManifest = JSON.parse(await readFile(join(installed, "package.json"), "utf8"))
if (packedManifest.name !== "@near-kit/next" || packedManifest.dependencies.effect !== "4.0.0-rc.118") throw Error("Unexpected package identity/dependency")
async function hashes(dir, prefix = "") {
  const result = {}
  for (const item of await readdir(dir, { withFileTypes: true })) {
    if (item.isDirectory()) Object.assign(result, await hashes(join(dir, item.name), `${prefix}${item.name}/`))
    else result[`${prefix}${item.name}`] = sha(await readFile(join(dir, item.name)))
  }
  return result
}
// Catch accidentally packing a previous build or different recipe revision.
const packedDist = await hashes(join(installed, "dist")), currentDist = await hashes(join(root, "dist"))
if (JSON.stringify(packedDist) !== JSON.stringify(currentDist)) throw Error("Packed dist differs from current build")
const exampleNames = ["snapshot-export.ts", "wallet-selector-observation.ts", "wallet-account.tsx", "wallet-query.tsx"]
const packedExamples = {}
await mkdir(join(work, "examples"), { recursive: true })
for (const name of exampleNames) {
  const bytes = await readFile(join(installed, "examples", name))
  if (sha(bytes) !== sha(await readFile(join(root, "examples", name)))) throw Error(`Packed example differs: ${name}`)
  packedExamples[name] = sha(bytes)
  const compiled = await transform(bytes.toString(), { loader: name.endsWith("tsx") ? "tsx" : "ts", format: "esm", target: "es2022", jsx: "automatic", sourcefile: name })
  await writeFile(join(work, "examples", name.replace(/\.tsx?$/, ".js")), compiled.code)
}
await cp(join(here, "consumers"), join(work, "consumers"), { recursive: true })
await mkdir(join(work, "entries"), { recursive: true })
const entries = {
  "candidate-wallet-react": 'export { WalletAccount, readWalletAccount } from "../examples/wallet-account.js"; export { make } from "@near-kit/next";',
  "candidate-wallet-query": 'export { WalletQueryAccount, walletAccountQueryOptions } from "../examples/wallet-query.js"; export { observeWalletSelector } from "../examples/wallet-selector-observation.js"; export { make } from "@near-kit/next";',
  "candidate-file-export": 'export { exportSnapshot } from "../examples/snapshot-export.js"; export { make, fetchLayer } from "@near-kit/next"; export * as Effect from "effect/Effect";',
  "candidate-data": 'export { parseAccountId, parseHash, formatHash, parsePublicKey, formatPublicKey } from "@near-kit/next/data";',
  "candidate-units": 'export { parseNear, formatNear, parseTgas, formatTgas } from "@near-kit/next/units";',
  "candidate-operator": 'export * from "@near-kit/next/operator";',
  "effect-leaf": 'import * as Effect from "effect/Effect"; export const existingEffectWork = () => Effect.runPromise(Effect.succeed(1));',
  "effect-barrel": 'import { Effect } from "effect"; export const existingEffectWork = () => Effect.runPromise(Effect.succeed(1));',
  "effect-schema-leaf": 'import * as Effect from "effect/Effect"; import * as Schema from "effect/Schema"; const User = Schema.Struct({ id: Schema.String }); export const existingEffectWork = input => Effect.runPromise(Schema.decodeUnknownEffect(User)(input));',
  "effect-schema-barrel": 'import { Effect, Schema } from "effect"; const User = Schema.Struct({ id: Schema.String }); export const existingEffectWork = input => Effect.runPromise(Schema.decodeUnknownEffect(User)(input));',
  "candidate-wallet-react-app": 'import { createRoot } from "react-dom/client"; import { createElement } from "react"; import { WalletAccount } from "../examples/wallet-account.js"; export { make } from "@near-kit/next"; export const mount = (node, props) => { const root = createRoot(node); root.render(createElement(WalletAccount, props)); return root; };',
  "candidate-wallet-query-app": 'import { createRoot } from "react-dom/client"; import { createElement } from "react"; import { QueryClient, QueryClientProvider } from "@tanstack/react-query"; import { WalletQueryAccount } from "../examples/wallet-query.js"; export { make } from "@near-kit/next"; export const mount = (node, props) => { const root = createRoot(node); const client = new QueryClient(); root.render(createElement(QueryClientProvider, { client }, createElement(WalletQueryAccount, props))); return { root, client }; };',
  "react-app-existing": 'import { createRoot } from "react-dom/client"; import { createElement, useState, useEffect, useMemo } from "react"; const Example = ({ value }) => { const [x, setX] = useState(value); useEffect(() => setX(value), [value]); return useMemo(() => createElement("p", null, x), [x]); }; export const mount = (node, props) => { const root = createRoot(node); root.render(createElement(Example, props)); return root; };',
  "react-query-app-existing": 'import { createRoot } from "react-dom/client"; import { createElement } from "react"; import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query"; const Example = props => { const query = useQuery(props); return createElement("p", null, query.status); }; export const mount = (node, props) => { const root = createRoot(node); const client = new QueryClient(); root.render(createElement(QueryClientProvider, { client }, createElement(Example, props))); return { root, client }; };',
  "react-existing": 'import { createElement, useState, useEffect, useMemo } from "react"; export const Example = ({ value }) => { const [x, setX] = useState(value); useEffect(() => setX(value), [value]); return useMemo(() => createElement("p", null, x), [x]); };',
  "react-query-existing": 'export { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query"; export { createElement, useState, useEffect, useMemo } from "react";',
}
for (const [name, source] of Object.entries(entries)) await writeFile(join(work, "entries", `${name}.mjs`), `${source}\n`)
await writeFile(join(work, "provenance.json"), JSON.stringify({
  createdAt: new Date().toISOString(), node: process.version, sourceCommit: run("git", ["rev-parse", "HEAD"], repo).trim(), sourceStatus: run("git", ["status", "--short"], repo),
  candidatePath: tarball, candidateSha256: expected, packedDist, packedExamples, sourceHashes: await hashes(join(root, "src")),
  baselineCommit: historical.baselineCommit, baselinePackageSha256: historical.baselinePackageSha256, baselineArchiveSha256: historical.baselineArchiveSha256, baselineRuntimeCompiler: historical.baselineRuntimeCompiler,
  historicalLockSha256: historical.historicalLockSha256, registryLockSha256: historical.registryLockSha256, baselineReconstruction: historical, appLockSha256: sha(await readFile(join(root, "package-lock.json"))),
  installation: "Pinned normalized registry lock restored with npm ci --ignore-scripts --omit=optional. Exact baseline reconstructed from git archive using TypeScript 6.0.3 and verified against the measured tarball SHA; baseline and candidate extracted into node_modules without re-resolving registry dependencies. App dependencies resolve from the candidate package node_modules and its hashed lock. No historical artifact directory is required.",
  versions: { effect: "4.0.0-rc.118", nearApi: "7.3.1", browserUtil: "0.12.5", esbuild, react: "19.2.7", reactQuery: "5.104.0", walletSelectorTypesOnly: "10.1.4" },
  harnessHashes: await hashes(here),
}, null, 2) + "\n")
console.log(`Prepared exact checkpoint ${expected} in ${work}`)
