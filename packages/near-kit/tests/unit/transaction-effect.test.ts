import { sha256 } from "@noble/hashes/sha2.js"
import { Cause, Deferred, Effect, Exit } from "effect"
import { describe, expect, expectTypeOf, test, vi } from "vitest"
import { testRpcClient, testRpcPrograms } from "../helpers/rpc.js"
import {
  type DelegateActionResult,
  TransactionBuilder,
  type TransactionError,
} from "../../src/core/transaction.js"
import { transactionRpcFromPromises } from "../../src/core/rpc/rpc.js"
import type { KeyStore, Signature } from "../../src/core/types.js"
import { InvalidNonceError } from "../../src/errors/index.js"
import { ExternalError, fromPromise } from "../../src/effect/runtime.js"
import * as Transaction from "../../src/effect/transaction.js"
import { keyStoreService } from "../../src/effect/keys.js"
import { makeMemoryStorage } from "../../src/effect/key-storage.js"
import { makeNonceReservation } from "../../src/effect/nonce.js"
import { InMemoryKeyStore } from "../../src/keys/in-memory-keystore.js"
import { parseKey } from "../../src/utils/key.js"

const PRIVATE_KEY =
  "ed25519:3D4YudUahN1nawWogh8pAKSj92sUNMdbZGjn7kERKzYoTy8oryFtvLGoBnu1J6N4qVWY9jXwfLiNWnaTzKkHNfqG"
const plan = (
  overrides: Partial<Transaction.TransactionPlan> = {},
): Transaction.TransactionPlan => ({
  signerId: "alice.near",
  receiverId: "bob.near",
  actions: [{ transfer: { deposit: 10n ** 24n } }],
  ...overrides,
})
function setup() {
  const rpc = { ...testRpcClient("https://unused.invalid") }
  rpc.getBlock = async () =>
    ({ header: { hash: "11111111111111111111111111111111" } }) as never
  rpc.call = async () => ({ nonces: [10, 20, 30, 40, 50] }) as never
  const keyStore = new InMemoryKeyStore({ "alice.near": PRIVATE_KEY })
  const builder = new TransactionBuilder("alice.near", rpc, keyStore)
  const dependencies: Transaction.TransactionDependencies = {
    rpc: transactionRpcFromPromises(rpc),
    keyStore: keyStoreService(keyStore),
    nonces: Effect.runSync(makeNonceReservation),
  }
  return { builder, rpc, dependencies, keyStore }
}

// These immutable expected commitments were captured from the pre-migration
// Promise implementation at 2565579, independently of the native engine.
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
  ] as const)("%s preserves signed bytes", async (mode, hash, digest) => {
    const signed = await Effect.runPromise(
      Transaction.sign(
        plan({
          nonce: 42n,
          ...(mode === "strict"
            ? { strictNonce: true }
            : mode === "gas"
              ? { nonceIndex: 4 }
              : {}),
        }),
        setup().dependencies,
      ),
    )
    expect(signed.hash).toBe(hash)
    expect(Buffer.from(sha256(signed.serialize())).toString("hex")).toBe(digest)
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
  ] as const)(
    "%s preserves its domain-separated payload",
    async (mode, digest) => {
      const result = await Effect.runPromise(
        Transaction[mode](plan(), setup().dependencies, {
          nonce: 42n,
          maxBlockHeight: 200n,
          payloadFormat: "bytes",
        }),
      )
      expect(Buffer.from(sha256(result.payload)).toString("hex")).toBe(digest)
    },
  )
  test("keeps generic delegate payload inference", () => {
    const tx = Transaction.transactions(setup().dependencies)
    expectTypeOf(tx.delegate(plan(), { payloadFormat: "bytes" })).toEqualTypeOf<
      Effect.Effect<DelegateActionResult<"bytes">, TransactionError>
    >()
    expectTypeOf(tx.delegate(plan())).toEqualTypeOf<
      Effect.Effect<DelegateActionResult<"base64">, TransactionError>
    >()
  })
})

describe("Transaction execution ownership", () => {
  test("interrupts the block request before signing or broadcasting", async () => {
    const started = Promise.withResolvers<void>()
    let signal: AbortSignal | null | undefined
    const requests: string[] = []
    const events: string[] = []
    const rpc = testRpcPrograms("https://unused.invalid", (_url, init) => {
      if (typeof init.body !== "string")
        throw new Error("Expected JSON-RPC string body")
      requests.push(JSON.parse(init.body).method)
      events.push("block")
      signal = init.signal
      started.resolve()
      return new Promise<Response>((_resolve, reject) =>
        init.signal?.addEventListener(
          "abort",
          () => reject(new Error("aborted")),
          { once: true },
        ),
      )
    })
    const keys = Effect.runSync(
      makeMemoryStorage({ "alice.near": PRIVATE_KEY }),
    )
    const program = Transaction.send(plan({ nonce: 42n }), {
      rpc,
      nonces: Effect.runSync(makeNonceReservation),
      keyStore: {
        ...keys,
        get: (id) =>
          Effect.andThen(
            Effect.sync(() => events.push("key")),
            keys.get(id),
          ),
      },
      ready: Effect.sync(() => {
        events.push("ready")
      }),
    })
    expect(requests).toEqual([])
    expect(events).toEqual([])
    const controller = new AbortController()
    const running = Effect.runPromiseExit(program, {
      signal: controller.signal,
    })
    await started.promise
    controller.abort()
    const exit = await running
    expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true)
    expect(signal?.aborted).toBe(true)
    expect(requests).toEqual(["block"])
    expect(events).toEqual(["ready", "key", "block"])
  })

  test("ignores a late Promise-only signature after interruption", async () => {
    const { dependencies, rpc } = setup()
    const signature = Promise.withResolvers<Signature>()
    const started = Promise.withResolvers<void>()
    const send = vi.spyOn(rpc, "sendTransaction")
    const input = plan({
      nonce: 42n,
      signer: () =>
        fromPromise(() => {
          started.resolve()
          return signature.promise
        }, "test.signer"),
    })
    const controller = new AbortController()
    const running = Effect.runPromiseExit(
      Transaction.send(input, dependencies),
      { signal: controller.signal },
    )
    await started.promise
    controller.abort()
    const exit = await running
    signature.resolve(parseKey(PRIVATE_KEY).sign(new Uint8Array(32)))
    await Effect.runPromise(Effect.yieldNow)
    expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true)
    expect(send).not.toHaveBeenCalled()
  })

  test("keeps native signer acquisition and finalization in the calling fiber", async () => {
    const { dependencies, rpc } = setup()
    const started = Deferred.makeUnsafe<void>()
    const finalized = Deferred.makeUnsafe<void>()
    const send = vi.spyOn(rpc, "sendTransaction")
    const input = plan({
      nonce: 42n,
      signer: () =>
        Effect.andThen(Deferred.succeed(started, undefined), Effect.never).pipe(
          Effect.ensuring(Deferred.succeed(finalized, undefined)),
        ),
    })
    const controller = new AbortController()
    const running = Effect.runPromiseExit(
      Transaction.send(input, dependencies),
      { signal: controller.signal },
    )
    await Effect.runPromise(Deferred.await(started))
    controller.abort()
    await running
    expect(Effect.runSync(Deferred.isDone(finalized))).toBe(true)
    expect(send).not.toHaveBeenCalled()
  })

  test("accepts an external provider with an unrelated rpc metadata property", async () => {
    const provider = Object.assign(setup().rpc, { rpc: "provider metadata" })
    const builder = new TransactionBuilder(
      "alice.near",
      provider,
      new InMemoryKeyStore({ "alice.near": PRIVATE_KEY }),
    )
      .nonce(42n)
      .transfer("bob.near", "1 NEAR")
    await builder.sign()
    expect(builder.getHash()).toBe(
      "14p5Cg5kU2xFUs5KnkhKhJh6sUo4XtsmRvaf6DKcbsQb",
    )
  })

  test("preserves callback receivers at Promise-only extension boundaries", async () => {
    const receivers: unknown[] = []
    const key = parseKey(PRIVATE_KEY)
    const builder = new TransactionBuilder(
      "alice.near",
      setup().rpc,
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

  test("does not replay a signer that rejects InvalidNonce before broadcast", async () => {
    const { rpc } = setup()
    const key = parseKey(PRIVATE_KEY)
    const get = vi.fn(async () => key)
    const keyStore: KeyStore = {
      get,
      add: async () => {},
      remove: async () => {},
      list: async () => ["pre-submit-retry.near"],
    }
    const accessKey = vi.fn(async () => ({
      nonce: 10,
      permission: "FullAccess" as const,
      block_height: 1,
      block_hash: "11111111111111111111111111111111",
    }))
    rpc.getAccessKey = accessKey
    const block = vi.spyOn(rpc, "getBlock")
    const broadcast = vi.spyOn(rpc, "sendTransaction")
    const rejection = new InvalidNonceError(1, 2)
    const signer = vi.fn(async () => {
      throw rejection
    })
    const tx = new TransactionBuilder("pre-submit-retry.near", rpc, keyStore)
      .transfer("bob.near", "1 NEAR")
      .signWith(signer)
    await expect(tx.send()).rejects.toBe(rejection)
    expect(signer).toHaveBeenCalledTimes(1)
    expect(get).toHaveBeenCalledTimes(1)
    expect(accessKey).toHaveBeenCalledTimes(1)
    expect(block).toHaveBeenCalledTimes(1)
    expect(broadcast).not.toHaveBeenCalled()
    expect(tx.getHash()).toBeNull()
  })

  test("classifies synchronous KeyPair failures in the native error channel", async () => {
    const { dependencies, keyStore, builder } = setup()
    const key = parseKey(PRIVATE_KEY)
    const rejected = new Error("hardware key is unavailable")
    key.sign = () => {
      throw rejected
    }
    await keyStore.add("alice.near", key)
    const failure = await Effect.runPromise(
      Effect.flip(Transaction.sign(plan({ nonce: 42n }), dependencies)),
    )
    expect(failure).toBeInstanceOf(ExternalError)
    if (!(failure instanceof ExternalError))
      throw new Error("expected an extension failure")
    expect(failure.cause).toBe(rejected)
    await expect(
      builder.nonce(42n).transfer("bob.near", "1 NEAR").sign(),
    ).rejects.toBe(rejected)
  })

  test("exposes typed extension failures while preserving exact Promise rejection values", async () => {
    const { dependencies, builder } = setup()
    const rejection = { reason: "hardware signer rejected" }
    const signer = async () => {
      throw rejection
    }
    const failure = await Effect.runPromise(
      Effect.flip(
        Transaction.sign(
          plan({ nonce: 42n, signer: () => fromPromise(signer) }),
          dependencies,
        ),
      ),
    )
    expect(failure).toBeInstanceOf(ExternalError)
    expect((failure as ExternalError).cause).toBe(rejection)
    await expect(
      builder.nonce(42n).transfer("bob.near", "1 NEAR").signWith(signer).sign(),
    ).rejects.toBe(rejection)
  })
})

describe("Malformed transaction inputs and RPC data", () => {
  test.each([
    "classic block",
    "strict block",
    "access nonce",
    "gas nonce",
    "delegate offset",
  ] as const)(
    "%s fails through the native error channel before submission",
    async (scenario) => {
      const { rpc, dependencies } = setup()
      rpc.getAccessKey = async () =>
        ({ nonce: scenario === "access nonce" ? 1.5 : 1 }) as never
      rpc.getStatus = async () =>
        ({ sync_info: { latest_block_height: 100 } }) as never
      rpc.getBlock = async () => ({ header: { hash: "invalid!" } }) as never
      rpc.call = async () => ({ nonces: ["not-an-integer"] }) as never
      let submissions = 0
      rpc.sendTransaction = async () => {
        submissions++
        return {} as never
      }
      const input = plan({
        ...(scenario === "classic block" || scenario === "strict block"
          ? { nonce: 42n }
          : {}),
        ...(scenario === "strict block" ||
        scenario === "access nonce" ||
        scenario === "gas nonce"
          ? { strictNonce: true }
          : {}),
        ...(scenario === "gas nonce" ? { nonceIndex: 0 } : {}),
      })
      const program: Effect.Effect<unknown, TransactionError> =
        scenario === "delegate offset"
          ? Transaction.delegate(input, dependencies, {
              nonce: 42n,
              blockHeightOffset: 0.5,
            })
          : Transaction.send(input, dependencies)
      const exit = await Effect.runPromiseExit(program)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(Cause.hasFails(exit.cause)).toBe(true)
        expect(Cause.hasDies(exit.cause)).toBe(false)
      }
      expect(submissions).toBe(0)
    },
  )
})

test("malformed nonce-refresh hints fail recoverably without resubmission", async () => {
  const { rpc, dependencies } = setup()
  rpc.getAccessKey = async () => ({ nonce: 1 }) as never
  let submissions = 0
  rpc.sendTransaction = async () => {
    submissions++
    throw new InvalidNonceError(2, 1.5)
  }
  const exit = await Effect.runPromiseExit(
    Transaction.send(plan(), dependencies),
  )
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    expect(Cause.hasFails(exit.cause)).toBe(true)
    expect(Cause.hasDies(exit.cause)).toBe(false)
  }
  expect(submissions).toBe(1)
})

test.each([
  { nonce: 0n },
  { nonce: -1n },
  { nonce: 1n << 64n },
  { nonceIndex: -1 },
  { nonceIndex: 65536 },
  { nonceIndex: 1.5 },
])(
  "rejects invalid native nonce policy before key/network work (%s)",
  async (policy) => {
    const { dependencies, rpc, keyStore } = setup()
    const get = vi.spyOn(keyStore, "get")
    const block = vi.spyOn(rpc, "getBlock")
    const exit = await Effect.runPromiseExit(
      Transaction.send(plan(policy), dependencies),
    )
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(Cause.hasFails(exit.cause)).toBe(true)
      expect(Cause.hasDies(exit.cause)).toBe(false)
    }
    expect(get).not.toHaveBeenCalled()
    expect(block).not.toHaveBeenCalled()
  },
)

test("rejects an incomplete sign intent before touching signing authority", async () => {
  const { dependencies, keyStore } = setup()
  const get = vi.spyOn(keyStore, "get")
  await expect(
    Effect.runPromise(
      Transaction.sign({ signerId: "alice.near", actions: [] }, dependencies),
    ),
  ).rejects.toThrow("No receiver ID set")
  expect(get).not.toHaveBeenCalled()
})
