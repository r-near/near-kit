import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { isAbsolute, join } from "node:path"

// Provision the runtime separately from an official, checksum-verified release.
// This script installs only the packed SDK's exact production dependencies.
const [runtime, suppliedBinary, ...extra] = process.argv.slice(2)
const versions = { deno: "2.9.7", bun: "1.4.2", node: undefined }
if (!Object.hasOwn(versions, runtime) || extra.length > 0)
  throw new Error(
    "Usage: node scripts/check-runtimes.mjs deno|bun|node [absolute-binary-path]",
  )
if (suppliedBinary && !isAbsolute(suppliedBinary))
  throw new Error("An explicit runtime binary must use an absolute path")
const binary =
  suppliedBinary ?? (runtime === "node" ? process.execPath : runtime)
const versionOutput = execFileSync(binary, ["--version"], {
  encoding: "utf8",
  timeout: 10_000,
}).trim()
const version = versionOutput.match(/(?:^|\s)v?(\d+\.\d+\.\d+)(?:\s|$)/)?.[1]
if (!version || (versions[runtime] && version !== versions[runtime]))
  throw new Error(
    `Expected ${runtime} ${versions[runtime] ?? "version"}; received ${versionOutput}`,
  )

const root = process.cwd()
const artifacts = join(root, "artifacts")
mkdirSync(artifacts, { recursive: true })
const work = mkdtempSync(join(artifacts, `runtime-${runtime}-`))
const env = {
  ...process.env,
  npm_config_cache: join(artifacts, "packed-cache"),
  DENO_DIR: join(work, "deno-cache"),
}
const digest = (file) =>
  createHash("sha256").update(readFileSync(file)).digest("hex")
const evidence = { runtime, version, passed: false }
try {
  const [packed] = JSON.parse(
    execFileSync(
      "npm",
      ["pack", "--ignore-scripts", "--pack-destination", work, "--json"],
      { cwd: root, env, encoding: "utf8", timeout: 60_000 },
    ),
  )
  const tarball = join(work, packed.filename)
  const sdk = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
  writeFileSync(
    join(work, "package.json"),
    JSON.stringify({
      name: "near-kit-runtime-consumer",
      private: true,
      type: "module",
      dependencies: {
        "@near-kit/next": `file:${tarball}`,
        effect: sdk.dependencies.effect,
      },
    }),
  )
  execFileSync(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--prefer-offline",
    ],
    { cwd: work, env, stdio: "inherit", timeout: 180_000 },
  )
  copyFileSync(
    join(root, "test/consumers/runtime.mjs"),
    join(work, "consumer.mjs"),
  )
  const lock = JSON.parse(readFileSync(join(work, "package-lock.json"), "utf8"))
  evidence.package = packed.id
  evidence.sha256 = digest(tarball)
  evidence.fixtureSha256 = digest(join(work, "consumer.mjs"))
  evidence.dependencies = Object.fromEntries(
    Object.keys(sdk.dependencies).map((name) => {
      const dependency = lock.packages[`node_modules/${name}`]
      return [
        name,
        { version: dependency.version, integrity: dependency.integrity },
      ]
    }),
  )
  const args =
    runtime === "deno"
      ? [
          "run",
          "--no-prompt",
          "--cached-only",
          "--no-config",
          "--no-lock",
          "--node-modules-dir=manual",
          "consumer.mjs",
        ]
      : ["consumer.mjs"]
  const output = execFileSync(binary, args, {
    cwd: work,
    env,
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 2 * 1024 * 1024,
  })
  console.log(output.trim())
  const report = JSON.parse(output.trim().split("\n").at(-1))
  if (
    report.runtime !== runtime ||
    report.version !== version ||
    report.status !== "passed"
  )
    throw new Error(`Unexpected runtime result: ${output}`)
  evidence.consumer = report
  evidence.passed = true
} catch (error) {
  evidence.error = String(error)
  if (error.stdout) evidence.stdout = String(error.stdout)
  if (error.stderr) evidence.stderr = String(error.stderr)
  throw error
} finally {
  writeFileSync(
    join(artifacts, `runtime-${runtime}.json`),
    `${JSON.stringify(evidence, null, 2)}\n`,
  )
  rmSync(work, { recursive: true, force: true })
}
