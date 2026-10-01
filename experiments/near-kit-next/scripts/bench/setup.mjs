import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const repo = resolve(packageRoot, "../..")
const work = join(packageRoot, "artifacts/bench")
const baseline = "86cf14a2a9e0c7d3acaa8e3d40b5fb4c85ef172d"
const prototype = resolve(
  process.argv[2] ??
    join(
      packageRoot,
      "artifacts/near-kit-read-experiment-0.0.0-experimental.0.tgz",
    ),
)
await mkdir(work, { recursive: true })
await mkdir(join(work, "tmp"), { recursive: true })
const env = {
  ...process.env,
  TMPDIR: join(work, "tmp"),
  npm_config_cache: join(work, "npm-cache"),
  npm_config_update_notifier: "false",
}
const run = (command, args, cwd = work) =>
  execFileSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  })
const source = (path) => run("git", ["show", `${baseline}:${path}`], repo)
const manifest = JSON.parse(source("packages/near-kit/package.json"))
// bun.lock is JSON with trailing commas; this lock has no comments.
const lock = JSON.parse(source("bun.lock").replace(/,\s*([}\]])/g, "$1"))
const direct = Object.fromEntries(
  Object.keys(manifest.dependencies).map((name) => {
    const record = lock.packages[name]
    if (!record?.[0]?.startsWith(`${name}@`))
      throw new Error(`Missing locked version for ${name}`)
    return [name, record[0].slice(name.length + 1)]
  }),
)
const archive = execFileSync(
  "git",
  [
    "archive",
    baseline,
    "packages/near-kit/src",
    "packages/near-kit/package.json",
    "packages/near-kit/tsconfig.json",
    "tsconfig.json",
  ],
  { cwd: repo, maxBuffer: 32 * 1024 * 1024 },
)
await writeFile(join(work, "baseline.tar"), archive)
const baselineRepo = join(work, "baseline")
await mkdir(baselineRepo, { recursive: true })
run("tar", ["-xf", join(work, "baseline.tar"), "-C", baselineRepo])
await writeFile(
  join(work, "package.json"),
  `${JSON.stringify(
    {
      name: "near-read-measurement-consumer",
      private: true,
      type: "module",
      dependencies: {
        ...direct,
        "@types/bun": "1.3.14",
        typescript: "6.0.3",
        effect: "4.0.0-rc.118",
        "near-api-js": "7.3.1",
        util: "0.12.5",
        "@near-kit/read-experiment": `file:${prototype}`,
      },
    },
    null,
    2,
  )}\n`,
)
process.stdout.write(
  run("npm", [
    "install",
    "--ignore-scripts",
    "--omit=optional",
    "--no-audit",
    "--no-fund",
  ]),
)
// Original compiler/options, runtime-only emit. Typechecking the unchanged full
// SDK (including optional wallet integrations) is not part of this read benchmark.
run(process.execPath, [
  join(work, "node_modules/typescript/bin/tsc"),
  "-p",
  join(baselineRepo, "packages/near-kit/tsconfig.json"),
  "--noCheck",
  "--composite",
  "false",
  "--declaration",
  "false",
  "--declarationMap",
  "false",
])
const packed = JSON.parse(
  run(
    "npm",
    ["pack", "--ignore-scripts", "--json", "--pack-destination", work],
    join(baselineRepo, "packages/near-kit"),
  ),
)[0]
process.stdout.write(
  run("npm", [
    "install",
    "--ignore-scripts",
    "--omit=optional",
    "--no-audit",
    "--no-fund",
    `./${packed.filename}`,
  ]),
)
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex")
await writeFile(
  join(work, "provenance.json"),
  `${JSON.stringify(
    {
      baselineCommit: baseline,
      baselineArchiveSha256: digest(archive),
      baselineRuntimeCompiler:
        "typescript@6.0.3 --noCheck (unchanged source, original target/module options)",
      baselineDirectVersionsFromLock: direct,
      baselinePackage: packed.filename,
      baselinePackageSha256: digest(
        await readFile(join(work, packed.filename)),
      ),
      prototypePath: prototype,
      prototypeSha256: digest(await readFile(prototype)),
      installedLockSha256: digest(
        await readFile(join(work, "package-lock.json")),
      ),
      nearApiJs: "7.3.1",
      nearApiBrowserPolyfill:
        "util@0.12.5 (required by generate-function through is-my-json-valid)",
      effect: "4.0.0-rc.118",
      node: process.version,
      createdAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
)
console.log(`Prepared isolated read-only consumers in ${work}`)
