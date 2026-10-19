import { it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { expect } from "vitest"
import * as Near from "../src/index.js"
import { accountWire, HASH, harness, viewWire } from "./fixtures.js"

const client = Near.make({ url: "https://example.test" })
const body = (id: unknown, amount: string, height: string, storage = height) =>
  `{"jsonrpc":"2.0","id":${JSON.stringify(id)},"result":{"amount":${JSON.stringify(amount)},"locked":"0","storage_usage":${storage},"code_hash":"11111111111111111111111111111111","block_height":${height},"block_hash":"${HASH}"}}`
const integers = [
  "0",
  "9007199254740991",
  "9007199254740992",
  "9007199254740993",
  "18446744073709551615",
]
for (const integer of integers) {
  it.effect(
    `preserves raw u64 ${integer} and serializes an exact explicit height`,
    () =>
      Effect.gen(function* () {
        const h = harness(
          (request) =>
            new Response(
              body(
                request.id,
                "340282366920938463463374607431768211455",
                integer,
              ),
            ),
        )
        const result = yield* h.provide(
          Near.account(client, "alice.testnet", {
            at: { height: BigInt(integer) },
          }),
        )
        expect(result.blockHeight).toBe(BigInt(integer))
        expect(result.storageUsage).toBe(BigInt(integer))
        expect(result.amount).toBe((1n << 128n) - 1n)
        expect(String(h.requests[0]?.init.body)).toContain(
          `"block_id":${integer}`,
        )
      }),
  )
}
for (const integer of [
  "-1",
  "-0",
  "1.0",
  "1e0",
  "1e-500",
  "18446744073709551616",
  '"1"',
]) {
  it.effect(`rejects noncanonical/out-of-domain u64 token ${integer}`, () =>
    Effect.gen(function* () {
      const h = harness(
        (request) => new Response(body(request.id, "1", integer)),
      )
      expect(
        yield* h
          .provide(Near.account(client, "alice.testnet"))
          .pipe(Effect.flip),
      ).toMatchObject({ _tag: "DecodeError", reason: "InvalidResponse" })
    }),
  )
}
for (const amount of [
  "1\n",
  "1\r",
  "1\u2028",
  "1\u2029",
  " 1",
  "1 ",
  "+1",
  "01",
]) {
  it.effect(
    `rejects noncanonical decimal string ${JSON.stringify(amount)}`,
    () =>
      Effect.gen(function* () {
        const h = harness(
          (request) => new Response(body(request.id, amount, "0")),
        )
        expect(
          (yield* h
            .provide(Near.account(client, "alice.testnet"))
            .pipe(Effect.flip))._tag,
        ).toBe("DecodeError")
      }),
  )
}
it.effect(
  "ignores numeric extensions without allocating a giant bigint and keeps native duplicate-member semantics",
  () =>
    Effect.gen(function* () {
      const h = harness(
        (request) =>
          new Response(
            `{"jsonrpc":"2.0","id":${JSON.stringify(request.id)},"extension":[1.5,1e-500,${"9".repeat(10000)}],"result":{"amount":"2","amount":"3","locked":"0","storage_usage":0,"code_hash":"11111111111111111111111111111111","block_height":0,"block_hash":"${HASH}"}}`,
          ),
      )
      expect(
        (yield* h.provide(Near.account(client, "alice.testnet"))).amount,
      ).toBe(3n)
    }),
)
it.effect(
  "classifies deep native revival without retaining parser diagnostics",
  () =>
    Effect.gen(function* () {
      const nested = `${"[".repeat(20000)}0${"]".repeat(20000)}`
      const h = harness(
        (request) =>
          new Response(
            `{"jsonrpc":"2.0","id":${JSON.stringify(request.id)},"extra":${nested},"result":${JSON.stringify(accountWire)}}`,
          ),
      )
      const failure = yield* h
        .provide(Near.account(client, "alice.testnet"))
        .pipe(Effect.flip)
      expect(failure).toMatchObject({
        _tag: "DecodeError",
        reason: "JsonResource",
      })
      expect(JSON.stringify(failure)).not.toContain("recursion")
    }),
)
it.effect(
  "leaves arbitrary contract JSON numbers under ordinary JavaScript semantics",
  () =>
    Effect.gen(function* () {
      const h = harness(() =>
        viewWire(new TextEncoder().encode('{"value":9007199254740993}')),
      )
      const result = yield* h.provide(
        Near.view(client, {
          accountId: "contract.testnet",
          method: "read",
          schema: Schema.Struct({ value: Schema.Number }),
        }),
      )
      expect(result.value.value).toBe(9007199254740992)
      expect(typeof result.value.value).toBe("number")
    }),
)
it.effect(
  "rejects native RawJSON arguments recursively but permits ordinary rawJSON-named data",
  () =>
    Effect.gen(function* () {
      const raw = (
        JSON as typeof JSON & { rawJSON: (text: string) => unknown }
      ).rawJSON("123")
      for (const args of [raw, { nested: raw }, { array: [raw] }]) {
        const h = harness()
        const result = yield* h
          .provide(
            Near.viewBytes(client, {
              accountId: "contract.testnet",
              method: "read",
              args: args as Near.JsonObject,
            }),
          )
          .pipe(Effect.flip)
        expect(result).toMatchObject({
          _tag: "RequestError",
          reason: "Arguments",
        })
        expect(h.requests).toHaveLength(0)
      }
      const h = harness(() => viewWire())
      yield* h.provide(
        Near.viewBytes(client, {
          accountId: "contract.testnet",
          method: "read",
          args: { rawJSON: "123" },
        }),
      )
      expect(
        Buffer.from(
          String(h.requests[0]?.request.params.args_base64),
          "base64",
        ).toString(),
      ).toBe('{"rawJSON":"123"}')
    }),
)
it.effect(
  "fails a forged client as configuration, without transport work",
  () =>
    Effect.gen(function* () {
      const h = harness()
      expect(
        yield* h
          .provide(Near.account({} as Near.Client, "alice.testnet"))
          .pipe(Effect.flip),
      ).toMatchObject({ _tag: "RequestError", reason: "Configuration" })
      expect(h.requests).toHaveLength(0)
    }),
)
