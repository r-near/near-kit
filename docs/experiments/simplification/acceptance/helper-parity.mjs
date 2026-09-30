import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
const [beforeRoot, afterRoot] = process.argv.slice(2)
if (!beforeRoot || !afterRoot)
  throw Error(
    "Usage: node helper-parity.mjs BASELINE_CHECKOUT CANDIDATE_CHECKOUT",
  )
const baseline = await import(
  pathToFileURL(
    resolve(beforeRoot, "packages/near-kit/dist/utils/validation.js"),
  )
)
const native = await import(
  pathToFileURL(
    resolve(afterRoot, "packages/near-kit/dist/utils/validation.js"),
  )
)
const publicSchema = await import(
  pathToFileURL(resolve(afterRoot, "packages/near-kit/dist/schemas/index.js"))
)
import { inspect, isDeepStrictEqual } from "node:util"
const primitive = [
  undefined,
  null,
  true,
  false,
  0,
  -1,
  NaN,
  Infinity,
  0n,
  -1n,
  {},
  [],
  new Uint8Array([1]),
  new String("alice.near"),
]
const account = [
  ...primitive,
  ...Array.from({ length: 71 }, (_, n) => "a".repeat(n)),
]
function words(prefix, depth) {
  account.push(prefix)
  if (depth)
    for (const c of ["a", "0", "A", "-", "_", ".", "\n"])
      words(prefix + c, depth - 1)
}
words("", 5)
account.push(
  "alice.near",
  "a.near",
  "a-b_c.near",
  "álîce.near",
  " alice.near",
  "alice.near\n",
  "🦀.near",
)
const keys = [...primitive]
for (const prefix of [
  "ed25519:",
  "secp256k1:",
  "ml-dsa-65:",
  "ml-dsa-65-hash:",
  "ed25519",
  "ED25519:",
  "unknown:",
  "",
]) {
  for (const payload of [
    "",
    "1",
    "abc",
    "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz",
    "0",
    "O",
    "I",
    "l",
    "1\n",
    "\n",
    "é",
    " ",
    "1:2",
    ...Array.from({ length: 129 }, (_, n) => "1".repeat(n)),
  ])
    keys.push(prefix + payload)
}
const units = [...primitive]
for (const number of [
  "0",
  "1",
  "0001",
  "1.5",
  "-1",
  ".",
  "..",
  "1.2.3",
  "1e2",
  "999999999999999999999999",
  "1.123456789012345678901234567890",
])
  for (const unit of [
    "NEAR",
    "near",
    "Near",
    "yocto",
    "YOCTO",
    "Tgas",
    "tgas",
    "TGAS",
    "",
    "USD",
  ])
    for (const gap of ["", " ", "  ", "\t", "\n"])
      for (const wrap of [false, true])
        units.push(
          wrap ? ` \t${number}${gap}${unit}\n ` : `${number}${gap}${unit}`,
        )
const contracts = [
  ["AccountIdSchema", "validateAccountId", account],
  ["PublicKeySchema", "validatePublicKey", keys],
  ["PrivateKeySchema", "validatePrivateKey", keys],
  ["AmountSchema", "normalizeAmount", units],
  ["GasSchema", "normalizeGas", units],
]
function run(fn, value) {
  try {
    return { ok: true, value: fn(value) }
  } catch (error) {
    return { ok: false, error: { name: error?.name, message: error?.message } }
  }
}
let cases = 0,
  accepted = 0
const differences = []
for (const [schema, helper, values] of contracts)
  for (const value of values) {
    const before = run((v) => baseline[schema].parse(v), value)
    const after = run(native[helper], value)
    const composed = run((v) => publicSchema[schema].parse(v), value)
    cases++
    if (before.ok) accepted++
    if (
      before.ok !== after.ok ||
      (before.ok && !isDeepStrictEqual(before.value, after.value)) ||
      !isDeepStrictEqual(before, composed)
    )
      differences.push({
        schema,
        value: inspect(value),
        before,
        after,
        composed,
      })
  }
for (const [name, values] of [
  ["isValidAccountId", account],
  ["isValidPublicKey", keys],
  ["isPrivateKey", keys],
])
  for (const value of values) {
    cases++
    if (baseline[name](value) !== native[name](value))
      differences.push({ name, value: inspect(value) })
  }
console.log(
  JSON.stringify(
    {
      cases,
      accepted,
      differenceCount: differences.length,
      differences: differences.slice(0, 10),
    },
    null,
    2,
  ),
)
if (differences.length) process.exitCode = 1
