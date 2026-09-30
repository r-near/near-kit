import {
  Cause,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Option,
  Stream,
} from "effect"
import { expect, test } from "vitest"
import { Near as PromiseNear } from "../../src/core/near.js"
import { Client } from "../../src/effect/client.js"
import { KeyStore } from "../../src/effect/keys.js"
import { makeMemoryStorage } from "../../src/effect/key-storage.js"
import { Near } from "../../src/effect/near.js"
import { NonceReservation } from "../../src/effect/nonce.js"
import { Rpc, RpcTransport } from "../../src/effect/rpc.js"
import { ExternalError } from "../../src/effect/runtime.js"
import {
  Wallet,
  type WalletAccountState,
  type WalletService,
} from "../../src/effect/wallet.js"
import type { SignMessageParams } from "../../src/core/types.js"
import { fetchTransport } from "../../src/core/rpc/rpc-program.js"
import { generateKey } from "../../src/utils/key.js"

function fixture(
  initialization?: Effect.Effect<void, ExternalError>,
  suppliedWallet?: WalletService,
) {
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
  const keys = Layer.effect(
    KeyStore,
    own("keys", makeMemoryStorage()).pipe(
      Effect.map((store) =>
        initialization ? { ...store, add: () => initialization } : store,
      ),
    ),
  )
  const observed: WalletAccountState = {
    _tag: "Ready",
    accounts: [{ accountId: "alice.near" }],
  }
  const wallet = Layer.succeed(
    Wallet,
    suppliedWallet ??
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
  const generated = generateKey().secretKey
  const privateKey: `ed25519:${string}` = `ed25519:${generated.slice("ed25519:".length)}`
  const layer = Client.layer(
    initialization ? { privateKey, defaultSignerId: "alice.near" } : {},
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
        if (ending === "failure")
          expect(
            Exit.isFailure(exit)
              ? Option.getOrThrow(Cause.findErrorOption(exit.cause))
              : undefined,
          ).toBe(failure)
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

test.each(["failure", "interruption"] as const)(
  "key readiness %s releases resources before exposing the client",
  async (ending) => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const entered = yield* Deferred.make<void>()
        const failure = new ExternalError({
          operation: "KeyStore.add",
          cause: new Error("write failed"),
        })
        const state = fixture(
          Deferred.succeed(entered, undefined).pipe(
            Effect.andThen(ending === "failure" ? failure : Effect.never),
          ),
        )
        let exposed = false
        const acquisition = Effect.gen(function* () {
          yield* Client
          exposed = true
        }).pipe(Effect.provide(state.layer))
        const fiber = yield* acquisition.pipe(Effect.forkScoped)
        yield* Deferred.await(entered)
        if (ending === "interruption") yield* Fiber.interrupt(fiber)
        const exit = yield* Fiber.await(fiber)
        expect(exposed).toBe(false)
        if (ending === "failure")
          expect(
            Exit.isFailure(exit)
              ? Option.getOrThrow(Cause.findErrorOption(exit.cause))
              : undefined,
          ).toBe(failure)
        else
          expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(
            true,
          )
        expect(state.acquired.slice().sort()).toEqual([
          "keys",
          "transport",
          "wallet",
        ])
        expect(state.released.slice().sort()).toEqual([
          "keys",
          "transport",
          "wallet",
        ])
      }).pipe(Effect.scoped),
    )
  },
)

test("a scoped client preserves prototype wallet operations and their private receiver", async () => {
  const key = generateKey()
  const signMessage = key.signNep413Message?.bind(key)
  if (!signMessage) throw new Error("Expected an Ed25519 message signer")
  const submitted = new ExternalError({
    operation: "wallet.submit",
    cause: new Error("user cancelled submission"),
  })
  const delegated = new ExternalError({
    operation: "wallet.delegate",
    cause: new Error("user cancelled delegation"),
  })
  class CallerWallet implements WalletService {
    #accountId = "alice.near"
    #calls: string[] = []
    get calls() {
      return this.#calls.slice()
    }
    getAccounts() {
      return Effect.succeed([{ accountId: this.#accountId }])
    }
    observeAccounts() {
      const state: WalletAccountState = {
        _tag: "Ready",
        accounts: [{ accountId: this.#accountId }],
      }
      return Effect.succeed({
        ready: Effect.void,
        get: () => Effect.succeed(state),
        changes: Stream.make(state),
      })
    }
    signMessage(params: SignMessageParams) {
      this.#calls.push("message")
      return Effect.succeed(signMessage(this.#accountId, params))
    }
    signAndSendTransaction() {
      this.#calls.push("submit")
      return submitted
    }
    signDelegateActions() {
      this.#calls.push("delegate")
      return delegated
    }
  }
  const wallet = new CallerWallet()
  const state = fixture(undefined, wallet)
  await Effect.runPromise(
    Effect.gen(function* () {
      const near = yield* Near
      const message = yield* near.signMessage({
        message: "client scope",
        recipient: "app.near",
        nonce: new Uint8Array(32),
      })
      expect(message.accountId).toBe("alice.near")
      expect(message.publicKey).toBe(key.publicKey.toString())
      const submitExit = yield* Effect.exit(near.send("bob.near", "1 yocto"))
      const delegateExit = yield* Effect.exit(
        near.transactions.delegate({
          signerId: "alice.near",
          receiverId: "bob.near",
          actions: [{ transfer: { deposit: 1n } }],
        }),
      )
      expect(
        Exit.isFailure(submitExit)
          ? Option.getOrThrow(Cause.findErrorOption(submitExit.cause))
          : undefined,
      ).toBe(submitted)
      expect(
        Exit.isFailure(delegateExit)
          ? Option.getOrThrow(Cause.findErrorOption(delegateExit.cause))
          : undefined,
      ).toBe(delegated)
      expect(wallet.calls).toEqual(["message", "submit", "delegate"])
    }).pipe(Effect.provide(state.layer)),
  )
})
