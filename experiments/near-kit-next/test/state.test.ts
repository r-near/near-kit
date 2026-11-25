import { it } from "@effect/vitest"
import { Effect, Stream } from "effect"
import { expect } from "vitest"
import * as Near from "../src/index.js"
import { HASH, harness, OTHER_HASH } from "./fixtures.js"

// Mocked Fetch bodies and control flow, not executed nearcore fixtures.
const client = Near.make({ url: "https://example.test/rpc" })
const accountId = "fixture.testnet"
const metadata = { block_hash: HASH, block_height: 123 }
const entry = (key: string, value = "") => ({ key, value })
const page = (values: ReturnType<typeof entry>[], last_key?: string) => ({
  ...metadata,
  values,
  ...(last_key === undefined ? {} : { last_key }),
})
function latch() {
  let resolve: () => void = () => {
    throw new Error("Latch not initialized")
  }
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

it.effect(
  "projects binary state using unsigned raw-byte order rather than base64 order",
  () =>
    Effect.gen(function* () {
      const h = harness(() =>
        page([
          entry("", "AP8B"),
          entry("AA=="),
          entry("AAA=", "/w=="),
          entry("AP8=", "gAA="),
          entry("AQ=="),
          entry("gA=="),
          entry("/w=="),
        ]),
      )
      const result = yield* h.provide(Near.statePage(client, accountId))
      expect(result.entries.map((value) => Array.from(value.key))).toEqual([
        [],
        [0],
        [0, 0],
        [0, 255],
        [1],
        [128],
        [255],
      ])
      expect(result.entries[0]?.value).toEqual(new Uint8Array([0, 255, 1]))
      expect(result.entries[1]?.value).toEqual(new Uint8Array())
      expect(result.proof).toBeUndefined()
      expect(result.nextCursor).toBeUndefined()
      expect(result).toMatchObject({ blockHash: HASH, blockHeight: 123n })
      expect(h.requests[0]?.request.params).toEqual({
        request_type: "view_state",
        account_id: accountId,
        prefix_base64: "",
        finality: "final",
        limit: 100,
      })
    }),
)

it.effect("keeps a real empty-byte cursor and sends it on continuation", () =>
  Effect.gen(function* () {
    const h = harness((request) =>
      Object.hasOwn(request.params, "after_key_base64")
        ? page([entry("AA==", "AQ==")])
        : page([entry("", "AP8=")], ""),
    )
    const result = yield* h.provide(
      Near.statePages(client, accountId, { pageSize: 1 }).pipe(
        Stream.runCollect,
      ),
    )
    expect(result).toHaveLength(2)
    expect(result[0]?.nextCursor).toEqual(new Uint8Array())
    expect(h.requests[1]?.request.params).toEqual({
      request_type: "view_state",
      account_id: accountId,
      prefix_base64: "",
      block_id: HASH,
      limit: 1,
      after_key_base64: "",
    })
  }),
)

it.effect(
  "sends a binary prefix and exclusive cursor, accepts short continuing pages and empty terminal pages",
  () =>
    Effect.gen(function* () {
      const h = harness(() => page([entry("AP8=", "AP8=")], "AP8="))
      const result = yield* h.provide(
        Near.statePage(client, accountId, {
          prefix: new Uint8Array([0]),
          after: new Uint8Array([0, 1]),
          pageSize: 100,
          at: { hash: HASH },
        }),
      )
      expect(result.entries).toHaveLength(1)
      expect(result.nextCursor).toEqual(new Uint8Array([0, 255]))
      expect(h.requests[0]?.request.params).toMatchObject({
        prefix_base64: "AA==",
        after_key_base64: "AAE=",
        limit: 100,
        block_id: HASH,
      })
      const empty = harness(() => page([]))
      expect(
        (yield* empty.provide(
          Near.statePage(client, accountId, { after: new Uint8Array([255]) }),
        )).entries,
      ).toEqual([])
    }),
)

it.effect(
  "requests unpaginated opaque proof bytes and normalizes an omitted proof vector",
  () =>
    Effect.gen(function* () {
      const h = harness(() => ({
        ...page([entry("AA==", "AP8=")]),
        proof: ["AP8B", ""],
      }))
      const result = yield* h.provide(
        Near.statePage(client, accountId, {
          proof: true,
          prefix: new Uint8Array([0]),
        }),
      )
      expect(result.proof).toEqual([
        new Uint8Array([0, 255, 1]),
        new Uint8Array(),
      ])
      expect(h.requests[0]?.request.params).toEqual({
        request_type: "view_state",
        account_id: accountId,
        prefix_base64: "AA==",
        finality: "final",
        include_proof: true,
      })
      expect(h.requests[0]?.request.params).not.toHaveProperty("limit")
      expect(h.requests[0]?.request.params).not.toHaveProperty(
        "after_key_base64",
      )
      const omitted = harness(() => page([]))
      expect(
        (yield* omitted.provide(
          Near.statePage(client, accountId, { proof: true }),
        )).proof,
      ).toEqual([])
      expect(
        (yield* h.provide(Near.statePage(client, accountId))).proof,
      ).toBeUndefined()
    }),
)

for (const options of [
  { proof: true, pageSize: 1 },
  { proof: true, after: new Uint8Array() },
  { prefix: new Uint8Array([0]), after: new Uint8Array([1]) },
  ...[0, -1, 1.5, 10001, NaN, Infinity].map((pageSize) => ({ pageSize })),
  { proof: "true" },
  { prefix: [0] },
  { after: [0] },
  null,
]) {
  it.effect(
    `rejects invalid state options without I/O: ${JSON.stringify(options)}`,
    () =>
      Effect.gen(function* () {
        const h = harness()
        expect(
          (yield* h
            .provide(Near.statePage(client, accountId, options as never))
            .pipe(Effect.flip))._tag,
        ).toBe("RequestError")
        expect(h.requests).toHaveLength(0)
      }),
  )
}

for (const [name, response, options] of [
  ["descending raw keys", page([entry("gA=="), entry("AA==")]), {}],
  ["duplicate keys", page([entry("AA=="), entry("AA==")]), {}],
  [
    "key outside prefix",
    page([entry("AQ==")]),
    { prefix: new Uint8Array([0]) },
  ],
  [
    "cursor-inclusive key",
    page([entry("AA==")]),
    { after: new Uint8Array([0]) },
  ],
  ["key behind cursor", page([entry("AA==")]), { after: new Uint8Array([1]) }],
  ["cursor on empty page", page([], "AA=="), {}],
  ["cursor unlike last key", page([entry("AA==")], "AQ=="), {}],
  ["too many entries", page([entry("AA=="), entry("AQ==")]), { pageSize: 1 }],
  ["cursor on proof page", page([entry("AA==")], "AA=="), { proof: true }],
  ["malformed key base64", page([entry("AA")]), {}],
  ["noncanonical key pad bits", page([entry("AB==")]), {}],
  ["malformed value base64", page([entry("AA==", "/w==\n")]), {}],
  ["malformed cursor base64", page([entry("AA==")], "AA"), {}],
  [
    "malformed requested proof base64",
    { ...page([]), proof: ["AB=="] },
    { proof: true },
  ],
  ["malformed unrequested proof base64", { ...page([]), proof: ["AB=="] }, {}],
  ["missing metadata", { values: [] }, {}],
  [
    "wrong explicit hash",
    { ...page([]), block_hash: OTHER_HASH },
    { at: { hash: HASH } },
  ],
  ["wrong explicit height", page([]), { at: { height: 124n } }],
] as const) {
  it.effect(`rejects ${name}`, () =>
    Effect.gen(function* () {
      const h = harness(() => response)
      expect(
        (yield* h
          .provide(Near.statePage(client, accountId, options))
          .pipe(Effect.flip))._tag,
      ).toBe("DecodeError")
    }),
  )
}

it.effect(
  "separates existing empty state from structured account absence and state-size failure",
  () =>
    Effect.gen(function* () {
      const cases = [
        [
          "UNKNOWN_ACCOUNT",
          { requested_account_id: accountId },
          "AccountNotFound",
        ],
        [
          "TOO_LARGE_CONTRACT_STATE",
          { contract_account_id: accountId },
          "RpcError",
        ],
      ] as const
      for (const [name, info, tag] of cases) {
        const h = harness(
          (request) => ({
            jsonrpc: "2.0",
            id: request.id,
            error: {
              code: -32000,
              message: "ignored",
              name: "HANDLER_ERROR",
              cause: { name, info: { ...metadata, ...info } },
            },
          }),
          false,
        )
        const error = yield* h
          .provide(
            Near.statePage(client, accountId, {
              proof: true,
              at: { hash: HASH },
            }),
          )
          .pipe(Effect.flip)
        expect(error._tag).toBe(tag)
        if (error._tag === "RpcError") expect(error.kind).toBe("StateTooLarge")
      }
      const wrong = harness(
        (request) => ({
          jsonrpc: "2.0",
          id: request.id,
          error: {
            code: -32000,
            message: "ignored",
            name: "HANDLER_ERROR",
            cause: {
              name: "TOO_LARGE_CONTRACT_STATE",
              info: { ...metadata, contract_account_id: "wrong.testnet" },
            },
          },
        }),
        false,
      )
      expect(
        (yield* wrong
          .provide(Near.statePage(client, accountId, { proof: true }))
          .pipe(Effect.flip))._tag,
      ).toBe("DecodeError")
    }),
)

it.effect(
  "starts lazily, pins subsequent pages and privately copies options and yielded cursors",
  () =>
    Effect.gen(function* () {
      const prefix = new Uint8Array([0])
      const options = { prefix, pageSize: 1, at: "optimistic" as Near.At }
      const h = harness((request) =>
        Object.hasOwn(request.params, "after_key_base64")
          ? page([entry("AAE=", "AQ==")])
          : page([entry("AA==", "AP8=")], "AA=="),
      )
      const stream = Near.statePages(client, accountId, options)
      expect(h.requests).toHaveLength(0)
      let seen = 0
      const result = yield* h.provide(
        stream.pipe(
          Stream.tap((value) =>
            Effect.sync(() => {
              if (seen++ === 0) {
                prefix[0] = 255
                options.pageSize = 100
                options.at = { hash: OTHER_HASH }
                const firstEntry = value.entries[0]
                if (value.nextCursor === undefined || firstEntry === undefined)
                  throw new Error("Missing first page cursor or entry")
                value.nextCursor[0] = 254
                firstEntry.key[0] = 253
              }
            }),
          ),
          Stream.runCollect,
        ),
      )
      expect(result).toHaveLength(2)
      expect(h.requests[0]?.request.params).toMatchObject({
        finality: "optimistic",
        prefix_base64: "AA==",
        limit: 1,
      })
      expect(h.requests[1]?.request.params).toEqual({
        request_type: "view_state",
        account_id: accountId,
        prefix_base64: "AA==",
        limit: 1,
        block_id: HASH,
        after_key_base64: "AA==",
      })
    }),
)

it.effect("takes a fresh input snapshot for each state-page execution", () =>
  Effect.gen(function* () {
    const prefix = new Uint8Array([0])
    const h = harness((request) =>
      page([entry(String(request.params.prefix_base64))]),
    )
    const saved = Near.statePage(client, accountId, { prefix })
    prefix[0] = 1
    yield* h.provide(saved)
    prefix[0] = 128
    yield* h.provide(saved)
    expect(
      h.requests.map((value) => value.request.params.prefix_base64),
    ).toEqual(["AQ==", "gA=="])
  }),
)

it.effect(
  "owns a page's prefix and input cursor before transport can mutate caller buffers",
  () =>
    Effect.gen(function* () {
      const prefix = new Uint8Array([0])
      const after = new Uint8Array([0])
      const h = harness(() => {
        prefix[0] = 255
        after[0] = 255
        return page([entry("AP8=")])
      })
      const result = yield* h.provide(
        Near.statePage(client, accountId, { prefix, after }),
      )
      expect(result.entries[0]?.key).toEqual(new Uint8Array([0, 255]))
      expect(h.requests[0]?.request.params).toMatchObject({
        prefix_base64: "AA==",
        after_key_base64: "AA==",
      })
    }),
)

it.effect(
  "rejects a repeated continuation without looping or discarding the consumed prefix",
  () =>
    Effect.gen(function* () {
      const h = harness(() => page([entry("AA==")], "AA=="))
      const consumed: Near.StatePage[] = []
      const error = yield* h
        .provide(
          Near.statePages(client, accountId).pipe(
            Stream.runForEach((value) =>
              Effect.sync(() => {
                consumed.push(value)
              }),
            ),
          ),
        )
        .pipe(Effect.flip)
      expect(error).toMatchObject({ _tag: "DecodeError", reason: "Pagination" })
      expect(h.requests).toHaveLength(2)
      expect(consumed).toHaveLength(1)
    }),
)

it.effect(
  "stops after a short terminal page and does not fetch ahead of Stream.take",
  () =>
    Effect.gen(function* () {
      const terminal = harness(() => page([entry("AA==")]))
      expect(
        yield* terminal.provide(
          Near.statePages(client, accountId).pipe(Stream.runCollect),
        ),
      ).toHaveLength(1)
      expect(terminal.requests).toHaveLength(1)
      const continuing = harness(() => page([entry("AA==")], "AA=="))
      expect(
        yield* continuing.provide(
          Near.statePages(client, accountId).pipe(
            Stream.take(1),
            Stream.runCollect,
          ),
        ),
      ).toHaveLength(1)
      expect(continuing.requests).toHaveLength(1)
      const never = harness()
      expect(
        yield* never.provide(
          Near.statePages(client, accountId).pipe(
            Stream.take(0),
            Stream.runCollect,
          ),
        ),
      ).toEqual([])
      expect(never.requests).toHaveLength(0)
    }),
)

it.effect(
  "gives separate simultaneous consumers their own traversal state",
  () =>
    Effect.gen(function* () {
      const h = harness((request) =>
        Object.hasOwn(request.params, "after_key_base64")
          ? page([entry("AQ==")])
          : page([entry("AA==")], "AA=="),
      )
      const stream = Near.statePages(client, accountId, { pageSize: 1 })
      const [left, right] = yield* h.provide(
        Effect.all([Stream.runCollect(stream), Stream.runCollect(stream)], {
          concurrency: 2,
        }),
      )
      expect(left).toHaveLength(2)
      expect(right).toEqual(left)
      const firstEntry = left[0]?.entries[0]
      if (firstEntry === undefined) throw new Error("Missing first entry")
      firstEntry.key[0] = 255
      expect(right[0]?.entries[0]?.key[0]).toBe(0)
      expect(
        h.requests.filter(
          (value) => !Object.hasOwn(value.request.params, "after_key_base64"),
        ),
      ).toHaveLength(2)
      expect(
        h.requests.filter(
          (value) => value.request.params.after_key_base64 === "AA==",
        ),
      ).toHaveLength(2)
    }),
)

for (const [label, changed] of [
  ["hash", { block_hash: OTHER_HASH }],
  ["height", { block_height: 124 }],
] as const) {
  it.effect(
    `fails on a later page's changed ${label} while preserving previously consumed pages`,
    () =>
      Effect.gen(function* () {
        const h = harness((request) =>
          Object.hasOwn(request.params, "after_key_base64")
            ? { ...page([entry("AQ==")]), ...changed }
            : page([entry("AA==")], "AA=="),
        )
        const consumed: Near.StatePage[] = []
        const error = yield* h
          .provide(
            Near.statePages(client, accountId).pipe(
              Stream.runForEach((value) =>
                Effect.sync(() => {
                  consumed.push(value)
                }),
              ),
            ),
          )
          .pipe(Effect.flip)
        expect(error).toMatchObject({
          _tag: "DecodeError",
          reason: "BlockMismatch",
        })
        expect(consumed).toHaveLength(1)
        expect(h.requests).toHaveLength(2)
      }),
  )
}

it.effect(
  "uses a supplied shared snapshot on its first stream request and rejects forbidden stream options",
  () =>
    Effect.gen(function* () {
      const h = harness(() => page([]))
      yield* h.provide(
        Near.statePages(client, accountId, { at: { hash: HASH } }).pipe(
          Stream.runCollect,
        ),
      )
      expect(h.requests[0]?.request.params.block_id).toBe(HASH)
      expect(h.requests[0]?.request.params).not.toHaveProperty("finality")
      for (const options of [
        { proof: true },
        { proof: false },
        { after: new Uint8Array() },
      ]) {
        const invalid = harness()
        expect(
          (yield* invalid
            .provide(
              Near.statePages(client, accountId, options as never).pipe(
                Stream.runCollect,
              ),
            )
            .pipe(Effect.flip))._tag,
        ).toBe("RequestError")
        expect(invalid.requests).toHaveLength(0)
      }
    }),
)

it("interrupts a second page mid-body without yielding it or requesting a third page", async () => {
  const started = latch()
  let bodyCanceled = false
  const consumed: Near.StatePage[] = []
  const h = harness((request) => {
    if (!Object.hasOwn(request.params, "after_key_base64"))
      return page([entry("AA==")], "AA==")
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              `{"jsonrpc":"2.0","id":${JSON.stringify(request.id)},"result":`,
            ),
          )
          started.resolve()
        },
        cancel() {
          bodyCanceled = true
        },
      }),
    )
  })
  const controller = new AbortController()
  const running = Effect.runPromise(
    h.provide(
      Near.statePages(client, accountId, { pageSize: 1 }).pipe(
        Stream.runForEach((value) =>
          Effect.sync(() => {
            consumed.push(value)
          }),
        ),
      ),
    ),
    { signal: controller.signal },
  )
  const rejected = expect(running).rejects.toBeDefined()
  await started.promise
  controller.abort()
  await rejected
  expect(consumed).toHaveLength(1)
  expect(h.requests).toHaveLength(2)
  expect(bodyCanceled || h.requests[1]?.init.signal?.aborted).toBe(true)
})
