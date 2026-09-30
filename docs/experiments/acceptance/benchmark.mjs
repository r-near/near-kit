import { performance } from "node:perf_hooks"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
const root = resolve(process.argv[2] ?? ".")
const before = performance.now()
const mod = await import(
  pathToFileURL(`${root}/packages/near-kit/dist/index.js`).href
)
const importMs = performance.now() - before
const fixedKey =
  "ed25519:3D4YudUahN1nawWogh8pAKSj92sUNMdbZGjn7kERKzYoTy8oryFtvLGoBnu1J6N4qVWY9jXwfLiNWnaTzKkHNfqG"
let calls = 0
globalThis.fetch = async () => {
  calls++
  return Response.json({
    jsonrpc: "2.0",
    id: 1,
    result: {
      result: [49, 50, 51],
      logs: [],
      block_height: 1,
      block_hash: "hash",
    },
  })
}
const near = new mod.Near({ network: "testnet" })
for (let i = 0; i < 100; i++) await near.view("counter.testnet", "read")
let start = performance.now()
for (let i = 0; i < 2000; i++)
  if ((await near.view("counter.testnet", "read")) !== 123)
    throw Error("bad view result")
const viewMs = performance.now() - start
start = performance.now()
for (let i = 0; i < 2000; i++) new mod.Near({ network: "testnet" })
const constructMs = performance.now() - start
const store = new mod.InMemoryKeyStore({ "alice.near": fixedKey })
const rpc = {
  getBlock: async () => ({
    header: { hash: "11111111111111111111111111111111" },
  }),
}
async function sign() {
  const tx = new mod.TransactionBuilder("alice.near", rpc, store)
    .nonce(42n)
    .transfer("bob.near", "1 NEAR")
  await tx.sign()
  if (tx.getHash() !== "14p5Cg5kU2xFUs5KnkhKhJh6sUo4XtsmRvaf6DKcbsQb")
    throw Error("wire changed")
}
for (let i = 0; i < 20; i++) await sign()
start = performance.now()
for (let i = 0; i < 200; i++) await sign()
const signMs = performance.now() - start
console.log(
  JSON.stringify({
    root,
    importMs,
    viewCount: 2000,
    viewMs,
    constructCount: 2000,
    constructMs,
    signCount: 200,
    signMs,
    calls,
  }),
)
