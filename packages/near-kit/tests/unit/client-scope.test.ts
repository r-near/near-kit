import { Cause, Deferred, Effect, Exit, Fiber, Layer, Stream } from "effect"
import { expect, test } from "vitest"
import { Near as PromiseNear } from "../../src/core/near.js"
import { Client } from "../../src/effect/client.js"
import { KeyStore } from "../../src/effect/keys.js"
import { makeMemoryStorage } from "../../src/effect/key-storage.js"
import { Near } from "../../src/effect/near.js"
import { NonceReservation } from "../../src/effect/nonce.js"
import { Rpc, RpcTransport } from "../../src/effect/rpc.js"
import { ExternalError } from "../../src/effect/runtime.js"
import { Wallet, type WalletAccountState } from "../../src/effect/wallet.js"
import { fetchTransport } from "../../src/core/rpc/rpc-program.js"

function fixture() {
  const acquired: string[] = []
  const released: string[] = []
  const own = <A, E, R>(name: string, value: Effect.Effect<A, E, R>) =>
    Effect.acquireRelease(
      value.pipe(Effect.tap(() => Effect.sync(() => acquired.push(name)))),
      () =>
        Effect.sync(() => {
          released.push(name)
        }),
    )
  const transport = Layer.effect(
    RpcTransport,
    own(
      "transport",
      Effect.succeed(
        fetchTransport(async () =>
          Response.json({
            jsonrpc: "2.0",
            id: 1,
            result: {
              result: [55],
              logs: [],
              block_height: 1,
              block_hash: "block",
            },
          }),
        ),
      ),
    ),
  )
  const keys = Layer.effect(KeyStore, own("keys", makeMemoryStorage()))
  const observed: WalletAccountState = {
    _tag: "Ready",
    accounts: [{ accountId: "alice.near" }],
  }
  const wallet = Layer.succeed(
    Wallet,
    Wallet.of({
      getAccounts: () =>
        Effect.die("The scoped client must read its owned observer"),
      signAndSendTransaction: () =>
        Effect.die("This lifecycle fixture does not submit"),
      observeAccounts: () =>
        own(
          "wallet",
          Effect.succeed({
            ready: Effect.void,
            get: () => Effect.succeed(observed),
            changes: Stream.make(observed),
          }),
        ),
    }),
  )
  const layer = Client.layer(
    {},
    Effect.map(Wallet, (wallet) => ({ wallet })),
  ).pipe(
    Layer.provide(
      Layer.mergeAll(
        Rpc.layer({ url: "https://unused.invalid" }).pipe(
          Layer.provide(transport),
        ),
        keys,
        NonceReservation.layer,
        wallet,
      ),
    ),
  )
  return { acquired, released, layer }
}

test.each(["success", "failure", "interruption"] as const)(
  "one scoped client releases its capabilities after %s",
  async (ending) => {
    const state = fixture()
    const failure = new ExternalError({
      operation: "application",
      cause: "stop",
    })
    await Effect.runPromise(
      Effect.gen(function* () {
        const ready = yield* Deferred.make<void>()
        const operation = Effect.gen(function* () {
          const client = yield* Client
          const near = yield* Near
          expect(yield* near.view("counter.near", "read")).toBe(7)
          expect(yield* near.view("counter.near", "read")).toBe(7)
          expect(yield* near.getConnectedAccountId()).toBe("alice.near")
          expect(yield* near.getConnectedAccountId()).toBe("alice.near")
          // Projection must borrow precisely this acquisition, with no extra ready work.
          const facade = PromiseNear.fromClient(client)
          expect(facade.effects).toBe(near)
          expect(
            yield* Effect.promise(() => facade.view("counter.near", "read")),
          ).toBe(7)
          expect(state.acquired.slice().sort()).toEqual([
            "keys",
            "transport",
            "wallet",
          ])
          expect(state.released).toEqual([])
          yield* Deferred.succeed(ready, undefined)
          if (ending === "failure") return yield* failure
          if (ending === "interruption") return yield* Effect.never
        }).pipe(Effect.provide(state.layer))
        const fiber = yield* operation.pipe(Effect.forkScoped)
        yield* Deferred.await(ready)
        if (ending === "interruption") yield* Fiber.interrupt(fiber)
        const exit = yield* Fiber.await(fiber)
        if (ending === "failure") expect(exit).toEqual(Exit.fail(failure))
        else if (ending === "interruption") {
          expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(
            true,
          )
        } else expect(Exit.isSuccess(exit)).toBe(true)
        expect(state.released.slice().sort()).toEqual([
          "keys",
          "transport",
          "wallet",
        ])
      }).pipe(Effect.scoped),
    )
  },
)
