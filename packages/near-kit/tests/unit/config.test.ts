import { Cause, ConfigProvider, Effect, Exit, Schema } from "effect"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { Near } from "../../src/core/near.js"
import type { NearConfig } from "../../src/core/config-schemas.js"
import { make } from "../../src/effect/near.js"
import { generateKey } from "../../src/utils/key.js"

beforeEach(() => vi.stubEnv("NEAR_NETWORK", undefined))
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})
const reply = () =>
  Response.json({ jsonrpc: "2.0", id: 1, result: { gas_price: "10" } })

describe("public configuration at the transport boundary", () => {
  test.each([
    ["default", {}, "https://free.rpc.fastnear.com"],
    ["mainnet", { network: "mainnet" }, "https://free.rpc.fastnear.com"],
    ["testnet", { network: "testnet" }, "https://rpc.testnet.fastnear.com"],
    ["localnet", { network: "localnet" }, "http://localhost:3030"],
    ["betanet", { network: "betanet" }, "https://rpc.betanet.near.org"],
    [
      "custom",
      { network: { rpcUrl: "https://custom.example", networkId: "custom" } },
      "https://custom.example",
    ],
    [
      "override",
      { network: "mainnet", rpcUrl: "https://override.example" },
      "https://override.example",
    ],
    [
      "explicit undefined",
      { network: undefined, headers: undefined, retryConfig: undefined },
      "https://free.rpc.fastnear.com",
    ],
  ] satisfies Array<[string, NearConfig, string]>)(
    "%s routes actual requests",
    async (_name, config, url) => {
      const fetch = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(async () => reply())
      expect(await new Near(config).rpc.getGasPrice()).toEqual({
        gas_price: "10",
      })
      expect(fetch.mock.calls[0]?.[0]).toBe(url)
    },
  )

  test("headers and retry configuration control the actual request", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(reply())
    const near = new Near({
      headers: { "X-Test": "value" },
      retryConfig: { maxRetries: 1, initialDelayMs: 0 },
    })
    expect(await near.rpc.getGasPrice()).toEqual({ gas_price: "10" })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls[1]?.[1]?.headers).toMatchObject({
      "X-Test": "value",
    })
  })

  test("account-key records actually supply message signing", async () => {
    const key = generateKey()
    const near = new Near({
      keyStore: { "alice.near": key.secretKey },
      defaultSignerId: "alice.near",
    })
    const signed = await near.signMessage({
      message: "configuration",
      recipient: "app.near",
      nonce: new Uint8Array(32),
    })
    expect(signed.publicKey).toBe(key.publicKey.toString())
  })
})

describe("configuration failures", () => {
  test.each([
    ["unknown preset", { network: "invalid" }],
    ["invalid RPC URL", { rpcUrl: "not-a-url" }],
    ["invalid custom URL", { network: { rpcUrl: "bad", networkId: "custom" } }],
    [
      "empty network ID",
      { network: { rpcUrl: "https://custom.example", networkId: "" } },
    ],
    ["negative retries", { retryConfig: { maxRetries: -1 } }],
    ["fractional delay", { retryConfig: { initialDelayMs: 1.5 } }],
    ["invalid headers", { headers: { "X-Test": 42 } }],
    ["unsupported path-string keyStore", { keyStore: "~/.near-credentials" }],
    ["non-callable signer", { signer: {} }],
  ])(
    "%s fails synchronously publicly and recoverably natively",
    async (_name, value) => {
      // Exercise untrusted JavaScript inputs, not a well-typed application fixture.
      const config = value as NearConfig
      const fetch = vi.spyOn(globalThis, "fetch")
      expect(() => new Near(config)).toThrow(Schema.SchemaError)
      const exit = await Effect.runPromiseExit(make(config))
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(Cause.hasFails(exit.cause)).toBe(true)
        expect(Cause.hasDies(exit.cause)).toBe(false)
        expect(Cause.squash(exit.cause)).toBeInstanceOf(Schema.SchemaError)
      }
      expect(fetch).not.toHaveBeenCalled()
    },
  )
})

describe("network configuration ownership", () => {
  test.each([
    ["mainnet", "https://free.rpc.fastnear.com"],
    ["testnet", "https://rpc.testnet.fastnear.com"],
    ["localnet", "http://localhost:3030"],
    ["betanet", "https://rpc.betanet.near.org"],
    ["invalid", "https://free.rpc.fastnear.com"],
  ])(
    "public construction reads current NEAR_NETWORK=%s",
    async (network, url) => {
      vi.stubEnv("NEAR_NETWORK", network)
      const fetch = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(async () => reply())
      await new Near().rpc.getGasPrice()
      expect(fetch.mock.calls[0]?.[0]).toBe(url)
    },
  )

  test("native construction uses its injected provider, not ambient process state", async () => {
    vi.stubEnv("NEAR_NETWORK", "mainnet")
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => reply())
    const program = make().pipe(
      Effect.flatMap((near) => near.rpc.getGasPrice()),
      Effect.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({ NEAR_NETWORK: "testnet" }),
        ),
      ),
    )
    expect(fetch).not.toHaveBeenCalled()
    expect(await Effect.runPromise(program)).toEqual({ gas_price: "10" })
    expect(fetch.mock.calls[0]?.[0]).toBe("https://rpc.testnet.fastnear.com")
  })
})
