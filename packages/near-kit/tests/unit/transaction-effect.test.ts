import { sha256 } from "@noble/hashes/sha2.js"
import { Effect } from "effect"
import { describe, expect, expectTypeOf, test, vi } from "vitest"
import { RpcClient } from "../../src/core/rpc/rpc.js"
import {
  type DelegateActionResult,
  TransactionBuilder,
  type TransactionError,
} from "../../src/core/transaction.js"
import type { Signature } from "../../src/core/types.js"
import { ExternalError } from "../../src/effect/runtime.js"
import { transaction } from "../../src/effect/transaction.js"
import { InMemoryKeyStore } from "../../src/keys/in-memory-keystore.js"
import { parseKey } from "../../src/utils/key.js"

const PRIVATE_KEY =
  "ed25519:3D4YudUahN1nawWogh8pAKSj92sUNMdbZGjn7kERKzYoTy8oryFtvLGoBnu1J6N4qVWY9jXwfLiNWnaTzKkHNfqG"

function setup() {
  const rpc = new RpcClient("https://unused.invalid")
  rpc.getBlock = async () =>
    ({ header: { hash: "11111111111111111111111111111111" } }) as never
  rpc.call = async () => ({ nonces: [10, 20, 30, 40, 50] }) as never
  const keyStore = new InMemoryKeyStore({ "alice.near": PRIVATE_KEY })
  const builder = new TransactionBuilder("alice.near", rpc, keyStore)
  return { builder, rpc }
}

// Captured from the pre-migration Promise implementation at 2565579 using the
// exact fixed key, zero block hash, transfer, nonce and expiry below. These
// independent byte commitments guard the native wrapper and wire migration;
// unlike round-trips, they fail if both encoder and decoder drift together.
describe("Effect-native transaction wire compatibility", () => {
  test.each([
    [
      "classic",
      "14p5Cg5kU2xFUs5KnkhKhJh6sUo4XtsmRvaf6DKcbsQb",
      "779233f1476b0e743291de442124c52a4bfb2fee8c36f4f64bd5647c92210b30",
    ],
    [
      "strict",
      "DSZB77hWoJ11Lh5MT6c1TUqXZgCw66TJZQevjDGpBgHU",
      "201252cd972db322531e4c393adff3e3bfbc1f8f7d18bcaac39b20a95bf9189a",
    ],
    [
      "gas",
      "HVnTQVLTyiavPU99oPw7Myv7YkoYtaj4kX5zKVM57uNr",
      "2bd8dca582cc982507027f172a94976a5e8743db417217b579817d252ecb8020",
    ],
  ] as const)("%s preserves signed bytes and shares the Promise facade cache", async (mode, hash, wireDigest) => {
    const { builder } = setup()
    const tx = transaction(builder).nonce(42n).transfer("bob.near", "1 NEAR")
    if (mode === "strict") tx.strictNonceMode()
    if (mode === "gas") tx.useGasKey(4)
    expect(tx.getHash()).toBeNull()
    expect(await Effect.runPromise(tx.sign())).toBe(tx)
    expect(tx.getHash()).toBe(hash)
    expect(Buffer.from(sha256(tx.serialize())).toString("hex")).toBe(wireDigest)
    // A second facade sign must use the same committed bytes, not allocate or
    // sign again, and the native view must expose that identical shared state.
    await builder.sign()
    expect(builder.serialize()).toEqual(tx.serialize())
  })

  test.each([
    [
      "delegate",
      "9a2ff457d85eaf9cd6679b017ef62cff32e2207d538b06a26200fea2720b65d4",
    ],
    [
      "delegateV2",
      "86f3246de20c1a20696ef765e344320961a1f512deb3143c0a9f944406382dc5",
    ],
  ] as const)("%s preserves its domain-separated payload", async (mode, digest) => {
    const tx = transaction(setup().builder).transfer("bob.near", "1 NEAR")
    const options = {
      nonce: 42n,
      maxBlockHeight: 200n,
      payloadFormat: "bytes" as const,
    }
    const result =
      mode === "delegate"
        ? await Effect.runPromise(tx.delegate(options))
        : await Effect.runPromise(tx.delegateV2(options))
    expect(Buffer.from(sha256(result.payload)).toString("hex")).toBe(digest)
  })

  test("keeps generic delegate payload inference", () => {
    const tx = transaction(setup().builder).transfer("bob.near", "1 NEAR")
    expectTypeOf(tx.delegate({ payloadFormat: "bytes" })).toEqualTypeOf<
      Effect.Effect<DelegateActionResult<"bytes">, TransactionError>
    >()
    expectTypeOf(tx.delegate()).toEqualTypeOf<
      Effect.Effect<DelegateActionResult<"base64">, TransactionError>
    >()
  })
})

describe("Transaction execution ownership", () => {
  test("interrupts the block request before signing or broadcasting", async () => {
    const started = Promise.withResolvers<void>()
    let requestSignal: AbortSignal | null | undefined
    const requests: string[] = []
    const rpc = RpcClient.withTransport(
      "https://unused.invalid",
      (_url, init) => {
        requests.push(JSON.parse(String(init?.body)).method)
        requestSignal = init?.signal
        started.resolve()
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true },
          )
        })
      },
    )
    const tx = transaction(
      new TransactionBuilder("alice.near", rpc, new InMemoryKeyStore()),
    )
      .signWith(PRIVATE_KEY)
      .nonce(42n)
      .transfer("bob.near", "1 NEAR")
    const program = tx.send()
    expect(requests).toEqual([])
    const controller = new AbortController()
    const running = Effect.runPromiseExit(program, {
      signal: controller.signal,
    })
    await started.promise
    controller.abort()
    await running
    expect(requestSignal?.aborted).toBe(true)
    expect(requests).toEqual(["block"])
    expect(tx.getHash()).toBeNull()
  })

  test("ignores a late Promise-only signature after interruption", async () => {
    const { builder, rpc } = setup()
    const signature = Promise.withResolvers<Signature>()
    const started = Promise.withResolvers<void>()
    const send = vi.spyOn(rpc, "sendTransaction")
    const tx = transaction(builder)
      .nonce(42n)
      .transfer("bob.near", "1 NEAR")
      .signWith(async () => {
        started.resolve()
        return signature.promise
      })
    const controller = new AbortController()
    const running = Effect.runPromiseExit(tx.send(), {
      signal: controller.signal,
    })
    await started.promise
    controller.abort()
    await running
    signature.resolve(parseKey(PRIVATE_KEY).sign(new Uint8Array(32)))
    await Effect.runPromise(Effect.yieldNow)
    expect(tx.getHash()).toBeNull()
    expect(send).not.toHaveBeenCalled()
  })

  test("preserves callback receivers at Promise-only extension boundaries", async () => {
    const { rpc } = setup()
    const receivers: unknown[] = []
    const key = parseKey(PRIVATE_KEY)
    const builder = new TransactionBuilder(
      "alice.near",
      rpc,
      new InMemoryKeyStore({ "alice.near": PRIVATE_KEY }),
      async function (this: TransactionBuilder, message) {
        receivers.push(this)
        return key.sign(message)
      },
      "EXECUTED_OPTIMISTIC",
      undefined,
      async function (this: TransactionBuilder) {
        receivers.push(this)
      },
    )
    await builder.nonce(42n).transfer("bob.near", "1 NEAR").sign()
    expect(receivers).toEqual([builder, builder])
  })

  test("classifies synchronous KeyPair failures in the native error channel", async () => {
    const { rpc } = setup()
    const key = parseKey(PRIVATE_KEY)
    const rejected = new Error("hardware key is unavailable")
    key.sign = () => {
      throw rejected
    }
    const keyStore = new InMemoryKeyStore()
    await keyStore.add("alice.near", key)
    const builder = new TransactionBuilder("alice.near", rpc, keyStore)
      .nonce(42n)
      .transfer("bob.near", "1 NEAR")
    const failure = await Effect.runPromise(Effect.flip(builder.signEffect()))
    expect(failure).toBeInstanceOf(ExternalError)
    if (!(failure instanceof ExternalError))
      throw new Error("expected an extension failure")
    expect(failure.cause).toBe(rejected)
    await expect(builder.sign()).rejects.toBe(rejected)
  })

  test("exposes typed extension failures while preserving exact Promise rejection values", async () => {
    const { builder } = setup()
    const rejection = { reason: "hardware signer rejected" }
    builder
      .nonce(42n)
      .transfer("bob.near", "1 NEAR")
      .signWith(async () => {
        throw rejection
      })
    const failure = await Effect.runPromise(Effect.flip(builder.signEffect()))
    expect(failure).toBeInstanceOf(ExternalError)
    expect((failure as ExternalError).cause).toBe(rejection)
    await expect(builder.sign()).rejects.toBe(rejection)
  })
})
