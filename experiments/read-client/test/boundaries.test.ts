import { inspect } from "node:util"
import { it } from "@effect/vitest"
import { Effect, Schema, Tracer } from "effect"
import { expect } from "vitest"
import { Near } from "../src/index.js"
import { accountWire, harness, viewWire } from "./fixtures.js"

const url = "https://example.test/rpc"
const malformed: Array<[string, (id: string | number) => unknown]> = [
  ["wrong version", (id) => ({ jsonrpc: "1.0", id, result: accountWire })],
  [
    "wrong ID",
    () => ({ jsonrpc: "2.0", id: "not-our-id", result: accountWire }),
  ],
  [
    "null ID",
    () => ({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "parse" },
    }),
  ],
  [
    "both result and error",
    (id) => ({
      jsonrpc: "2.0",
      id,
      result: accountWire,
      error: { code: -32000, message: "bad" },
    }),
  ],
  ["neither result nor error", (id) => ({ jsonrpc: "2.0", id })],
  [
    "noninteger error code",
    (id) => ({ jsonrpc: "2.0", id, error: { code: 0.5, message: "bad" } }),
  ],
  ["malformed error", (id) => ({ jsonrpc: "2.0", id, error: "bad" })],
  ["null account result", (id) => ({ jsonrpc: "2.0", id, result: null })],
]
for (const [name, response] of malformed) {
  it.effect(`rejects envelope ${name}`, () =>
    Effect.gen(function* () {
      const h = harness((request) => response(request.id), false)
      expect(
        (yield* h
          .provide(Near.make({ url }).account("alice.testnet"))
          .pipe(Effect.flip))._tag,
      ).toBe("DecodeError")
    }),
  )
}

it.effect("accepts forward-compatible envelope and result fields", () =>
  Effect.gen(function* () {
    const h = harness(
      (request) => ({
        jsonrpc: "2.0",
        id: request.id,
        extension: true,
        result: { ...accountWire, future_field: ["ignored"] },
      }),
      false,
    )
    expect(
      (yield* h.provide(Near.make({ url }).account("alice.testnet"))).amount,
    ).toBe(1234567890123456789012345n)
  }),
)

for (const limit of [0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
  it.effect(`rejects invalid response limit ${String(limit)} without I/O`, () =>
    Effect.gen(function* () {
      const h = harness()
      const failure = yield* h
        .provide(
          Near.make({ url, maxResponseBytes: limit }).account("alice.testnet"),
        )
        .pipe(Effect.flip)
      expect(failure._tag).toBe("RequestError")
      expect(h.requests).toHaveLength(0)
    }),
  )
}

for (const endpoint of [
  "not a URL",
  "file:///secret",
  "https://name:password@example.test",
  `${url}#fragment`,
]) {
  it.effect("rejects unsupported endpoint without retaining it", () =>
    Effect.gen(function* () {
      const h = harness()
      const failure = yield* h
        .provide(Near.make({ url: endpoint }).account("alice.testnet"))
        .pipe(Effect.flip)
      expect(failure._tag).toBe("RequestError")
      expect(h.requests).toHaveLength(0)
      expect(inspect(failure, { depth: 20 })).not.toContain(endpoint)
    }),
  )
}

it.effect("rejects malformed JSON/UTF-8 and empty HTTP bodies", () =>
  Effect.gen(function* () {
    for (const body of ["not JSON", "", new Uint8Array([0xff])]) {
      const h = harness(() => new Response(body))
      const failure = yield* h
        .provide(Near.make({ url }).account("alice.testnet"))
        .pipe(Effect.flip)
      expect(failure._tag).toBe("DecodeError")
    }
  }),
)

it.effect(
  "rejects malformed UTF-8 in contract JSON rather than inserting replacement characters",
  () =>
    Effect.gen(function* () {
      const h = harness(() => viewWire(new Uint8Array([34, 0xff, 34])))
      expect(
        (yield* h
          .provide(
            Near.make({ url }).view({
              accountId: "contract.testnet",
              method: "read",
              schema: Schema.String,
            }),
          )
          .pipe(Effect.flip))._tag,
      ).toBe("DecodeError")
    }),
)

it.effect("enforces streamed byte limits without trusting Content-Length", () =>
  Effect.gen(function* () {
    let canceled = false
    const h = harness(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array(100))
            },
            cancel() {
              canceled = true
            },
          }),
          { headers: { "content-length": "1" } },
        ),
    )
    const failure = yield* h
      .provide(
        Near.make({ url, maxResponseBytes: 20 }).account("alice.testnet"),
      )
      .pipe(Effect.flip)
    expect(failure._tag).toBe("DecodeError")
    expect(canceled || h.requests[0]?.init.signal?.aborted).toBe(true)
  }),
)

it.effect("classifies HTTP errors without waiting for a stalled body", () =>
  Effect.gen(function* () {
    const h = harness(
      () => new Response(new ReadableStream<Uint8Array>({}), { status: 503 }),
    )
    const failure = yield* h
      .provide(Near.make({ url }).account("alice.testnet"))
      .pipe(Effect.flip)
    expect(failure).toMatchObject({ _tag: "HttpError", status: 503 })
    expect(h.requests).toHaveLength(1)
    expect(h.requests[0]?.init.signal?.aborted).toBe(true)
  }),
)

it.effect("adds no retries to transport failures", () =>
  Effect.gen(function* () {
    const h = harness(() => {
      throw new Error("fetch failed")
    })
    expect(
      (yield* h
        .provide(Near.make({ url }).account("alice.testnet"))
        .pipe(Effect.flip))._tag,
    ).toBe("TransportError")
    expect(h.requests).toHaveLength(1)
  }),
)

it.effect(
  "omits request/provider secrets from expected failures and creates no automatic spans",
  () =>
    Effect.gen(function* () {
      const secrets = [
        "path-SECRET",
        "query-SECRET",
        "header-SECRET",
        "body-SECRET",
        "cause-SECRET",
      ] as const
      const tracer = Tracer.make({
        span() {
          throw new Error("The read adapter unexpectedly created a span")
        },
      })
      const client = Near.make({
        url: `https://example.test/${secrets[0]}?token=${secrets[1]}`,
        headers: { "x-provider-token": secrets[2] },
      })
      const h = harness(
        (request) => ({
          jsonrpc: "2.0",
          id: request.id,
          error: {
            code: -32000,
            message: secrets.join(" "),
            data: { secret: secrets[4] },
            name: "FUTURE_SERVER_ERROR",
            cause: { name: "UNRECOGNIZED", info: { secret: secrets[3] } },
          },
        }),
        false,
      )
      const failure = yield* h
        .provide(
          client.view({
            accountId: "contract.testnet",
            method: "read",
            args: { token: secrets[3] },
            schema: Schema.Unknown,
          }),
        )
        .pipe(Effect.withTracer(tracer), Effect.flip)
      expect(failure._tag).toBe("RpcError")
      const output = [
        String(failure),
        JSON.stringify(failure),
        inspect(failure, { depth: 20 }),
      ].join("\n")
      for (const secret of secrets) expect(output).not.toContain(secret)
    }),
)

it.effect("does not retain a transport exception's secret cause", () =>
  Effect.gen(function* () {
    const secret = "nested-transport-SECRET"
    const h = harness(() => {
      throw new Error(secret, { cause: { nested: secret } })
    })
    const failure = yield* h
      .provide(Near.make({ url }).account("alice.testnet"))
      .pipe(Effect.flip)
    expect(failure._tag).toBe("TransportError")
    expect(inspect(failure, { depth: 20 })).not.toContain(secret)
  }),
)

it("application pre-abort guard starts no request before entering the pinned runner", async () => {
  const h = harness()
  const controller = new AbortController()
  controller.abort()
  await expect(
    (async () => {
      // rc.118 evaluates synchronously before checking RunOptions.signal; this is
      // explicitly an application-entry guard, not a claim about Effect itself.
      controller.signal.throwIfAborted()
      return Effect.runPromise(
        h.provide(Near.make({ url }).account("alice.testnet")),
        { signal: controller.signal },
      )
    })(),
  ).rejects.toBeDefined()
  expect(h.requests).toHaveLength(0)
})

it.effect(
  "rejects unsupported JSON values instead of silently coercing them",
  () =>
    Effect.gen(function* () {
      const cyclic: Record<string, unknown> = {}
      cyclic.self = cyclic
      for (const args of [
        { value: 1n },
        { value: undefined },
        { value: NaN },
        { value: () => 1 },
        cyclic,
      ]) {
        const h = harness(() => viewWire())
        // Deliberately cross the unchecked JavaScript boundary to test runtime validation.
        const failure = yield* h
          .provide(
            Near.make({ url }).view({
              accountId: "contract.testnet",
              method: "read",
              args: args as never,
              schema: Schema.Unknown,
            }),
          )
          .pipe(Effect.flip)
        expect(failure._tag).toBe("RequestError")
        expect(h.requests).toHaveLength(0)
      }
    }),
)

it.effect(
  "preserves unknown JSON-RPC extension fields as a generic rejection",
  () =>
    Effect.gen(function* () {
      const h = harness(
        (request) => ({
          jsonrpc: "2.0",
          id: request.id,
          error: {
            code: -32099,
            message: "unknown server",
            cause: "future-extension-shape",
          },
        }),
        false,
      )
      const failure = yield* h
        .provide(Near.make({ url }).account("alice.testnet"))
        .pipe(Effect.flip)
      expect(failure._tag).toBe("RpcError")
    }),
)

for (const chunkSize of [1, 2, 7, 4096]) {
  it.effect(`decodes fragmented bodies in ${chunkSize}-byte chunks`, () =>
    Effect.gen(function* () {
      const h = harness((request) => {
        const bytes = new TextEncoder().encode(
          JSON.stringify({
            jsonrpc: "2.0",
            id: request.id,
            result: accountWire,
            ignored: "x".repeat(10_000),
          }),
        )
        let offset = 0
        return new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              if (offset === bytes.byteLength) {
                controller.close()
                return
              }
              controller.enqueue(bytes.subarray(offset, offset + chunkSize))
              offset = Math.min(bytes.byteLength, offset + chunkSize)
            },
          }),
        )
      })
      expect(
        (yield* h.provide(Near.make({ url }).account("alice.testnet"))).amount,
      ).toBe(1234567890123456789012345n)
    }),
  )
}
