import { Effect } from "effect"
import { describe, expect, test, vi } from "vitest"
import { Near } from "../../src/core/near.js"
import type { KeyPair, KeyStore } from "../../src/core/types.js"
import { make } from "../../src/effect/near.js"
import { generateKey } from "../../src/utils/key.js"
import { verifyNep413Signature } from "../../src/utils/nep413.js"
import type { PrivateKey } from "../../src/utils/validation.js"

const accountId = "alice.near"
const message = {
  message: "Authorize this session",
  recipient: "app.near",
  nonce: new Uint8Array(32).fill(7),
}

function sandbox(key: KeyPair) {
  return {
    rpcUrl: "http://127.0.0.1:12345",
    networkId: "localnet",
    rootAccount: { id: accountId, secretKey: key.secretKey },
  }
}

function externalStore(write: () => Promise<void>, initial?: KeyPair) {
  const keys = new Map<string, KeyPair>(initial ? [[accountId, initial]] : [])
  return {
    add: vi.fn(async (id: string, key: KeyPair) => {
      await write()
      keys.set(id, key)
    }),
    get: vi.fn(async (id: string) => keys.get(id) ?? null),
    remove: async (id: string) => {
      keys.delete(id)
    },
    list: async () => [...keys.keys()],
  } satisfies KeyStore
}

describe("configured key initialization reaches signing", () => {
  test.each(["sandbox root", "explicit private key"] as const)(
    "%s starts its external write eagerly and waits before NEP-413 signing",
    async (source) => {
      const key = generateKey()
      const write = Promise.withResolvers<void>()
      const store = externalStore(() => write.promise)
      const near = new Near({
        ...(source === "sandbox root"
          ? { network: sandbox(key) }
          : { network: "testnet", privateKey: key.secretKey as PrivateKey }),
        defaultSignerId: accountId,
        keyStore: store,
      })
      expect(store.add).toHaveBeenCalledTimes(1)
      const signing = near.signMessage(message)
      expect(store.get).not.toHaveBeenCalled()

      write.resolve()
      const signed = await signing
      expect(signed.accountId).toBe(accountId)
      expect(signed.publicKey).toBe(key.publicKey.toString())
      expect(
        await verifyNep413Signature(signed, message, {
          nonceValidation: "none",
        }),
      ).toBe(true)
      expect(store.add).toHaveBeenCalledTimes(1)
    },
  )

  test("native acquisition defers the write and returns a ready signing service", async () => {
    const key = generateKey()
    const write = Promise.withResolvers<void>()
    const started = Promise.withResolvers<void>()
    const store = externalStore(() => {
      started.resolve()
      return write.promise
    })
    let acquired = false
    const program = make({
      network: sandbox(key),
      defaultSignerId: accountId,
      keyStore: store,
    }).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          acquired = true
        }),
      ),
    )
    expect(store.add).not.toHaveBeenCalled()
    const running = Effect.runPromise(program)
    await started.promise
    expect(acquired).toBe(false)
    expect(store.get).not.toHaveBeenCalled()
    write.resolve()

    const near = await running
    expect(acquired).toBe(true)
    const signed = await Effect.runPromise(near.signMessage(message))
    expect(signed.publicKey).toBe(key.publicKey.toString())
    expect(
      await verifyNep413Signature(signed, message, { nonceValidation: "none" }),
    ).toBe(true)
    expect(store.add).toHaveBeenCalledTimes(1)
  })

  test("a rejected key write reaches every signing caller unchanged without reading or signing", async () => {
    const key = generateKey()
    const write = Promise.withResolvers<void>()
    const store = externalStore(() => write.promise)
    const near = new Near({
      network: sandbox(key),
      defaultSignerId: accountId,
      keyStore: store,
    })
    const messageResult = near
      .signMessage(message)
      .catch((error: unknown) => error)
    const delegateResult = near
      .transaction(accountId)
      .transfer("bob.near", "1 NEAR")
      .delegate({ nonce: 42n, maxBlockHeight: 200n })
      .catch((error: unknown) => error)
    const failure = new Error("storage permission denied")
    write.reject(failure)

    expect(await messageResult).toBe(failure)
    expect(await delegateResult).toBe(failure)
    await expect(near.signMessage(message)).rejects.toBe(failure)
    expect(store.add).toHaveBeenCalledTimes(1)
    expect(store.get).not.toHaveBeenCalled()
  })

  test.each([
    "ordinary network",
    "sanitized sandbox",
    "custom signer",
  ] as const)(
    "%s uses the supplied store without automatically replacing its key",
    async (source) => {
      const existingKey = generateKey()
      const sandboxKey = generateKey()
      const store = externalStore(async () => {}, existingKey)
      const network =
        source === "ordinary network"
          ? "testnet"
          : source === "sanitized sandbox"
            ? { ...sandbox(sandboxKey), rootAccount: { id: accountId } }
            : sandbox(sandboxKey)
      const near = new Near({
        network,
        defaultSignerId: accountId,
        keyStore: store,
        ...(source === "custom signer"
          ? { signer: async (bytes: Uint8Array) => existingKey.sign(bytes) }
          : {}),
      })
      expect(store.add).not.toHaveBeenCalled()
      const signed = await near.signMessage(message)
      expect(signed.publicKey).toBe(existingKey.publicKey.toString())
      expect(
        await verifyNep413Signature(signed, message, {
          nonceValidation: "none",
        }),
      ).toBe(true)
      expect(store.add).not.toHaveBeenCalled()
    },
  )
})
