import { Cause, Deferred, Effect, Exit } from "effect"
import { describe, expect, test } from "vitest"
import { Near } from "../../src/core/near.js"
import { TransactionBuilder } from "../../src/core/transaction.js"
import { InMemoryKeyStore } from "../../src/keys/in-memory-keystore.js"
import { walletConnection } from "../../src/effect/wallet.js"
import { ExternalError } from "../../src/effect/runtime.js"
import { Ed25519KeyPair } from "../../src/utils/key.js"
import { verifyNep413Signature } from "../../src/utils/nep413.js"
import { testRpcClient, testRpcPrograms } from "../helpers/rpc.js"

// Independent regressions from the migration acceptance review.
describe("migration acceptance boundaries", () => {
  test("native wallet submission remains owned by the transaction fiber", async () => {
    const started = Deferred.makeUnsafe<void>()
    const gate = Deferred.makeUnsafe<void>()
    const finalized = Deferred.makeUnsafe<void>()
    let submissions = 0
    const wallet = walletConnection({
      getAccounts: () => Effect.succeed([{ accountId: "alice.near" }]),
      signAndSendTransaction: () =>
        Effect.gen(function* () {
          yield* Deferred.succeed(started, undefined)
          yield* Deferred.await(gate)
          submissions++
          return yield* new ExternalError({
            operation: "test.submit",
            cause: "stop",
          })
        }).pipe(Effect.ensuring(Deferred.succeed(finalized, undefined))),
    })
    const tx = new TransactionBuilder(
      "alice.near",
      testRpcClient("https://unused.invalid"),
      new InMemoryKeyStore(),
      undefined,
      "EXECUTED_OPTIMISTIC",
      wallet,
    ).transfer("bob.near", "1 NEAR")
    const controller = new AbortController()
    const running = Effect.runPromiseExit(tx.sendEffect(), {
      signal: controller.signal,
    })
    await Effect.runPromise(Deferred.await(started))
    controller.abort()
    await running
    const cleanedUp = Effect.runSync(Deferred.isDone(finalized))
    // Release even on the broken implementation, so the test never leaks work.
    await Effect.runPromise(Deferred.succeed(gate, undefined))
    await Effect.runPromise(Deferred.await(finalized))
    expect({ cleanedUp, submissions }).toEqual({
      cleanedUp: true,
      submissions: 0,
    })
  })

  test("NEP-413 verification honors caller Near access-key policy overrides", async () => {
    let policyCalls = 0
    class RestrictedNear extends Near {
      override async getAccessKey() {
        policyCalls++
        return null
      }
    }
    const rpc = testRpcPrograms("https://unused.invalid", async () =>
      Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: {
          nonce: 1,
          permission: "FullAccess",
          block_height: 1,
          block_hash: "test",
        },
      }),
    )
    const near = new RestrictedNear({}, { rpc })
    const key = Ed25519KeyPair.fromRandom()
    const params = {
      message: "login",
      recipient: "app.near",
      nonce: new Uint8Array(32),
    }
    const signed = key.signNep413Message("alice.near", params)
    const accepted = await verifyNep413Signature(signed, params, {
      near,
      nonceValidation: "none",
    })
    expect({ accepted, policyCalls }).toEqual({
      accepted: false,
      policyCalls: 1,
    })
  })

  test("NEP-413 key extension failures stay in the advertised native typed error channel", async () => {
    const key = Ed25519KeyPair.fromRandom()
    const rejection = new Error("hardware NEP-413 signing denied")
    key.signNep413Message = () => {
      throw rejection
    }
    const store = new InMemoryKeyStore()
    await store.add("alice.near", key)
    const near = new Near({ keyStore: store, defaultSignerId: "alice.near" })
    const exit = await Effect.runPromiseExit(
      near.effects.signMessage({
        message: "login",
        recipient: "app.near",
        nonce: new Uint8Array(32),
      }),
    )
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(Cause.hasFails(exit.cause)).toBe(true)
      expect(Cause.hasDies(exit.cause)).toBe(false)
    }
  })
})

describe("native encoding failure recovery", () => {
  test("invalid transfer amounts are recoverable typed failures", async () => {
    const near = new Near({ defaultSignerId: "alice.near" })
    // JavaScript consumers and untrusted application input can supply malformed strings.
    const exit = await Effect.runPromiseExit(
      near.effects.send("bob.near", "not a number" as `${number} NEAR`),
    )
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(Cause.hasFails(exit.cause)).toBe(true)
      expect(Cause.hasDies(exit.cause)).toBe(false)
    }
    await expect(
      near.send("bob.near", "not a number" as `${number} NEAR`),
    ).rejects.toThrow("Invalid amount format")
  })

  test("nonserializable RPC arguments are recoverable typed failures without a request", async () => {
    const args: { circular?: unknown } = {}
    args.circular = args
    let requests = 0
    const rpc = testRpcPrograms("https://unused.invalid", async () => {
      requests++
      throw new Error("must fail before transport")
    })
    const exit = await Effect.runPromiseExit(
      rpc.viewFunction("contract.near", "read", args),
    )
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(Cause.hasFails(exit.cause)).toBe(true)
      expect(Cause.hasDies(exit.cause)).toBe(false)
    }
    expect(requests).toBe(0)
  })
})
