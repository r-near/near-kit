import {
  Cause,
  Clock,
  ConfigProvider,
  Effect,
  Exit,
  Fiber,
  Layer,
  Stream,
} from "effect"
import { TestClock } from "effect/testing"
import { afterEach, describe, expect, test, vi } from "vitest"
import * as Schema from "effect/Schema"
import {
  type RpcFetch,
  rpcFromPromises,
  rpcToPromises,
} from "../../src/core/rpc/rpc.js"
import {
  fetchTransport,
  makeRpcPrograms,
} from "../../src/core/rpc/rpc-program.js"
import { Rpc, RpcTransport } from "../../src/effect/rpc.js"
import { runPromise } from "../../src/effect/runtime.js"
import {
  AccountDoesNotExistError,
  FunctionCallError,
  NetworkError,
} from "../../src/errors/index.js"
import { testRpcPrograms } from "../helpers/rpc.js"

function result(value: unknown): Response {
  return Response.json({ jsonrpc: "2.0", id: 1, result: value })
}

const account = {
  amount: "1000",
  locked: "0",
  code_hash: "code",
  storage_usage: 12,
  storage_paid_at: 0,
  block_height: 42,
  block_hash: "block",
}

afterEach(() => vi.restoreAllMocks())

describe("native RPC programs", () => {
  test("isolates injected transports and preserves client identity across service calls", async () => {
    const requests: Array<{ url: string; body: unknown; headers: unknown }> = []
    const transport: RpcFetch = async (url, init) => {
      requests.push({ url, body: init.body, headers: init.headers })
      return result({ gas_price: url.endsWith("a") ? "10" : "20" })
    }
    const query = Effect.gen(function* () {
      const { getGasPrice } = yield* Rpc
      return [yield* getGasPrice(), yield* getGasPrice("block")]
    })
    const layer = (url: string) =>
      Rpc.layer({ url, headers: { "X-Near-Test": url } }).pipe(
        Layer.provide(RpcTransport.layer(transport)),
      )
    const values = await runPromise(
      Effect.all(
        [
          query.pipe(Effect.provide(layer("https://rpc.test/a"))),
          query.pipe(Effect.provide(layer("https://rpc.test/b"))),
        ],
        { concurrency: "unbounded" },
      ),
    )
    expect(values).toEqual([
      [{ gas_price: "10" }, { gas_price: "10" }],
      [{ gas_price: "20" }, { gas_price: "20" }],
    ])
    for (const url of ["https://rpc.test/a", "https://rpc.test/b"]) {
      expect(requests.filter((request) => request.url === url)).toEqual([
        {
          url,
          headers: { "Content-Type": "application/json", "X-Near-Test": url },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "gas_price",
            params: [null],
          }),
        },
        {
          url,
          headers: { "Content-Type": "application/json", "X-Near-Test": url },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            method: "gas_price",
            params: ["block"],
          }),
        },
      ])
    }
  })

  test.each(["true", "TRUE", "yes"])(
    "reads the exact debug flag from ConfigProvider: %s",
    async (flag) => {
      const log = vi.spyOn(console, "log").mockImplementation(() => {})
      await runPromise(
        Effect.gen(function* () {
          const rpc = yield* makeRpcPrograms(
            { url: "https://rpc.test" },
            fetchTransport(async () => result({ gas_price: "10" })),
          )
          // Config is captured at acquisition, not re-read by request operations.
          return yield* rpc
            .getGasPrice()
            .pipe(
              Effect.provide(
                ConfigProvider.layer(
                  ConfigProvider.fromUnknown({ NEAR_RPC_DEBUG: "false" }),
                ),
              ),
            )
        }).pipe(
          Effect.provide(
            ConfigProvider.layer(
              ConfigProvider.fromUnknown({ NEAR_RPC_DEBUG: flag }),
            ),
          ),
        ),
      )
      expect(log.mock.calls.map(([prefix]) => prefix)).toEqual(
        flag === "true" ? ["[RPC Request]", "[RPC Response]"] : [],
      )
    },
  )

  test("keeps effects lazy and concurrent re-execution allocates distinct request IDs", async () => {
    const requests: unknown[] = []
    const rpc = testRpcPrograms("https://rpc.test", async (_, init) => {
      requests.push(init.body)
      return result({ gas_price: "10" })
    })
    const program = rpc.getGasPrice()
    expect(requests).toEqual([])
    await runPromise(
      Effect.all([program, program], { concurrency: "unbounded" }),
    )
    expect(requests).toEqual(
      [1, 2].map((id) =>
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          method: "gas_price",
          params: [null],
        }),
      ),
    )
  })

  test("retries identical signed bytes at bounded exponential deadlines", async () => {
    await runPromise(
      Effect.gen(function* () {
        const clock = yield* Clock.Clock
        const attempts: Array<{ at: number; body: unknown }> = []
        const rpc = testRpcPrograms(
          "https://rpc.test",
          async (_, init) => {
            attempts.push({
              at: clock.currentTimeMillisUnsafe(),
              body: init.body,
            })
            return new Response("unavailable", { status: 503 })
          },
          undefined,
          { maxRetries: 2, initialDelayMs: 100 },
        )
        const fiber = yield* rpc
          .sendTransaction(new Uint8Array([1, 2, 3]), "NONE")
          .pipe(Effect.forkChild)
        yield* TestClock.adjust(99)
        expect(attempts.map(({ at }) => at)).toEqual([0])
        yield* TestClock.adjust(1)
        expect(attempts.map(({ at }) => at)).toEqual([0, 100])
        yield* TestClock.adjust(199)
        expect(attempts).toHaveLength(2)
        yield* TestClock.adjust(1)
        const error = yield* Fiber.join(fiber).pipe(Effect.flip)
        expect(error).toBeInstanceOf(NetworkError)
        const body = JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "send_tx",
          params: { signed_tx_base64: "AQID", wait_until: "NONE" },
        })
        expect(attempts).toEqual([
          { at: 0, body },
          { at: 100, body },
          { at: 300, body },
        ])
      }).pipe(Effect.provide(TestClock.layer())),
    )
  })

  test("interrupts a scheduled retry without issuing another request", async () => {
    await runPromise(
      Effect.gen(function* () {
        let attempts = 0
        const rpc = testRpcPrograms(
          "https://rpc.test",
          async () => {
            attempts++
            return new Response("unavailable", { status: 503 })
          },
          undefined,
          { maxRetries: 4, initialDelayMs: 100 },
        )
        const fiber = yield* rpc.call("status", []).pipe(Effect.forkChild)
        yield* TestClock.adjust(1)
        expect(attempts).toBe(1)
        yield* Fiber.interrupt(fiber)
        yield* TestClock.adjust(10000)
        expect(attempts).toBe(1)
        const exit = yield* Fiber.await(fiber)
        expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(
          true,
        )
      }).pipe(Effect.provide(TestClock.layer())),
    )
  })

  test.each(["fetch", "body"] as const)(
    "cancels the transport while awaiting %s without retrying",
    async (phase) => {
      const started = Promise.withResolvers<void>()
      const pending = Promise.withResolvers<Response>()
      const body = Promise.withResolvers<unknown>()
      const controller = new AbortController()
      let calls = 0
      let transportSignal: AbortSignal | undefined
      class PendingBody extends Response {
        override json(): Promise<unknown> {
          started.resolve()
          return body.promise
        }
      }
      const rpc = testRpcPrograms(
        "https://rpc.test",
        (_, init) => {
          calls++
          transportSignal = init.signal
          init.signal.addEventListener(
            "abort",
            () => {
              const error = new DOMException("cancelled", "AbortError")
              if (phase === "fetch") pending.reject(error)
              else body.reject(error)
            },
            { once: true },
          )
          if (phase === "fetch") {
            started.resolve()
            return pending.promise
          }
          return Promise.resolve(new PendingBody())
        },
        undefined,
        { maxRetries: 4, initialDelayMs: 0 },
      )
      const exitPromise = Effect.runPromiseExit(rpc.call("status", []), {
        signal: controller.signal,
      })
      await started.promise
      controller.abort()
      const exit = await exitPromise
      expect(transportSignal?.aborted).toBe(true)
      expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true)
      expect(calls).toBe(1)
    },
  )

  test("preserves typed failures for Effect recovery and the Promise boundary", async () => {
    const failure = new FunctionCallError("app.near", "check", "rejected", [
      "contract log",
    ])
    const rpc = testRpcPrograms("https://rpc.test", () =>
      Promise.reject(failure),
    )
    const recovered = await runPromise(
      rpc.viewFunction("app.near", "check").pipe(Effect.flip),
    )
    expect(recovered).toBe(failure)
    await expect(
      rpcToPromises(rpc).viewFunction("app.near", "check"),
    ).rejects.toBe(failure)
  })

  test("recovers an RPC-level account failure as the original domain class", async () => {
    let requests = 0
    const rpc = testRpcPrograms("https://rpc.test", async () => {
      requests++
      return Response.json({
        jsonrpc: "2.0",
        id: 1,
        error: {
          name: "HANDLER_ERROR",
          code: -32000,
          message: "unknown account",
          cause: {
            name: "UNKNOWN_ACCOUNT",
            info: { requested_account_id: "missing.near" },
          },
        },
      })
    })
    const missing = await runPromise(
      rpc.getAccount("missing.near").pipe(
        Effect.catchIf(
          (error): error is AccountDoesNotExistError =>
            error instanceof AccountDoesNotExistError,
          (error) => Effect.succeed(error.accountId),
        ),
      ),
    )
    expect(missing).toBe("missing.near")
    expect(requests).toBe(1)
  })

  test("shares request state across public and native APIs and preserves external rejection values", async () => {
    const requests: unknown[] = []
    const programs = testRpcPrograms("https://rpc.test", async (_, init) => {
      requests.push(init.body)
      return result({ gas_price: "10" })
    })
    const publicRpc = rpcToPromises(programs)
    await runPromise(programs.getGasPrice())
    await publicRpc.getGasPrice()
    await runPromise(programs.getGasPrice())
    expect(requests).toEqual(
      [1, 2, 3].map((id) =>
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          method: "gas_price",
          params: [null],
        }),
      ),
    )
    const rejection = { reason: "external provider rejection" }
    const externalRpc = {
      ...publicRpc,
      getGasPrice: () => Promise.reject(rejection),
    }
    await expect(
      runPromise(rpcFromPromises(externalRpc).getGasPrice()),
    ).rejects.toBe(rejection)
  })

  test("retains experimental fallback and caller-known contextual errors at the transport boundary", async () => {
    const methods: unknown[] = []
    const replies: unknown[] = [
      {
        error: {
          name: "REQUEST_VALIDATION_ERROR",
          code: -32601,
          message: "Method not found",
          cause: { name: "METHOD_NOT_FOUND" },
        },
      },
      {
        result: {
          protocol_version: 90,
          chain_id: "testnet",
          genesis_height: 0,
        },
      },
      {
        error: {
          name: "HANDLER_ERROR",
          code: -32000,
          message: "No global contract",
          cause: {
            name: "NO_GLOBAL_CONTRACT_CODE",
            info: { identifier: { AccountId: "unknown.near" } },
          },
        },
      },
      {
        error: {
          name: "HANDLER_ERROR",
          code: -32000,
          message: "Unknown gas key",
          cause: {
            name: "UNKNOWN_GAS_KEY",
            info: { public_key: "ed25519:unknown" },
          },
        },
      },
    ]
    const rpc = rpcToPromises(
      testRpcPrograms("https://rpc.test", async (_, init) => {
        methods.push(init.body)
        return Response.json(replies.shift())
      }),
    )
    expect(await rpc.genesisConfig()).toEqual({
      protocol_version: 90,
      chain_id: "testnet",
      genesis_height: 0,
    })
    expect(methods).toEqual([
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "genesis_config",
        params: [],
      }),
      JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "EXPERIMENTAL_genesis_config",
        params: [],
      }),
    ])
    await expect(
      rpc.viewGlobalContractCode({ accountId: "publisher.near" }),
    ).rejects.toMatchObject({ identifier: { accountId: "publisher.near" } })
    await expect(
      rpc.getGasKeyNonces("alice.near", "ed25519:actual"),
    ).rejects.toMatchObject({
      accountId: "alice.near",
      publicKey: "ed25519:actual",
    })
  })

  test("releases failed HTTP response bodies before retrying and retains the HTTP error", async () => {
    const events: string[] = []
    const rpc = testRpcPrograms(
      "https://rpc.test",
      async () => {
        events.push("fetch")
        return new Response(
          new ReadableStream({
            cancel() {
              events.push("cancel")
              throw new Error("body cleanup failed")
            },
          }),
          { status: 503, statusText: "Unavailable" },
        )
      },
      undefined,
      { maxRetries: 1, initialDelayMs: 0 },
    )
    await expect(runPromise(rpc.call("status", []))).rejects.toMatchObject({
      message: "HTTP 503: Unavailable",
      statusCode: 503,
    })
    expect(events).toEqual(["fetch", "cancel", "fetch", "cancel"])
  })
})

describe("native protocol decoding", () => {
  test("strips ordinary extra fields while retaining optional nulls and genesis extensions", async () => {
    const accountRpc = testRpcPrograms("https://rpc.test", async () =>
      result({
        ...account,
        global_contract_hash: null,
        global_contract_account_id: "publisher.near",
        future_field: true,
      }),
    )
    expect(await runPromise(accountRpc.getAccount("alice.near"))).toEqual({
      ...account,
      global_contract_hash: null,
      global_contract_account_id: "publisher.near",
    })
    const genesis = {
      protocol_version: 90,
      chain_id: "testnet",
      genesis_height: 0,
      runtime_config: { storage_amount_per_byte: "100" },
    }
    const genesisRpc = testRpcPrograms("https://rpc.test", async () =>
      result(genesis),
    )
    expect(await runPromise(genesisRpc.genesisConfig())).toEqual(genesis)
  })

  test.each([
    { payload: { ...account, storage_usage: "12" }, path: "storage_usage" },
    { payload: { error: 42 }, path: "error" },
  ])(
    "rejects malformed typed payloads at $path without retrying transport",
    async ({ payload, path }) => {
      let requests = 0
      const rpc = testRpcPrograms("https://rpc.test", async () => {
        requests++
        return result(payload)
      })
      const failure = await runPromise(
        (path === "error"
          ? rpc.getAccessKey("alice.near", "ed25519:key").pipe(Effect.asVoid)
          : rpc.getAccount("alice.near").pipe(Effect.asVoid)
        ).pipe(Effect.flip),
      )
      expect(failure).toBeInstanceOf(Schema.SchemaError)
      if (!(failure instanceof Schema.SchemaError))
        throw new Error("expected response validation failure")
      expect(failure.message).toContain(path)
      expect(requests).toBe(1)
    },
  )

  test("pulls state pages lazily and stops requesting after consumer termination", async () => {
    const requests: unknown[] = []
    const rpc = testRpcPrograms("https://rpc.test", async (_, init) => {
      requests.push(init.body)
      return result(
        requests.length === 1
          ? { values: [{ key: "YQ==", value: "MQ==" }], last_key: "YQ==" }
          : { values: [{ key: "Yg==", value: "Mg==" }], last_key: "Yg==" },
      )
    })
    const stream = rpc.viewStateAll("app.near", { limit: 1 })
    expect(requests).toEqual([])
    const entries = await runPromise(
      stream.pipe(Stream.take(2), Stream.runCollect),
    )
    expect(entries).toEqual([
      { key: "YQ==", value: "MQ==" },
      { key: "Yg==", value: "Mg==" },
    ])
    expect(requests).toEqual([
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "query",
        params: {
          request_type: "view_state",
          finality: "optimistic",
          account_id: "app.near",
          prefix_base64: "",
          limit: 1,
        },
      }),
      JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "query",
        params: {
          request_type: "view_state",
          finality: "optimistic",
          account_id: "app.near",
          prefix_base64: "",
          after_key_base64: "YQ==",
          limit: 1,
        },
      }),
    ])
  })
})

test("debug encoding failures retain network error classification and bounded retries", async () => {
  let encodings = 0
  let fetches = 0
  const circular: Record<string, unknown> = {}
  circular["self"] = circular
  const params = {
    toJSON() {
      encodings++
      return circular
    },
  }
  const program = Effect.gen(function* () {
    const rpc = yield* makeRpcPrograms(
      {
        url: "https://unused.invalid",
        retry: { maxRetries: 2, initialDelayMs: 0 },
      },
      fetchTransport(async () => {
        fetches++
        return result({})
      }),
    )
    return yield* rpc.call("query", params)
  }).pipe(
    Effect.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({ NEAR_RPC_DEBUG: "true" }),
      ),
    ),
  )
  await expect(runPromise(program)).rejects.toMatchObject({
    name: "NetworkError",
    code: "NETWORK_ERROR",
    message: expect.stringContaining("Network request failed:"),
    retryable: true,
  })
  expect({ fetches, encodings }).toEqual({ fetches: 0, encodings: 3 })
})

test.each([
  {
    cause: "INVALID_TRANSACTION",
    data: {
      TxExecutionError: {
        InvalidTxError: { InvalidNonce: { tx_nonce: "101", ak_nonce: 100 } },
      },
    },
    info: {},
    code: "NETWORK_ERROR",
  },
  {
    cause: "INVALID_TRANSACTION",
    data: {
      TxExecutionError: {
        InvalidTxError: { InvalidNonce: { tx_nonce: 101, ak_nonce: {} } },
      },
    },
    info: {},
    code: "NETWORK_ERROR",
  },
  {
    cause: "INVALID_TRANSACTION",
    data: {
      TxExecutionError: { InvalidTxError: { InvalidNonce: "malformed" } },
    },
    info: {},
    code: "NETWORK_ERROR",
  },
  {
    cause: "INVALID_TRANSACTION",
    data: { TxExecutionError: { InvalidTxError: { InvalidNonce: 7 } } },
    info: {},
    code: "NETWORK_ERROR",
  },
  {
    cause: "INVALID_TRANSACTION",
    data: { TxExecutionError: { InvalidTxError: { InvalidNonce: true } } },
    info: {},
    code: "NETWORK_ERROR",
  },
  {
    cause: "INVALID_TRANSACTION",
    data: { TxExecutionError: { InvalidTxError: { InvalidNonce: null } } },
    info: {},
    code: "INVALID_TRANSACTION",
  },
  {
    cause: "INVALID_TRANSACTION",
    data: { TxExecutionError: { InvalidTxError: null } },
    info: {},
    code: "INVALID_TRANSACTION",
  },
  {
    cause: "INVALID_TRANSACTION",
    data: { TxExecutionError: null },
    info: {},
    code: "INVALID_TRANSACTION",
  },
  {
    cause: "UNKNOWN_BLOCK",
    data: undefined,
    info: { block_reference: { block_id: { toString: 0, valueOf: 0 } } },
    code: "NETWORK_ERROR",
  },
  {
    cause: "UNKNOWN_CHUNK",
    data: undefined,
    info: { chunk_reference: { chunk_id: { toString: 0, valueOf: 0 } } },
    code: "NETWORK_ERROR",
  },
  {
    cause: "UNKNOWN_GAS_KEY",
    data: undefined,
    info: { public_key: { toString: 0, valueOf: 0 } },
    code: "NETWORK_ERROR",
  },
  {
    cause: "NO_CONTRACT_CODE",
    data: undefined,
    info: { account_id: { toString: 0, valueOf: 0 } },
    code: "NETWORK_ERROR",
  },
  {
    cause: "INVALID_SHARD_ID",
    data: undefined,
    info: { shard_id: { toString: 0, valueOf: 0 } },
    code: "NETWORK_ERROR",
  },
])(
  "keeps malformed $cause error details in the typed channel without retrying",
  async ({ cause, data, info, code }) => {
    const methods: string[] = []
    const rpc = testRpcPrograms(
      "https://rpc.test",
      async (_, init) => {
        if (typeof init.body !== "string")
          throw new Error("expected JSON request")
        methods.push(JSON.parse(init.body).method)
        return Response.json({
          error: {
            name: "HANDLER_ERROR",
            code: -32000,
            message: "invalid RPC error data",
            cause: { name: cause, info },
            data,
          },
        })
      },
      undefined,
      { maxRetries: 2, initialDelayMs: 0 },
    )
    // flip only recovers typed failures, so a TypeError defect fails this test.
    const failure = await runPromise(
      rpc.call<void>("query", {}).pipe(Effect.flip),
    )
    expect(methods).toEqual(["query"])
    expect(failure).toMatchObject({ code, retryable: false })
    if (code === "NETWORK_ERROR") {
      expect(failure.message).toBe("RPC error: invalid RPC error data")
    }
  },
)
