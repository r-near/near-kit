import { EventEmitter } from "@hot-labs/near-connect/build/helpers/events.js"
import { Deferred, Effect, Exit, Queue, Scope, Stream } from "effect"
import { describe, expect, test, vi } from "vitest"
import type { WalletAccount } from "../../src/core/types.js"
import { ExternalError } from "../../src/effect/runtime.js"
import {
  acquireWalletAccounts,
  walletService,
  type WalletAccountState,
} from "../../src/effect/wallet.js"
import { fromNearConnect } from "../../src/wallets/adapters.js"
import type { NearConnectAccountEvents } from "../../src/wallets/types.js"
import { MockNearConnect } from "./mock-wallets.js"

const connectorWithEvents = (accounts: WalletAccount[] = []) => {
  const connector = new MockNearConnect(accounts)
  const events = new EventEmitter<NearConnectAccountEvents>()
  const register = events.on.bind(events)
  const on = vi.spyOn(events, "on")
  const off = vi.spyOn(events, "off")
  return {
    connector: Object.assign(connector, {
      on: events.on.bind(events),
      off: events.off.bind(events),
    }),
    events,
    register,
    on,
    off,
  }
}

describe("scoped wallet account observation", () => {
  test("contains malformed sign-in callbacks and recovers on the next valid event", async () => {
    const fixture = connectorWithEvents()
    const rejection = new Error("account getter failed")
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const observer = yield* acquireWalletAccounts(
            walletService(fromNearConnect(fixture.connector)),
          )
          yield* observer.ready
          expect(() =>
            fixture.events.emit("wallet:signIn", {
              success: true,
              accounts: [
                {
                  accountId: "malformed.near",
                  get publicKey(): string {
                    throw rejection
                  },
                },
              ],
            }),
          ).not.toThrow()
          const failures = yield* observer.changes.pipe(
            Stream.filter((state) => state._tag === "Failed"),
            Stream.take(1),
            Stream.runCollect,
          )
          expect(failures).toHaveLength(1)
          const failure = failures[0]
          if (failure?._tag !== "Failed")
            throw new Error("missing observation failure")
          expect(failure.error).toBeInstanceOf(ExternalError)
          expect(failure.error.operation).toBe("wallet.observeAccounts")
          expect(failure.error.cause).toBe(rejection)
          fixture.events.emit("wallet:signIn", {
            success: true,
            accounts: [{ accountId: "recovered.near" }],
          })
          const recovery = yield* observer.changes.pipe(
            Stream.filter((state) => state._tag === "Ready"),
            Stream.take(1),
            Stream.runCollect,
          )
          expect(recovery).toEqual([
            { _tag: "Ready", accounts: [{ accountId: "recovered.near" }] },
          ])
        }),
      ),
    )
  })

  test("coalesces a synchronous event burst while retaining its newest account state", async () => {
    const fixture = connectorWithEvents()
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const observer = yield* acquireWalletAccounts(
            walletService(fromNearConnect(fixture.connector)),
          )
          yield* observer.ready
          const changes = yield* Queue.unbounded<WalletAccountState>()
          yield* observer.changes.pipe(
            Stream.runForEach((state) => Queue.offer(changes, state)),
            Effect.forkScoped,
          )
          expect(yield* Queue.take(changes)).toEqual({
            _tag: "Ready",
            accounts: [],
          })
          for (let index = 0; index < 100; index++) {
            fixture.events.emit("wallet:signIn", {
              success: true,
              accounts: [{ accountId: `account-${index}.near` }],
            })
          }
          const observed = yield* Stream.fromQueue(changes).pipe(
            Stream.takeUntil(
              (state) =>
                state._tag === "Ready" &&
                state.accounts[0]?.accountId === "account-99.near",
            ),
            Stream.runCollect,
          )
          // One already-delivered state may precede the newest buffered state.
          expect(observed.length).toBeLessThanOrEqual(2)
          expect(observed.at(-1)).toEqual({
            _tag: "Ready",
            accounts: [{ accountId: "account-99.near" }],
          })
        }),
      ),
    )
  })

  test("shares event snapshots and keeps a later sign-in when the initial read completes", async () => {
    const fixture = connectorWithEvents()
    const initialRead = Deferred.makeUnsafe<void>()
    const releaseRead = Deferred.makeUnsafe<void>()
    const wallet = await fixture.connector.wallet()
    let reads = 0
    wallet.getAccounts = () =>
      Effect.runPromise(
        Effect.gen(function* () {
          reads++
          yield* Deferred.succeed(initialRead, undefined)
          yield* Deferred.await(releaseRead)
          // Completing an old read may race with a connector event. Emit during
          // normalization so both values reach the owner in the same turn.
          return [
            {
              accountId: "stale.near",
              get publicKey() {
                const account = { accountId: "current.near" }
                const accounts = [account]
                fixture.events.emit("wallet:signIn", {
                  success: true,
                  accounts,
                })
                account.accountId = "mutated.near"
                return undefined
              },
            },
          ]
        }),
      )
    let unrelatedSignOuts = 0
    fixture.events.on("wallet:signOut", () => unrelatedSignOuts++)
    fixture.on.mockClear()
    const service = walletService(fromNearConnect(fixture.connector))
    expect(fixture.on).not.toHaveBeenCalled()
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const observer = yield* acquireWalletAccounts(service)
          const first = yield* Queue.unbounded<WalletAccountState>()
          const second = yield* Queue.unbounded<WalletAccountState>()
          yield* observer.changes.pipe(
            Stream.runForEach((state) => Queue.offer(first, state)),
            Effect.forkScoped,
          )
          yield* observer.changes.pipe(
            Stream.runForEach((state) => Queue.offer(second, state)),
            Effect.forkScoped,
          )
          expect(yield* Queue.take(first)).toEqual({ _tag: "Loading" })
          expect(yield* Queue.take(second)).toEqual({ _tag: "Loading" })
          yield* Deferred.await(initialRead)
          expect(fixture.on.mock.calls.map(([event]) => event)).toEqual([
            "wallet:signIn",
            "wallet:signOut",
          ])
          yield* Deferred.succeed(releaseRead, undefined)
          yield* observer.ready
          const current = {
            _tag: "Ready",
            accounts: [{ accountId: "current.near" }],
          }
          expect(yield* Queue.take(first)).toEqual(current)
          expect(yield* Queue.take(second)).toEqual(current)
          expect(yield* observer.get()).toEqual(current)
          fixture.events.emit("wallet:signOut", { success: true })
          const disconnected = { _tag: "Ready", accounts: [] }
          expect(yield* Queue.take(first)).toEqual(disconnected)
          expect(yield* Queue.take(second)).toEqual(disconnected)
          expect(reads).toBe(1)
        }),
      ),
    )
    expect(fixture.off.mock.calls.map(([event]) => event).sort()).toEqual([
      "wallet:signIn",
      "wallet:signOut",
    ])
    fixture.events.emit("wallet:signOut", { success: true })
    expect(unrelatedSignOuts).toBe(2)
  })

  test.each([
    { reason: new Error("No accounts found"), state: "Ready" },
    { reason: new Error("provider unavailable"), state: "Failed" },
    { reason: "opaque rejection", state: "Failed" },
  ])(
    "observes $state without changing Promise rejection identity",
    async ({ reason, state }) => {
      const fixture = connectorWithEvents()
      fixture.connector.wallet = () => Promise.reject(reason)
      const connection = fromNearConnect(fixture.connector)
      await expect(connection.getAccounts()).rejects.toBe(reason)
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const observer = yield* acquireWalletAccounts(
              walletService(connection),
            )
            yield* observer.ready
            const observed = yield* observer.get()
            expect(observed._tag).toBe(state)
            if (observed._tag === "Ready") expect(observed.accounts).toEqual([])
            if (observed._tag === "Failed") {
              expect(observed.error).toBeInstanceOf(ExternalError)
              expect(observed.error.operation).toBe("wallet.observeAccounts")
              expect(observed.error.cause).toBe(reason)
            }
            fixture.events.emit("wallet:signIn", {
              success: true,
              accounts: [{ accountId: "recovered.near" }],
            })
            const recovered = yield* observer.changes.pipe(
              Stream.filter(
                (value) => value._tag === "Ready" && value.accounts.length > 0,
              ),
              Stream.take(1),
              Stream.runCollect,
            )
            expect(recovered).toEqual([
              { _tag: "Ready", accounts: [{ accountId: "recovered.near" }] },
            ])
          }),
        ),
      )
    },
  )

  test("unwinds partial listener acquisition without removing application listeners", async () => {
    const fixture = connectorWithEvents()
    const failure = new Error("second listener registration failed")
    let applicationEvents = 0
    fixture.events.on("wallet:signOut", () => applicationEvents++)
    fixture.on.mockImplementation((event, callback) => {
      fixture.register(event, callback)
      if (event === "wallet:signOut") throw failure
    })
    const connection = fromNearConnect(fixture.connector)
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const observer = yield* acquireWalletAccounts(
            walletService(connection),
          )
          yield* observer.ready
          const observed = yield* observer.get()
          expect(observed._tag).toBe("Failed")
          if (observed._tag === "Failed")
            expect(observed.error.cause).toBe(failure)
          expect(fixture.off).toHaveBeenCalledTimes(2)
          fixture.events.emit("wallet:signOut", { success: true })
          expect(applicationEvents).toBe(1)
          expect(yield* observer.get()).toBe(observed)
        }),
      ),
    )
    expect(fixture.off).toHaveBeenCalledTimes(2)
  })

  test("interrupts a native legacy account read when its owning scope closes", async () => {
    const started = Deferred.makeUnsafe<void>()
    const finalized = Deferred.makeUnsafe<void>()
    await Effect.runPromise(
      Effect.gen(function* () {
        const scope = yield* Scope.make()
        const observation = yield* acquireWalletAccounts({
          getAccounts: () =>
            Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Effect.never),
              Effect.ensuring(Deferred.succeed(finalized, undefined)),
            ),
          signAndSendTransaction: () => Effect.die("unused"),
        }).pipe(Effect.provideService(Scope.Scope, scope))
        yield* Deferred.await(started)
        expect(yield* observation.get()).toEqual({ _tag: "Loading" })
        yield* Scope.close(scope, Exit.void)
        expect(yield* Deferred.isDone(finalized)).toBe(true)
      }),
    )
  })

  test("detaches connector callbacks when closed during its initial Promise read", async () => {
    const fixture = connectorWithEvents()
    const wallet = await fixture.connector.wallet()
    const started = Deferred.makeUnsafe<void>()
    const response = Promise.withResolvers<WalletAccount[]>()
    wallet.getAccounts = () => {
      Deferred.doneUnsafe(started, Exit.void)
      return response.promise
    }
    const observation = await Effect.runPromise(
      Effect.gen(function* () {
        const scope = yield* Scope.make()
        const observer = yield* acquireWalletAccounts(
          walletService(fromNearConnect(fixture.connector)),
        ).pipe(Effect.provideService(Scope.Scope, scope))
        yield* Deferred.await(started)
        yield* Scope.close(scope, Exit.void)
        return observer
      }),
    )
    expect(fixture.off).toHaveBeenCalledTimes(2)
    response.resolve([{ accountId: "late.near" }])
    await response.promise
    fixture.events.emit("wallet:signIn", {
      success: true,
      accounts: [{ accountId: "also-late.near" }],
    })
    expect(await Effect.runPromise(observation.get())).toEqual({
      _tag: "Loading",
    })
  })
})
