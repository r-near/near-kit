import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import wabtFactory from "wabt"

const wabt = await wabtFactory()
const source = await readFile("test/sandbox/views.wat", "utf8")
const module = wabt.parseWat("views.wat", source)
module.resolveNames()
module.validate()
const { buffer } = module.toBinary({
  canonicalize_lebs: true,
  write_debug_names: false,
})
module.destroy()
const wasm = Buffer.from(buffer)
const digest = createHash("sha256").update(wasm).digest()
const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
let value = BigInt(`0x${digest.toString("hex")}`)
let codeHash = ""
while (value > 0n) {
  codeHash = alphabet[Number(value % 58n)] + codeHash
  value /= 58n
}
for (const byte of digest) {
  if (byte !== 0) break
  codeHash = `1${codeHash}`
}
await mkdir("artifacts/sandbox", { recursive: true })
await writeFile("artifacts/sandbox/views.wasm", wasm)
const genesisPath = process.argv[2]
if (genesisPath) {
  const genesis = JSON.parse(await readFile(genesisPath, "utf8"))
  const account = genesis.records.find(
    (record) => record.Account?.account_id === "sandbox",
  )?.Account.account
  if (!account)
    throw new Error("Expected sandbox root account in generated genesis")
  if (
    genesis.records.some((record) => record.Contract?.account_id === "sandbox")
  )
    throw new Error("Fixture contract is already installed")
  account.code_hash = codeHash
  account.storage_usage += wasm.byteLength
  genesis.records.push({
    Contract: { account_id: "sandbox", code: wasm.toString("base64") },
  })
  await writeFile(genesisPath, `${JSON.stringify(genesis, null, 2)}\n`)
  await writeFile(
    "artifacts/sandbox/fixture.json",
    `${JSON.stringify(
      {
        codeHash,
        wasmSha256: digest.toString("hex"),
        wasmBytes: wasm.byteLength,
        amount: account.amount,
        locked: account.locked,
        storageUsage: account.storage_usage,
      },
      null,
      2,
    )}\n`,
  )
}
console.log(
  JSON.stringify({
    wasmBytes: wasm.byteLength,
    wasmSha256: digest.toString("hex"),
    codeHash,
  }),
)
