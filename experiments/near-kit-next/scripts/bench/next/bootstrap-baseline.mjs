// Reconstructs the measured public baseline from Git plus pinned registry bytes.
// No historical artifact directory or prebuilt SDK tarball is an input.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(here, "../../.."),
  repository = resolve(packageRoot, "../..")
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex")
export async function bootstrapBaseline(destination) {
  const work = resolve(destination)
  const expected = JSON.parse(
    await readFile(join(here, "baseline.json"), "utf8"),
  )
  const registryLock = await readFile(join(here, "registry/package-lock.json"))
  const registryManifest = await readFile(join(here, "registry/package.json"))
  assert.equal(
    sha(registryLock),
    expected.registryLockSha256,
    "Registry lock changed",
  )
  assert.equal(
    sha(registryManifest),
    expected.registryManifestSha256,
    "Registry manifest changed",
  )
  // A previous explicit bootstrap may be reused only after its artifact, lock,
  // manifest and installed registry versions are rechecked. Unrecognized trees
  // are refused; npm ci never removes another run's packages.
  let existing = false
  try {
    await stat(join(work, "node_modules"))
    existing = true
  } catch (error) {
    if (error.code !== "ENOENT") throw error
  }
  if (existing) {
    const proof = JSON.parse(
      await readFile(join(work, "baseline-reconstruction.json"), "utf8"),
    )
    for (const key of [
      "baselineCommit",
      "baselineArchiveSha256",
      "baselinePackageSha256",
      "registryLockSha256",
      "registryManifestSha256",
    ])
      assert.equal(proof[key], expected[key])
    assert.equal(
      sha(await readFile(join(work, "package-lock.json"))),
      expected.registryLockSha256,
    )
    assert.equal(
      sha(await readFile(join(work, "package.json"))),
      expected.registryManifestSha256,
    )
    assert.equal(
      sha(await readFile(join(work, expected.baselinePackage))),
      expected.baselinePackageSha256,
    )
    for (const [path, pkg] of Object.entries(
      JSON.parse(registryLock).packages,
    )) {
      if (!path) continue
      try {
        assert.equal(
          JSON.parse(await readFile(join(work, path, "package.json"), "utf8"))
            .version,
          pkg.version,
        )
      } catch (error) {
        if (!(error.code === "ENOENT" && pkg.optional === true)) throw error
      }
    }
    return proof
  }
  await mkdir(work, { recursive: true })
  const run = (command, args, cwd = work) =>
    execFileSync(command, args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      env: {
        ...process.env,
        npm_config_cache:
          process.env.BENCH_NPM_CACHE ?? "/tmp/near-bench-next-cache",
        npm_config_update_notifier: "false",
      },
    })
  // Fails explicitly on shallow checkouts without the pinned commit. Fetch that
  // public commit through the checkout's authorized origin before retrying.
  run(
    "git",
    ["cat-file", "-e", `${expected.baselineCommit}^{commit}`],
    repository,
  )
  const archive = execFileSync(
    "git",
    [
      "archive",
      expected.baselineCommit,
      "packages/near-kit/src",
      "packages/near-kit/package.json",
      "packages/near-kit/tsconfig.json",
      "tsconfig.json",
    ],
    { cwd: repository, maxBuffer: 32 * 1024 * 1024 },
  )
  assert.equal(
    sha(archive),
    expected.baselineArchiveSha256,
    "Baseline source archive mismatch",
  )
  await writeFile(join(work, "baseline.tar"), archive)
  const source = join(work, "baseline")
  await mkdir(source, { recursive: true })
  run("tar", ["-xf", join(work, "baseline.tar"), "-C", source])
  await writeFile(join(work, "package.json"), registryManifest)
  await writeFile(join(work, "package-lock.json"), registryLock)
  process.stdout.write(
    run("npm", [
      "ci",
      "--ignore-scripts",
      "--omit=optional",
      "--no-audit",
      "--no-fund",
    ]),
  )
  assert.equal(
    sha(await readFile(join(work, "package-lock.json"))),
    expected.registryLockSha256,
    "npm ci changed the registry lock",
  )
  const compiler = JSON.parse(
    await readFile(join(work, "node_modules/typescript/package.json"), "utf8"),
  )
  assert.equal(compiler.version, "6.0.3")
  run(process.execPath, [
    join(work, "node_modules/typescript/bin/tsc"),
    "-p",
    join(source, "packages/near-kit/tsconfig.json"),
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
      join(source, "packages/near-kit"),
    ),
  )[0]
  assert.equal(packed.filename, expected.baselinePackage)
  const packageSha = sha(await readFile(join(work, packed.filename)))
  assert.equal(
    packageSha,
    expected.baselinePackageSha256,
    "Reconstructed baseline tarball does not match the measured binary",
  )
  // Install the verified local artifact into the standard package layout without
  // asking npm to resolve ranges again or mutate any pinned registry record.
  const installed = join(work, "node_modules/near-kit")
  await mkdir(installed, { recursive: true })
  run("tar", [
    "-xzf",
    join(work, packed.filename),
    "--strip-components=1",
    "-C",
    installed,
  ])
  assert.equal(
    sha(await readFile(join(work, "package-lock.json"))),
    expected.registryLockSha256,
  )
  const proof = {
    ...expected,
    reconstructedAt: new Date().toISOString(),
    node: process.version,
    npm: run("npm", ["--version"]).trim(),
    work,
    reconstruction:
      "Exact git archive; TypeScript 6.0.3 original config with --noCheck --composite false --declaration false --declarationMap false; npm pack --ignore-scripts; exact tarball SHA checked; standard node_modules extraction with unchanged registry lock.",
    registryPackages: Object.entries(JSON.parse(registryLock).packages).filter(
      ([path]) => path,
    ).length,
  }
  await writeFile(
    join(work, "baseline-reconstruction.json"),
    `${JSON.stringify(proof, null, 2)}\n`,
  )
  return proof
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (!process.argv[2])
    throw Error(
      "Usage: node scripts/bench/next/bootstrap-baseline.mjs FRESH_IGNORED_DIRECTORY",
    )
  console.log(JSON.stringify(await bootstrapBaseline(process.argv[2]), null, 2))
}
