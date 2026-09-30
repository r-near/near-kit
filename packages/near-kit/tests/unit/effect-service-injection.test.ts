import { Effect, Layer } from "effect"
import { describe, expect, test, vi } from "vitest"
import { Near as PromiseNear } from "../../src/core/near.js"
import type {
  BlockView,
  KeyStore as PromiseKeyStore,
} from "../../src/core/types.js"
import { KeyStore } from "../../src/effect/keys.js"
import { Near } from "../../src/effect/near.js"
import {
  makeNonceReservation,
  NonceReservation,
} from "../../src/effect/nonce.js"
import { Rpc } from "../../src/effect/rpc.js"
import { InMemoryKeyStore } from "../../src/keys/in-memory-keystore.js"
import { generateKey } from "../../src/utils/key.js"
import type { PrivateKey } from "../../src/utils/validation.js"
import { testRpcPrograms } from "../helpers/rpc.js"

describe("native client dependency ownership", () => {
  test("injected key and reservation services actually determine the unsigned transaction", async () => {
    const key = generateKey()
    const store = new InMemoryKeyStore()
    await store.add("alice.near", key)
    const nonces = Effect.runSync(makeNonceReservation)
    expect(
      Effect.runSync(
        nonces.updateAndGetNext("alice.near", key.publicKey.toString(), 1000n),
      ),
    ).toBe(1001n)
    let blockCalls = 0
    const programs = {
      ...testRpcPrograms("https://unused.invalid"),
      getBlock: () =>
        Effect.sync(() => {
          blockCalls++
          // The signing boundary only consumes this header; RPC decoding has its own tests.
          return {
            header: { hash: "11111111111111111111111111111111", height: 1 },
          } as BlockView
        }),
    }
    const layer = Near.layerWithServices({
      defaultSignerId: "alice.near",
    }).pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(Rpc, programs),
          KeyStore.layer(store),
          Layer.succeed(NonceReservation, nonces),
        ),
      ),
    )
    const unsigned = await Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* Near
        return yield* client
          .transaction("alice.near")
          .transfer("bob.near", "1 NEAR")
          .build()
      }).pipe(Effect.provide(layer)),
    )
    expect(unsigned.publicKey.toString()).toBe(key.publicKey.toString())
    expect(unsigned.nonce).toBe(1002n)
    expect(blockCalls).toBe(1)
  })

  test("the synchronous constructor starts a caller-owned key-store write eagerly", async () => {
    const key = generateKey()
    const add = vi.fn(() => Promise.resolve())
    const store: PromiseKeyStore = {
      add,
      get: async () => null,
      remove: async () => {},
      list: async () => [],
    }
    const near = new PromiseNear({
      keyStore: store,
      privateKey: key.secretKey as PrivateKey,
      defaultSignerId: "alice.near",
    })
    expect(add).toHaveBeenCalledTimes(1)
    await Effect.runPromise(near.ready)
    expect(add).toHaveBeenCalledTimes(1)
  })
})
