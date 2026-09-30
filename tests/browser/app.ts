import { Effect, Layer } from "effect"
import { version as reactVersion } from "react"
import {
  Near,
  InMemoryKeyStore,
  generateKey,
  generateNonce,
  verifyNep413Signature,
  type KeyPair,
  type NearConfig,
} from "near-kit"
import {
  Near as NativeNear,
  Rpc,
  KeyStore,
  NonceReservation,
  makeNonceReservation,
  Actions,
  transactionPlan,
  verifyNep413Signature as verifyNativeMessage,
} from "near-kit/effect"
import { mountReactFixture } from "./react-fixture.js"

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
function client(
  url: string,
  key = generateKey(),
  config: Partial<NearConfig> = {},
) {
  return new Near({
    rpcUrl: url,
    defaultSignerId: "alice.near",
    keyStore: new InMemoryKeyStore({ "alice.near": key.secretKey }),
    retryConfig: { maxRetries: 1, initialDelayMs: 0 },
    ...config,
  })
}
function errorRecord(error: unknown) {
  if (typeof error !== "object" || error === null)
    return { message: String(error) }
  return Object.fromEntries(
    ["name", "message", "code", "retryable", "data"].map((key) => [
      key,
      Reflect.get(error, key),
    ]),
  )
}
const pending = new Map<string, Promise<unknown>>()
const controllers = new Map<string, AbortController>()
const kit = {
  mountReactFixture,
  environment() {
    return {
      buffer: typeof Reflect.get(globalThis, "Buffer"),
      process: typeof Reflect.get(globalThis, "process"),
      secure: isSecureContext,
      reactVersion,
    }
  },
  async reads(url: string) {
    const near = client(url)
    const publicBalance = await near.getBalance("alice.near")
    const publicView = await near.view<number>("counter.near", "read")
    const native = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* NativeNear
        return {
          balance: yield* service.getBalance("alice.near"),
          view: yield* service.view<number>("counter.near", "read"),
        }
      }).pipe(
        Effect.provide(
          NativeNear.layerWithRpc({ rpcUrl: "https://unused.invalid" }).pipe(
            Layer.provide(
              Rpc.layerFetch({
                url,
                headers: { "x-fixture-service": "injected" },
                retry: { maxRetries: 0 },
              }),
            ),
          ),
        ),
      ),
    )
    return { publicBalance, publicView, native }
  },
  async injectedSigning(url: string) {
    const key = generateKey()
    const store = new InMemoryKeyStore({ "alice.near": key.secretKey })
    const reservations = Effect.runSync(makeNonceReservation)
    Effect.runSync(
      reservations.updateAndGetNext(
        "alice.near",
        key.publicKey.toString(),
        1000n,
      ),
    )
    const signed = await Effect.runPromise(
      Effect.gen(function* () {
        const near = yield* NativeNear
        return yield* near.transactions.sign(
          transactionPlan({
            signerId: "alice.near",
            receiverId: "bob.near",
            actions: [Actions.transfer(9n)],
          }),
        )
      }).pipe(
        Effect.provide(
          NativeNear.layerWithServices({ defaultSignerId: "alice.near" }).pipe(
            Layer.provide(
              Layer.mergeAll(
                Rpc.layerFetch({ url }),
                KeyStore.layer(store),
                Layer.succeed(NonceReservation, reservations),
              ),
            ),
          ),
        ),
      ),
    )
    return {
      bytes: b64(signed.serialize()),
      publicKey: key.publicKey.toString(),
    }
  },
  async signing(
    url: string,
    mode: "classic" | "strict" | "gas" | "strict-gas",
  ) {
    const key = generateKey()
    const near = client(url, key)
    const builder = near
      .transaction("alice.near")
      .transfer("bob.near", "1 NEAR")
      .nonce(42n)
    if (mode.includes("strict")) builder.strictNonceMode()
    if (mode.includes("gas")) builder.useGasKey(1)
    await builder.sign()
    const publicBytes = b64(builder.serialize())
    const native = await Effect.runPromise(
      near.effects.transactions.sign(
        transactionPlan({
          signerId: "alice.near",
          receiverId: "bob.near",
          actions: [Actions.transfer(10n ** 24n)],
          nonce: 42n,
          ...(mode.includes("strict") ? { strictNonce: true } : {}),
          ...(mode.includes("gas") ? { nonceIndex: 1 } : {}),
        }),
      ),
    )
    return {
      publicBytes,
      nativeBytes: b64(native.serialize()),
      nativeHash: native.hash,
      publicKey: key.publicKey.toString(),
    }
  },
  async message(url: string) {
    const near = client(url)
    const params = {
      message: "Authenticate this browser fixture",
      recipient: "fixture.near",
      nonce: generateNonce(),
      callbackUrl: "https://example.invalid/callback",
    }
    const signed = await near.signMessage(params)
    return {
      signed,
      params: { ...params, nonce: [...params.nonce] },
      publicValid: await verifyNep413Signature(signed, params, { near }),
      nativeValid: await Effect.runPromise(
        verifyNativeMessage(signed, params, { near: near.effects }),
      ),
      tampered: await verifyNep413Signature(signed, {
        ...params,
        recipient: "attacker.near",
      }),
    }
  },
  async submit(url: string, native: boolean, repeat = 1) {
    const near = client(url)
    const plan = transactionPlan({
      signerId: "alice.near",
      receiverId: "bob.near",
      actions: [Actions.transfer(1n)],
    })
    const builder = near
      .transaction("alice.near")
      .transfer("bob.near", "1 yocto")
    const results: unknown[] = []
    for (let i = 0; i < repeat; i++) {
      try {
        const result = native
          ? await Effect.runPromise(near.effects.transactions.send(plan))
          : await builder.send()
        results.push({ ok: true, hash: result.transaction?.hash })
      } catch (error) {
        results.push({ ok: false, error: errorRecord(error) })
      }
    }
    return results
  },
  async concurrentBroadcast(url: string) {
    const near = client(url)
    const signed = await Effect.runPromise(
      near.effects.transactions.sign(
        transactionPlan({
          signerId: "alice.near",
          receiverId: "bob.near",
          actions: [Actions.transfer(1n)],
        }),
      ),
    )
    return Promise.all(
      Array.from({ length: 3 }, () =>
        Effect.runPromise(near.effects.transactions.broadcast(signed)).then(
          (result) => ({ ok: true, hash: result.transaction?.hash }),
          (error) => ({ ok: false, error: errorRecord(error) }),
        ),
      ),
    )
  },
  async concurrent(url: string, count: number) {
    const near = client(url)
    return Effect.runPromise(
      Effect.gen(function* () {
        const commitments = yield* Effect.all(
          Array.from({ length: count }, () =>
            near.effects.transactions.sign(
              transactionPlan({
                signerId: "alice.near",
                receiverId: "bob.near",
                actions: [Actions.transfer(1n)],
              }),
            ),
          ),
          { concurrency: "unbounded" },
        )
        // Admission is ordered so this checks parallel preparation, not node arrival order.
        return yield* Effect.forEach(
          commitments,
          (signed) =>
            near.effects.transactions
              .broadcast(signed)
              .pipe(Effect.map((result) => result.transaction?.hash)),
          { concurrency: 1 },
        )
      }),
    )
  },
  async callbackFailure(
    url: string,
    boundary: "signer" | "keyStore" | "wallet",
  ) {
    const failure = { sentinel: "caller-owned failure", code: "INVALID_NONCE" }
    const key = generateKey()
    const throwingKeyStore = {
      get: async (): Promise<KeyPair | null> => {
        throw failure
      },
      add: async () => {},
      remove: async () => {},
      list: async () => [],
    }
    const near = client(url, key, {
      ...(boundary === "signer"
        ? {
            signer: async () => {
              throw failure
            },
          }
        : {}),
      ...(boundary === "keyStore" ? { keyStore: throwingKeyStore } : {}),
      ...(boundary === "wallet"
        ? {
            wallet: {
              getAccounts: async () => [{ accountId: "alice.near" }],
              signAndSendTransaction: async () => {
                throw failure
              },
            },
          }
        : {}),
    })
    try {
      await near.send("bob.near", "1 yocto")
      return false
    } catch (error) {
      return error === failure
    }
  },
  async malformed(url: string, native: boolean) {
    const near = client(url)
    try {
      if (native)
        await Effect.runPromise(near.effects.view("counter.near", "read"))
      else await near.view("counter.near", "read")
      return { resolved: true }
    } catch (error) {
      return { resolved: false, ...errorRecord(error) }
    }
  },
  startRead(url: string, id: string) {
    const near = client(url)
    const controller = new AbortController()
    controllers.set(id, controller)
    pending.set(
      id,
      Effect.runPromise(near.effects.view("counter.near", "read", { id }), {
        signal: controller.signal,
      }).then(
        (value) => ({ resolved: true, value }),
        (error) => ({ resolved: false, error: errorRecord(error) }),
      ),
    )
  },
  abortRead(id: string) {
    controllers.get(id)?.abort()
  },
  waitRead(id: string) {
    return pending.get(id)
  },
}
declare global {
  interface Window {
    kit: typeof kit
  }
}
window.kit = kit
