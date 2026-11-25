// Executed as unbundled ESM against an npm-packed SDK, without Node imports,
// transpilation, network access, credentials, wallets or JSON polyfills.
import * as Data from "@near-kit/next/data"
import * as Units from "@near-kit/next/units"

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}
const runtime =
  "Deno" in globalThis ? "deno" : "Bun" in globalThis ? "bun" : "node"
const version =
  runtime === "deno"
    ? globalThis.Deno.version.deno
    : runtime === "bun"
      ? globalThis.Bun.version
      : globalThis.process.versions.node
const hash = "11111111111111111111111111111111"
const u64 = "18446744073709551615"
const u128 = "340282366920938463463374607431768211455"
function pureChecks() {
  assert(
    Data.parseAccountId("fixture.near") === "fixture.near",
    "Account ID parsing",
  )
  assert(!Data.isAccountId("fixture..near"), "Invalid account ID accepted")
  assert(Data.formatHash(Data.parseHash(hash)) === hash, "Hash round trip")
  const publicKey = `ed25519:${hash}`
  assert(
    Data.formatPublicKey(Data.parsePublicKey(publicKey)) === publicKey,
    "Public key encoding round trip",
  )
  assert(
    Units.formatNear(Units.parseNear("1.000000000000000000000001")) ===
      "1.000000000000000000000001",
    "Exact NEAR units",
  )
  assert(
    Units.parseNear(Units.formatNear(BigInt(u128))) === BigInt(u128),
    "u128 units round trip",
  )
  assert(
    Units.parseTgas(Units.formatTgas(BigInt(u64))) === BigInt(u64),
    "u64 gas round trip",
  )
}
pureChecks()

const Near = await import("@near-kit/next")
const Effect = await import("effect/Effect")
const Exit = await import("effect/Exit")
const Cause = await import("effect/Cause")
const Schema = await import("effect/Schema")
const FetchHttpClient = await import("effect/http/FetchHttpClient")
let source
JSON.parse("9007199254740993", (_key, value, context) => {
  source = context?.source
  return value
})
const raw = JSON.rawJSON?.("9007199254740993")
const capabilities = {
  source: source === "9007199254740993",
  rawJSON: JSON.stringify(raw) === "9007199254740993",
  isRawJSON: JSON.isRawJSON?.(raw) === true,
}
const client = Near.make({ url: "https://fixture.invalid" })
let requests = 0
let body = ""
let response = "account"
const fetch = async (_url, init) => {
  requests++
  // A real Fetch body can be Uint8Array; never rely on Buffer.toString().
  body = await new Response(init.body).text()
  assert(init.redirect === "error", "Redirect boundary changed")
  const request = JSON.parse(body)
  assert(request.method === "query", "Unexpected RPC method")
  let result
  if (response === "view") {
    assert(request.params.request_type === "call_function", "View request type")
    assert(
      new TextDecoder().decode(
        Uint8Array.from(atob(request.params.args_base64), (character) =>
          character.charCodeAt(0),
        ),
      ) === '{"message":"雪"}',
      "UTF-8 view arguments",
    )
    result = `{"result":${JSON.stringify([...new TextEncoder().encode('{"count":7,"message":"雪"}')])},"logs":[],"block_height":${u64},"block_hash":"${hash}"}`
  } else {
    assert(
      request.params.request_type === "view_account",
      "Account request type",
    )
    result = `{"amount":"${u128}","locked":"0","storage_usage":${u64},"code_hash":"${hash}","block_height":${u64},"block_hash":"${hash}"}`
  }
  if (response === "invalid-utf8") return new Response(new Uint8Array([0xff]))
  const extension =
    response === "deep"
      ? `,"extension":${"[".repeat(30000)}0${"]".repeat(30000)}`
      : ""
  return new Response(
    `{"jsonrpc":"2.0","id":${JSON.stringify(request.id)},"result":${result}${extension}}`,
  )
}
const provide = (effect, transport = fetch) =>
  effect.pipe(
    Effect.provide(Near.fetchLayer),
    Effect.provideService(FetchHttpClient.Fetch, transport),
  )
const failure = (effect) => Effect.runPromise(provide(effect.pipe(Effect.flip)))
if (!Object.values(capabilities).every(Boolean)) {
  const error = await failure(Near.account(client, "fixture"))
  assert(
    error._tag === "UnsupportedError" && error.feature === "LosslessJson",
    "Missing native JSON was not rejected",
  )
  assert(requests === 0, "Unsupported runtime performed I/O")
  console.log(
    JSON.stringify({
      runtime,
      version,
      capabilities,
      pure: true,
      status: "unsupported",
    }),
  )
  throw new Error(
    "This runtime does not satisfy near-kit's native lossless JSON contract",
  )
}

const account = await Effect.runPromise(
  provide(Near.account(client, "fixture", { at: { height: BigInt(u64) } })),
)
assert(account.amount === BigInt(u128), "Rounded u128 balance")
assert(
  account.blockHeight === BigInt(u64) && account.storageUsage === BigInt(u64),
  "Rounded u64 metadata",
)
assert(body.includes(`"block_id":${u64}`), "Rounded outgoing block height")
response = "view"
const view = await Effect.runPromise(
  provide(
    Near.view(client, {
      accountId: "fixture",
      method: "read",
      args: { message: "雪" },
      schema: Schema.Struct({ count: Schema.Number, message: Schema.String }),
    }),
  ),
)
assert(
  view.value.count === 7 && view.value.message === "雪",
  "Schema-backed UTF-8 view",
)

response = "invalid-utf8"
const invalid = await failure(Near.account(client, "fixture"))
assert(
  invalid._tag === "DecodeError" && invalid.reason === "InvalidUtf8",
  "Invalid UTF-8 escaped typed failure",
)
response = "deep"
const deep = await failure(Near.account(client, "fixture"))
assert(
  deep._tag === "DecodeError" && deep.reason === "JsonResource",
  "Native JSON recursion escaped typed failure",
)

let unsupported = 0
const originalParse = JSON.parse
for (const feature of ["rawJSON", "isRawJSON", "parse"]) {
  const descriptor = Object.getOwnPropertyDescriptor(JSON, feature)
  const before = requests
  Object.defineProperty(JSON, feature, {
    configurable: true,
    writable: true,
    value:
      feature === "parse"
        ? (text, reviver) =>
            originalParse(
              text,
              reviver && ((key, value) => reviver(key, value)),
            )
        : undefined,
  })
  try {
    pureChecks()
    const error = await failure(Near.account(client, "fixture"))
    assert(
      error._tag === "UnsupportedError" && error.feature === "LosslessJson",
      `Missing ${feature} was not rejected`,
    )
    assert(requests === before, `Missing ${feature} performed I/O`)
    unsupported++
  } finally {
    if (descriptor) Object.defineProperty(JSON, feature, descriptor)
    else delete JSON[feature]
  }
}

let signal
let bodyCancelled = false
let beginRead
const reading = new Promise((resolve) => {
  beginRead = resolve
})
const blockingFetch = async (_url, init) => {
  signal = init.signal
  return new Response(
    new ReadableStream(
      {
        pull() {
          beginRead()
        },
        cancel() {
          bodyCancelled = true
        },
      },
      { highWaterMark: 0 },
    ),
  )
}
const controller = new AbortController()
const pending = Effect.runPromiseExit(
  provide(Near.account(client, "fixture"), blockingFetch),
  { signal: controller.signal },
)
await reading
controller.abort()
const exit = await pending
assert(
  Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause),
  "Cancellation was not an Effect interruption",
)
assert(
  signal.aborted && bodyCancelled,
  "Cancellation did not release Fetch body and signal",
)
console.log(
  JSON.stringify({
    runtime,
    version,
    capabilities,
    pure: true,
    account: {
      amount: account.amount.toString(),
      height: account.blockHeight.toString(),
      storage: account.storageUsage.toString(),
    },
    schemaView: true,
    invalidUtf8: invalid.reason,
    nativeRecursion: deep.reason,
    unsupported,
    bodyCancelled,
    status: "passed",
  }),
)
