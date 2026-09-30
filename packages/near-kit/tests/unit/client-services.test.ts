import { Deferred, Effect, Fiber, Layer } from "effect"
import { TestClock } from "effect/testing"
import { expect, test } from "vitest"
import { Near as PromiseNear } from "../../src/core/near.js"
import { Client } from "../../src/effect/client.js"
import { KeyStore } from "../../src/effect/keys.js"
import { makeMemoryStorage } from "../../src/effect/key-storage.js"
import {
  makeNonceReservation,
  NonceReservation,
} from "../../src/effect/nonce.js"
import { Near } from "../../src/effect/near.js"
import { Rpc, RpcTransport } from "../../src/effect/rpc.js"
import { NetworkError } from "../../src/errors/index.js"
import { generateKey } from "../../src/utils/key.js"
import { testBlock, testBlockHash, testRpcPrograms } from "../helpers/rpc.js"

test("explicit client domains share reservations without reading the compatibility domain", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const key = generateKey()
      const keys = yield* makeMemoryStorage({ "alice.near": key.secretKey })
      const rpc = (nonce: number) =>
        testRpcPrograms("https://unused.invalid", async (_url, init) => {
          if (typeof init.body !== "string")
            throw new Error("Expected JSON request")
          const request: { id: number; method: string } = JSON.parse(init.body)
          return Response.json({
            jsonrpc: "2.0",
            id: request.id,
            result:
              request.method === "block"
                ? testBlock
                : {
                    nonce,
                    permission: "FullAccess",
                    block_height: 1,
                    block_hash: testBlockHash,
                  },
          })
        })
      const compatibility = new PromiseNear(
        {},
        { rpc: rpc(1000), keyStore: keys },
      )
      const previous = yield* Effect.promise(() =>
        compatibility
          .transaction("alice.near")
          .transfer("bob.near", 1n)
          .build(),
      )
      expect(previous.nonce).toBe(1001n)
      const shared = yield* makeNonceReservation
      const independent = yield* makeNonceReservation
      const build = (allocator: typeof shared) =>
        Effect.gen(function* () {
          const { service } = yield* Client
          return yield* service.transactions.build({
            signerId: "alice.near",
            receiverId: "bob.near",
            actions: [{ transfer: { deposit: 1n } }],
          })
        }).pipe(
          Effect.provide(
            Client.layer().pipe(
              Layer.provide(
                Layer.mergeAll(
                  Layer.succeed(Rpc, rpc(1)),
                  Layer.succeed(KeyStore, keys),
                  Layer.succeed(NonceReservation, allocator),
                ),
              ),
            ),
          ),
        )
      const [first, second] = yield* Effect.all(
        [build(shared), build(shared)],
        { concurrency: 2 },
      )
      if (first.version !== 0 || second.version !== 0)
        throw new Error("Expected ordinary V0 transactions")
      expect(
        [first.transaction.nonce, second.transaction.nonce].sort((a, b) =>
          a < b ? -1 : a > b ? 1 : 0,
        ),
      ).toEqual([2n, 3n])
      expect((yield* build(independent)).transaction.nonce).toBe(2n)
    }),
  )
})

test("client retries use the application's clock and release a cancelled delay", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const attempted = yield* Deferred.make<void>()
      let attempts = 0
      const transport = Layer.succeed(RpcTransport, {
        execute: () =>
          Effect.gen(function* () {
            attempts++
            yield* Deferred.succeed(attempted, undefined)
            return yield* Effect.fail(
              new NetworkError("fixture unavailable", undefined, true),
            )
          }),
      })
      const layer = Client.layer().pipe(
        Layer.provide(
          Layer.mergeAll(
            Rpc.layer({
              url: "https://unused.invalid",
              retry: { maxRetries: 3, initialDelayMs: 100 },
            }).pipe(Layer.provide(transport)),
            KeyStore.memory(),
            NonceReservation.layer,
          ),
        ),
      )
      const reading = Effect.gen(function* () {
        const near = yield* Near
        return yield* near.view("counter.near", "read")
      }).pipe(Effect.provide(layer))
      const fiber = yield* reading.pipe(Effect.forkScoped)
      yield* Deferred.await(attempted)
      yield* TestClock.adjust(99)
      expect(attempts).toBe(1)
      yield* TestClock.adjust(1)
      expect(attempts).toBe(2)
      yield* Fiber.interrupt(fiber)
      yield* TestClock.adjust(10_000)
      expect(attempts).toBe(2)
    }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
  )
})
