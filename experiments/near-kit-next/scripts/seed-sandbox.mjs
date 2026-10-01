import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { base58 } from "@scure/base"
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
const codeHash = base58.encode(digest)
const emptyHash = base58.encode(new Uint8Array(32))
const raw = (value) => JSON.rawJSON(BigInt(value).toString())
const data = [
  [[], [0, 255, 1]],
  [[0], []],
  [[0, 0], [255]],
  [
    [0, 255],
    [128, 0],
  ],
  [[1], [0]],
  [[128], [255, 1]],
  [[255], [0, 255]],
].map(([key, value]) => ({
  key: Buffer.from(key).toString("base64"),
  value: Buffer.from(value).toString("base64"),
}))
// Fixed public bytes are identifiers, not generated keys or signing material.
const publicKey = (kind, length, fill) =>
  `${kind}:${base58.encode(new Uint8Array(length).fill(fill))}`
const keys = [
  {
    publicKey: publicKey("ed25519", 32, 1),
    nonce: "9007199254740993",
    permission: "FullAccess",
  },
  {
    publicKey: publicKey("secp256k1", 64, 2),
    nonce: "18446744073709551615",
    permission: {
      FunctionCall: {
        allowance: null,
        receiver_id: "sandbox",
        method_names: [],
      },
    },
  },
  {
    publicKey: publicKey("ed25519", 32, 3),
    nonce: "9007199254740992",
    permission: {
      FunctionCall: {
        allowance: "0",
        receiver_id: "sandbox",
        method_names: ["json", "echo"],
      },
    },
  },
  {
    publicKey: publicKey("ed25519", 32, 4),
    nonce: "0",
    permission: {
      GasKeyFullAccess: { balance: "123456789012345678901234", num_nonces: 5 },
    },
  },
  {
    publicKey: publicKey("ed25519", 32, 5),
    nonce: "0",
    permission: {
      GasKeyFunctionCall: [
        { balance: "0", num_nonces: 2 },
        { allowance: null, receiver_id: "sandbox", method_names: ["echo"] },
      ],
    },
  },
  {
    publicKey: publicKey("ml-dsa-65-hash", 32, 6),
    nonce: "0",
    permission: "FullAccess",
  },
]
const nonces = [
  "0",
  "9007199254740991",
  "9007199254740992",
  "9007199254740993",
  "18446744073709551615",
]
await mkdir("artifacts/sandbox", { recursive: true })
await writeFile("artifacts/sandbox/views.wasm", wasm)
const genesisPath = process.argv[2]
if (genesisPath) {
  // Preserve any original numeric token that a JS number could round. The
  // newly inserted nonce tokens below are constructed directly from strings.
  const genesis = JSON.parse(
    await readFile(genesisPath, "utf8"),
    (_key, value, context) =>
      typeof value === "number" && !Number.isSafeInteger(value)
        ? JSON.rawJSON(context.source)
        : value,
  )
  const root = genesis.records.find(
    (record) => record.Account?.account_id === "sandbox",
  )?.Account.account
  if (!root)
    throw new Error("Expected sandbox root account in generated genesis")
  if (
    genesis.records.some((record) => record.Contract?.account_id === "sandbox")
  )
    throw new Error("Fixture contract is already installed")
  const amount = "1000000000000000000000000"
  const accounts = [
    "fixture.sandbox",
    "empty.sandbox",
    "large.sandbox",
    "global-hash.sandbox",
    "global-publisher.sandbox",
  ]
  root.amount = (
    BigInt(root.amount) -
    BigInt(amount) * BigInt(accounts.length)
  ).toString()
  if (BigInt(root.amount) < 0n) throw new Error("Insufficient fixture balance")
  root.code_hash = codeHash
  for (const accountId of accounts) {
    const contract = accountId === "fixture.sandbox"
    const global = accountId.startsWith("global-")
    genesis.records.push({
      Account: {
        account_id: accountId,
        account: {
          amount,
          locked: "0",
          code_hash: contract ? codeHash : emptyHash,
          storage_usage: 0,
          version: global ? "V2" : "V1",
          ...(accountId === "global-hash.sandbox"
            ? { global_contract_hash: codeHash }
            : {}),
          ...(accountId === "global-publisher.sandbox"
            ? { global_contract_account_id: "publisher.sandbox" }
            : {}),
        },
      },
    })
  }
  for (const accountId of ["sandbox", "fixture.sandbox"])
    genesis.records.push({
      Contract: { account_id: accountId, code: wasm.toString("base64") },
    })
  // Seed deliberately out of order; the runtime trie, not input order, sorts.
  for (const row of [...data].reverse())
    genesis.records.push({
      Data: {
        account_id: "fixture.sandbox",
        data_key: row.key,
        value: row.value,
      },
    })
  for (let i = 0; i < 4; i++)
    genesis.records.push({
      Data: {
        account_id: "large.sandbox",
        data_key: Buffer.from([i]).toString("base64"),
        value: Buffer.alloc(30000, i).toString("base64"),
      },
    })
  for (const key of keys)
    genesis.records.push({
      AccessKey: {
        account_id: "fixture.sandbox",
        public_key: key.publicKey,
        access_key: { nonce: raw(key.nonce), permission: key.permission },
      },
    })
  for (const [index, nonce] of nonces.entries())
    genesis.records.push({
      GasKeyNonce: {
        account_id: "fixture.sandbox",
        public_key: keys[3].publicKey,
        index,
        nonce: raw(nonce),
      },
    })
  for (const [index, nonce] of ["0", "9007199254740993"].entries())
    genesis.records.push({
      GasKeyNonce: {
        account_id: "fixture.sandbox",
        public_key: keys[4].publicKey,
        index,
        nonce: raw(nonce),
      },
    })
  await writeFile(genesisPath, `${JSON.stringify(genesis, null, 2)}\n`)
  await writeFile(
    "artifacts/sandbox/fixture.json",
    `${JSON.stringify(
      {
        codeHash,
        wasmSha256: digest.toString("hex"),
        wasmBytes: wasm.byteLength,
        amount: root.amount,
        locked: root.locked,
        storageUsage: root.storage_usage,
        fixtureAmount: amount,
        data,
        keys,
        nonces,
        genesis: {
          chainId: genesis.chain_id,
          protocolVersion: genesis.protocol_version,
          genesisHeight: String(genesis.genesis_height),
          epochLength: String(genesis.epoch_length),
          totalSupply: genesis.total_supply,
        },
        caveat:
          "Gas balances are static serialization fixtures, not evidence of a funding workflow or economic consistency; global pointers do not seed the registry.",
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
