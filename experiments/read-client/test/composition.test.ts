import { it } from "@effect/vitest"
import { Cause, Context, Effect, Exit, Schedule, Schema, SchemaGetter } from "effect"
import { expect } from "vitest"
import { Near } from "../src/index.js"
import { harness, viewWire } from "./fixtures.js"

class Prefix extends Context.Service<Prefix, { readonly value: string }>()("test/Prefix") {}
const prefixed = Schema.String.pipe(Schema.decodeTo(Schema.String, {
  decode: SchemaGetter.transformEffect((value: string) => Effect.map(Prefix, (prefix) => prefix.value + value)),
  encode: SchemaGetter.passthrough(),
}))

it.effect("retains result-schema service requirements and inferred output", () => Effect.gen(function* () {
  const h = harness(() => viewWire(new TextEncoder().encode('"value"')))
  const program = Near.make({ url: "https://example.test" }).view({
    accountId: "contract.testnet", method: "read", schema: prefixed,
  })
  if (false) {
    // @ts-expect-error Prefix is still required after the transport is provided.
    Effect.runPromise(h.provide(program))
  }
  const result = yield* h.provide(program).pipe(Effect.provideService(Prefix, { value: "decoded:" }))
  const value: string = result.value
  expect(value).toBe("decoded:value")
}))

it.effect("keeps a custom result-schema defect out of the typed failure channel", () => Effect.gen(function* () {
  const defect = new Error("custom decoder bug")
  const schema = Schema.String.pipe(Schema.decodeTo(Schema.String, {
    decode: SchemaGetter.transformEffect((_value: string) => Effect.die(defect)),
    encode: SchemaGetter.passthrough(),
  }))
  const h = harness(() => viewWire(new TextEncoder().encode('"value"')))
  const exit = yield* h.provide(Near.make({ url: "https://example.test" }).view({
    accountId: "contract.testnet", method: "read", schema,
  })).pipe(Effect.exit)
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBe(defect)
}))

it.effect("owns request argument bytes before transport begins", () => Effect.gen(function* () {
  const args = { nested: { value: 1 } }
  const h = harness(() => {
    args.nested.value = 9
    return viewWire()
  })
  yield* h.provide(Near.make({ url: "https://example.test" }).viewBytes({
    accountId: "contract.testnet", method: "read", args,
  }))
  expect(Buffer.from(String(h.requests[0]?.request.params.args_base64), "base64").toString()).toBe('{"nested":{"value":1}}')
  expect(args.nested.value).toBe(9)
}))

it.effect("uses caller-supplied finite retries and does not retry decoding failures", () => Effect.gen(function* () {
  const client = Near.make({ url: "https://example.test" })
  const transient = harness(() => { throw new Error("offline") })
  const retried = client.account("alice.testnet").pipe(Effect.retry({
    schedule: Schedule.recurs(2),
    while: (error) => error._tag === "TransportError",
  }))
  const failure = yield* transient.provide(retried).pipe(Effect.flip)
  expect(failure._tag).toBe("TransportError")
  expect(transient.requests).toHaveLength(3)
  const malformed = harness(() => ({ invalid: true }))
  expect((yield* malformed.provide(retried).pipe(Effect.flip))._tag).toBe("DecodeError")
  expect(malformed.requests).toHaveLength(1)
}))

for (const at of [{ hash: "x", height: 1 }, { height: -1 }, { height: 1.5 }, {}, "latest"]) {
  it.effect("rejects an invalid or ambiguous block selector without I/O", () => Effect.gen(function* () {
    const h = harness()
    const failure = yield* h.provide(Near.make({ url: "https://example.test" }).account("alice.testnet", { at: at as never })).pipe(Effect.flip)
    expect(failure._tag).toBe("RequestError")
    expect(h.requests).toHaveLength(0)
  }))
}
