import * as Near from "@near-kit/next"
import * as Data from "@near-kit/next/data"
import * as Units from "@near-kit/next/units"
import * as Effect from "effect/Effect"
import * as FetchHttpClient from "effect/http/FetchHttpClient"

const hash = "11111111111111111111111111111111"
const client = Near.make({ url: "https://fixture.invalid" })
const u64 = "18446744073709551615"
const account = `{"amount":"340282366920938463463374607431768211455","locked":"0","storage_usage":${u64},"code_hash":"${hash}","block_height":${u64},"block_hash":"${hash}"}`
const assert = (value: boolean, message: string) => {
  if (!value) throw new Error(message)
}
export async function platformChecks() {
  let requests = 0
  let body = ""
  let extension = ""
  let transportDiagnostic = ""
  const fetch: typeof globalThis.fetch = async (_input, init) => {
    requests++
    body = String(init?.body)
    try {
      const request = JSON.parse(body) as { id: unknown }
      return new Response(
        `{"jsonrpc":"2.0","id":${JSON.stringify(request.id)},"result":${account}${extension}}`,
      )
    } catch (error) {
      transportDiagnostic = String(error)
      throw error
    }
  }
  const provide = <A, E>(
    value: Effect.Effect<A, E, import("effect/http/HttpClient").HttpClient>,
  ) =>
    value.pipe(
      Effect.provide(Near.fetchLayer),
      Effect.provideService(FetchHttpClient.Fetch, fetch),
    )
  const exact = await Effect.runPromise(
    provide(Near.account(client, "fixture", { at: { height: BigInt(u64) } })),
  ).catch((error) => {
    throw new Error(
      `Platform fixture transport: requests=${requests}, diagnostic=${transportDiagnostic}, body=${body.slice(0, 120)}, error=${String(error)}`,
    )
  })
  assert(exact.blockHeight === BigInt(u64), "Rounded height")
  assert(exact.storageUsage === BigInt(u64), "Rounded storage usage")
  assert(body.includes(`"block_id":${u64}`), "Rounded request height")
  assert(
    Units.formatNear(Units.parseNear("1.000000000000000000000001")) ===
      "1.000000000000000000000001",
    "Units round trip",
  )
  assert(Data.formatHash(Data.parseHash(hash)) === hash, "Hash round trip")

  const json = JSON as unknown as Record<string, unknown>
  const originalParse = JSON.parse
  let unsupported = 0
  for (const feature of ["rawJSON", "isRawJSON", "parse"]) {
    const descriptor = Object.getOwnPropertyDescriptor(JSON, feature)
    const before = requests
    Object.defineProperty(JSON, feature, {
      configurable: true,
      writable: true,
      value:
        feature === "parse"
          ? (
              text: string,
              reviver?: (key: string, value: unknown) => unknown,
            ) =>
              originalParse(
                text,
                reviver && ((key, value) => reviver(key, value)),
              )
          : undefined,
    })
    try {
      const error = await Effect.runPromise(
        provide(Near.account(client, "fixture").pipe(Effect.flip)),
      )
      assert(
        error._tag === "UnsupportedError" && error.feature === "LosslessJson",
        `Missing capability ${feature} was not rejected`,
      )
      assert(requests === before, `Missing ${feature} performed I/O`)
      unsupported++
    } finally {
      if (descriptor) Object.defineProperty(JSON, feature, descriptor)
      else delete json[feature]
    }
  }
  // Exercise the actual engine's native reviver recursion failure. Unknown
  // extensions still pass through the parser, although no field is retained.
  extension = `,"extension":${"[".repeat(30000)}0${"]".repeat(30000)}`
  const deep = await Effect.runPromise(
    provide(Near.account(client, "fixture").pipe(Effect.flip)),
  )
  assert(
    deep._tag === "DecodeError" && deep.reason === "JsonResource",
    "Native recursion failure escaped the expected error channel",
  )
  return {
    height: exact.blockHeight.toString(),
    storage: exact.storageUsage.toString(),
    amount: exact.amount.toString(),
    unsupported,
    depth: deep._tag === "DecodeError" ? deep.reason : deep._tag,
  }
}
