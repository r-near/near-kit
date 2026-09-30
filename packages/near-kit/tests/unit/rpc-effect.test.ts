import { Cause, Clock, Effect, Exit, Fiber, Layer, Stream } from "effect"
import { TestClock } from "effect/testing"
import { afterEach, describe, expect, test, vi } from "vitest"
import { ZodError } from "zod"
import { RpcClient, type RpcFetch } from "../../src/core/rpc/rpc.js"
import { Rpc, RpcTransport } from "../../src/effect/rpc.js"
import { runPromise } from "../../src/effect/runtime.js"
import {
  AccessKeyDoesNotExistError,
  AccountDoesNotExistError,
  FunctionCallError,
  GlobalContractNotFoundError,
  NetworkError,
} from "../../src/errors/index.js"

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

  test("keeps effects lazy and re-execution allocates distinct request IDs", async () => {
    const requests: unknown[] = []
    const rpc = RpcClient.withTransport("https://rpc.test", async (_, init) => {
      requests.push(init.body)
      return result({ gas_price: "10" })
    })
    const program = rpc.getGasPriceEffect()
    expect(requests).toEqual([])
    await runPromise(program)
    await runPromise(program)
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
        const rpc = RpcClient.withTransport(
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
          .sendTransactionEffect(new Uint8Array([1, 2, 3]), "NONE")
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
        const rpc = RpcClient.withTransport(
          "https://rpc.test",
          async () => {
            attempts++
            return new Response("unavailable", { status: 503 })
          },
          undefined,
          { maxRetries: 4, initialDelayMs: 100 },
        )
        const fiber = yield* rpc.callEffect("status", []).pipe(Effect.forkChild)
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

  test.each([
    "fetch",
    "body",
  ] as const)("cancels the transport while awaiting %s without retrying", async (phase) => {
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
    const rpc = RpcClient.withTransport(
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
    const exitPromise = Effect.runPromiseExit(rpc.callEffect("status", []), {
      signal: controller.signal,
    })
    await started.promise
    controller.abort()
    const exit = await exitPromise
    expect(transportSignal?.aborted).toBe(true)
    expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true)
    expect(calls).toBe(1)
  })

  test("preserves typed failures for Effect recovery and the Promise boundary", async () => {
    const failure = new FunctionCallError("app.near", "check", "rejected", [
      "contract log",
    ])
    const rpc = RpcClient.withTransport("https://rpc.test", () =>
      Promise.reject(failure),
    )
    const recovered = await runPromise(
      rpc.viewFunctionEffect("app.near", "check").pipe(Effect.flip),
    )
    expect(recovered).toBe(failure)
    await expect(rpc.viewFunction("app.near", "check")).rejects.toBe(failure)
  })

  test("recovers an RPC-level account failure as the original domain class", async () => {
    let requests = 0
    const rpc = RpcClient.withTransport("https://rpc.test", async () => {
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
      rpc.getAccountEffect("missing.near").pipe(
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

  test("honors public decorations that call the original method without recursion", async () => {
    const rpc = RpcClient.withTransport("https://rpc.test", async () =>
      result({ gas_price: "10" }),
    )
    const original = rpc.getGasPrice.bind(rpc)
    vi.spyOn(RpcClient.prototype, "getGasPrice").mockImplementation(
      async function (this: RpcClient, blockId) {
        const value = await original(blockId)
        return { gas_price: `${value.gas_price}0` }
      },
    )
    expect(await runPromise(rpc.getGasPriceEffect())).toEqual({
      gas_price: "100",
    })
    const rejection = { reason: "external provider rejection" }
    rpc.getGasPrice = () => Promise.reject(rejection)
    await expect(runPromise(rpc.getGasPriceEffect())).rejects.toBe(rejection)
  })
  test("retains legacy method fallback and contextual errors through overridden calls", async () => {
    const methods: unknown[] = []
    const rpc = RpcClient.withTransport("https://rpc.test", async (_, init) => {
      methods.push(init.body)
      return result({
        protocol_version: 90,
        chain_id: "testnet",
        genesis_height: 0,
      })
    })
    const original = rpc.call.bind(rpc)
    rpc.call = (method, params) =>
      method === "genesis_config"
        ? Promise.reject(new NetworkError("Method not found", -32601, false))
        : original(method, params)
    expect(await rpc.genesisConfig()).toEqual({
      protocol_version: 90,
      chain_id: "testnet",
      genesis_height: 0,
    })
    expect(methods).toEqual([
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "EXPERIMENTAL_genesis_config",
        params: [],
      }),
    ])
    rpc.call = () =>
      Promise.reject(
        new GlobalContractNotFoundError({ accountId: "unknown.near" }),
      )
    await expect(
      rpc.viewGlobalContractCode({ accountId: "publisher.near" }),
    ).rejects.toMatchObject({ identifier: { accountId: "publisher.near" } })
    rpc.call = () =>
      Promise.reject(
        new AccessKeyDoesNotExistError("unknown.near", "ed25519:unknown"),
      )
    await expect(
      rpc.getGasKeyNonces("alice.near", "ed25519:actual"),
    ).rejects.toMatchObject({
      accountId: "alice.near",
      publicKey: "ed25519:actual",
    })
  })

  test("releases failed HTTP response bodies before retrying and retains the HTTP error", async () => {
    const events: string[] = []
    const rpc = RpcClient.withTransport(
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
    await expect(rpc.call("status", [])).rejects.toMatchObject({
      message: "HTTP 503: Unavailable",
      statusCode: 503,
    })
    expect(events).toEqual(["fetch", "cancel", "fetch", "cancel"])
  })
})

describe("native protocol decoding", () => {
  test("strips ordinary extra fields while retaining optional nulls and genesis extensions", async () => {
    const accountRpc = RpcClient.withTransport("https://rpc.test", async () =>
      result({
        ...account,
        global_contract_hash: null,
        global_contract_account_id: "publisher.near",
        future_field: true,
      }),
    )
    expect(await accountRpc.getAccount("alice.near")).toEqual({
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
    const genesisRpc = RpcClient.withTransport("https://rpc.test", async () =>
      result(genesis),
    )
    expect(await runPromise(genesisRpc.genesisConfigEffect())).toEqual(genesis)
  })

  test("rejects malformed typed payloads as ZodError without retrying transport", async () => {
    let requests = 0
    const rpc = RpcClient.withTransport("https://rpc.test", async () => {
      requests++
      return result({ ...account, storage_usage: "12" })
    })
    const failure = await runPromise(
      rpc.getAccountEffect("alice.near").pipe(Effect.flip),
    )
    expect(failure).toBeInstanceOf(ZodError)
    if (!(failure instanceof ZodError))
      throw new Error("expected response validation failure")
    expect(failure.issues).toEqual([
      expect.objectContaining({
        code: "invalid_type",
        path: ["storage_usage"],
      }),
    ])
    expect(requests).toBe(1)
  })

  test("pulls state pages lazily and stops requesting after consumer termination", async () => {
    const requests: unknown[] = []
    const rpc = RpcClient.withTransport("https://rpc.test", async (_, init) => {
      requests.push(init.body)
      return result(
        requests.length === 1
          ? { values: [{ key: "YQ==", value: "MQ==" }], last_key: "YQ==" }
          : { values: [{ key: "Yg==", value: "Mg==" }], last_key: "Yg==" },
      )
    })
    const stream = rpc.viewStateAllStream("app.near", { limit: 1 })
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
