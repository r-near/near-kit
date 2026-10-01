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
import { join, resolve } from "node:path"
import { build } from "esbuild"

const root = process.cwd()
mkdirSync(join(root, "artifacts"), { recursive: true })
const work = mkdtempSync(join(root, "artifacts/consumer-"))
const env = {
  ...process.env,
  npm_config_cache: join(root, "artifacts/packed-cache"),
}
try {
  const packed = JSON.parse(
    execFileSync("npm", ["pack", "--pack-destination", work, "--json"], {
      cwd: root,
      env,
      encoding: "utf8",
    }),
  )
  const tarball = join(work, packed[0].filename)
  writeFileSync(
    join(work, "package.json"),
    JSON.stringify({
      name: "read-consumer-check",
      private: true,
      type: "module",
      dependencies: {
        "@near-kit/next": `file:${tarball}`,
        effect: "4.0.0-rc.118",
        "@near-wallet-selector/core": "10.1.4",
        "@near-js/types": "2.5.1",
        "@tanstack/react-query": "5.104.0",
        react: "19.2.7",
        "react-dom": "19.2.7",
        "@types/node": "24.19.0",
        "@types/react": "19.2.17",
        "@types/react-dom": "19.2.3",
      },
    }),
  )
  execFileSync(
    "npm",
    ["install", "--ignore-scripts", "--no-audit", "--no-fund"],
    { cwd: work, env, stdio: "inherit" },
  )
  copyFileSync(
    join(root, "test/consumers/browser.mts"),
    join(work, "consumer.mts"),
  )
  copyFileSync(
    join(root, "test/consumers/platform.ts"),
    join(work, "platform.ts"),
  )
  writeFileSync(
    join(work, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        lib: ["ES2022", "DOM", "DOM.Iterable", "ESNext.Disposable"],
        types: [],
        skipLibCheck: false,
        outDir: "out",
      },
      include: ["consumer.mts", "platform.ts"],
    }),
  )
  execFileSync(
    process.execPath,
    [resolve(root, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.json"],
    { cwd: work, stdio: "inherit" },
  )
  execFileSync(process.execPath, ["out/consumer.mjs"], {
    cwd: work,
    stdio: "inherit",
  })
  const examples = join(work, "node_modules/@near-kit/next/examples")
  for (const file of [
    "wallet-selector-observation.ts",
    "wallet-account.tsx",
    "wallet-query.tsx",
  ])
    copyFileSync(join(examples, file), join(work, file))
  copyFileSync(
    join(root, "test/consumers/wallet.mts"),
    join(work, "wallet-consumer.mts"),
  )
  const optionalConfig = JSON.parse(
    readFileSync(join(examples, "tsconfig.wallet.json"), "utf8"),
  )
  optionalConfig.compilerOptions.noEmit = false
  optionalConfig.compilerOptions.outDir = "wallet-out"
  optionalConfig.include.push("wallet-consumer.mts")
  writeFileSync(
    join(work, "tsconfig.wallet.json"),
    JSON.stringify(optionalConfig),
  )
  execFileSync(
    process.execPath,
    [
      resolve(root, "node_modules/typescript/bin/tsc"),
      "-p",
      "tsconfig.wallet.json",
    ],
    { cwd: work, stdio: "inherit" },
  )
  execFileSync(process.execPath, ["wallet-out/wallet-consumer.mjs"], {
    cwd: work,
    stdio: "inherit",
  })
  for (const file of [
    "ssr-account.tsx",
    "ssr-account-server.tsx",
    "ssr-account-client.tsx",
  ])
    copyFileSync(join(examples, file), join(work, file))
  copyFileSync(
    join(root, "test/consumers/ssr.mts"),
    join(work, "ssr-consumer.mts"),
  )
  const ssrCompilerOptions = {
    target: "ES2022",
    module: "NodeNext",
    moduleResolution: "NodeNext",
    jsx: "react-jsx",
    strict: true,
    skipLibCheck: false,
    lib: ["ES2022", "DOM", "DOM.Iterable", "ESNext.Disposable"],
    types: [],
    outDir: "ssr-out",
  }
  writeFileSync(
    join(work, "tsconfig.ssr.json"),
    JSON.stringify({
      compilerOptions: ssrCompilerOptions,
      include: [
        "ssr-account.tsx",
        "ssr-account-server.tsx",
        "ssr-account-client.tsx",
        "ssr-consumer.mts",
      ],
    }),
  )
  execFileSync(
    process.execPath,
    [
      resolve(root, "node_modules/typescript/bin/tsc"),
      "-p",
      "tsconfig.ssr.json",
    ],
    { cwd: work, stdio: "inherit" },
  )
  execFileSync(process.execPath, ["ssr-out/ssr-consumer.mjs"], {
    cwd: work,
    stdio: "inherit",
  })
  const pureBundles = {}
  for (const subpath of ["data", "units", "address", "nep413"]) {
    const bundled = await build({
      stdin: {
        contents: `export * from "@near-kit/next/${subpath}"`,
        resolveDir: work,
      },
      bundle: true,
      format: "esm",
      platform: "browser",
      target: "es2022",
      minify: true,
      write: false,
      metafile: true,
    })
    const inputs = Object.keys(bundled.metafile.inputs)
    if (
      inputs.some(
        (file) => file.includes("/effect/") || file.includes("/internal/wire"),
      )
    )
      throw new Error(`Pure ${subpath} imports the network/Effect runtime`)
    pureBundles[subpath] = {
      bytes: bundled.outputFiles[0].contents.byteLength,
      inputs,
    }
  }
  const evidence = {
    pureBundles,
    node: process.version,
    sha256: createHash("sha256").update(readFileSync(tarball)).digest("hex"),
    package: packed[0].id,
    browserOnlyTypes: true,
    optionalWalletTypesAndSsr: true,
    requestScopedSsr: true,
    runtime: true,
  }
  mkdirSync(join(root, "artifacts"), { recursive: true })
  writeFileSync(
    join(root, "artifacts/packed-consumer.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
  )
  console.log(JSON.stringify(evidence))
} finally {
  rmSync(work, { recursive: true, force: true })
}
