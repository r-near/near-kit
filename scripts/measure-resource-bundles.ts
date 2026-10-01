/** Built-package fixtures only: bundle code without executing SDK operations. */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { gzipSync } from "node:zlib"

const root = fileURLToPath(new URL("../", import.meta.url))
await mkdir(`${root}.cache`, { recursive: true })
const directory = await mkdtemp(`${root}.cache/resource-bundles-`)
const fixtures = {
  promiseRead:
    'import { Near } from "near-kit"; export const read = (id) => new Near({network:"testnet"}).getBalance(id);',
  nativeRead:
    'import { make } from "near-kit/effect"; import * as Effect from "effect/Effect"; export const read = (id) => make({network:"testnet"}).pipe(Effect.flatMap(near => near.getBalance(id)));',
  reactRead:
    'import { createElement } from "react"; import { NearProvider, useAccount, useBalance } from "@near-kit/react"; const State = () => JSON.stringify({account:useAccount().accountId,balance:useBalance({accountId:"test.near"}).data}); export const read = () => createElement(NearProvider,{config:{network:"testnet"}},createElement(State));',
  sandbox: 'export { Sandbox } from "near-kit/sandbox";',
}

try {
  const metrics: Record<
    string,
    { bytes: number; gzip: number; sha256: string }
  > = {}
  for (const [name, source] of Object.entries(fixtures)) {
    const entry = `${directory}/${name}.ts`
    await writeFile(entry, source)
    const build = await Bun.build({
      entrypoints: [entry],
      target: name === "sandbox" ? "node" : "browser",
      format: "esm",
      minify: true,
    })
    if (!build.success) throw new AggregateError(build.logs, "Bundle failed")
    const output = build.outputs[0]
    if (!output) throw new Error("Bundle produced no output")
    const bytes = new Uint8Array(await output.arrayBuffer())
    metrics[name] = {
      bytes: bytes.length,
      gzip: gzipSync(bytes, { level: 9 }).length,
      sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
    }
  }
  console.log(JSON.stringify(metrics, null, 2))
} finally {
  await rm(directory, { recursive: true, force: true })
}
