import { Effect } from "effect"
import { describe, expect, test } from "vitest"
import type { KeyPair } from "../../src/core/types.js"
import { ExternalError, runPromise } from "../../src/effect/runtime.js"
import { KeyStore, keyStoreService } from "../../src/effect/keys.js"
import { InMemoryKeyStore } from "../../src/keys/in-memory-keystore.js"
import { RotatingKeyStore } from "../../src/keys/rotating-keystore.js"
import { generateKey } from "../../src/utils/key.js"

describe("native key-store ownership", () => {
  test("a native write is lazy and repeated layer constructions isolate keys", async () => {
    const key = generateKey()
    const write = Effect.gen(function* () {
      const store = yield* KeyStore
      yield* store.add("alice.near", key)
      return yield* store.get("alice.near")
    })
    expect(
      await Effect.runPromise(write.pipe(Effect.provide(KeyStore.memory()))),
    ).toBe(key)
    const read = Effect.gen(function* () {
      return yield* (yield* KeyStore).get("alice.near")
    })
    expect(
      await Effect.runPromise(read.pipe(Effect.provide(KeyStore.memory()))),
    ).toBeNull()

    const legacy = new InMemoryKeyStore()
    const pending = keyStoreService(legacy).add("alice.near", key)
    expect(await legacy.get("alice.near")).toBeNull()
    await Effect.runPromise(pending)
    expect(await legacy.get("alice.near")).toBe(key)
  })

  test("concurrent native reads consume the real round-robin sequence once each", async () => {
    const store = new RotatingKeyStore()
    const keys = [generateKey(), generateKey(), generateKey()]
    for (const key of keys) await store.add("alice.near", key)
    const native = keyStoreService(store)
    const values = await Effect.runPromise(
      Effect.all(
        Array.from({ length: 30 }, () => native.get("alice.near")),
        { concurrency: "unbounded" },
      ),
    )
    expect(values).toEqual(
      Array.from({ length: 30 }, (_, index) => keys[index % 3]),
    )
    expect(store.getCurrentIndex("alice.near")).toBe(30)
  })

  test("structural application stores preserve receivers, arguments, and rejection identity", async () => {
    const key = generateKey()
    const rejected = new Error("application policy denied access")
    const application = {
      key: null as KeyPair | null,
      accountId: "",
      reject: false,
      async get(id: string) {
        if (this.reject) throw rejected
        return id === this.accountId ? this.key : null
      },
      async add(id: string, key: KeyPair) {
        this.accountId = id
        this.key = key
      },
      async remove(id: string) {
        if (id === this.accountId) this.key = null
      },
      async list() {
        return this.key ? [this.accountId] : []
      },
    }
    const native = keyStoreService(application)
    await runPromise(native.add("alice.near", key))
    expect(await runPromise(native.get("alice.near"))).toBe(key)
    expect(await runPromise(native.list())).toEqual(["alice.near"])
    application.reject = true
    const error = await Effect.runPromise(
      native.get("alice.near").pipe(Effect.flip),
    )
    expect(error).toBeInstanceOf(ExternalError)
    expect(error.cause).toBe(rejected)
    await expect(runPromise(native.get("alice.near"))).rejects.toBe(rejected)
    await runPromise(native.remove("alice.near"))
    expect(await runPromise(native.list())).toEqual([])
  })
  test.each([
    ["memory", () => new InMemoryKeyStore()],
    ["rotating", () => new RotatingKeyStore()],
  ] as const)(
    "%s keeps insertion order when accounts are removed and re-added",
    async (_name, make) => {
      const store = make()
      const key = generateKey()
      for (const id of ["z.near", "a.near", "m.near"]) await store.add(id, key)
      expect(await store.list()).toEqual(["z.near", "a.near", "m.near"])
      await store.remove("z.near")
      await store.add("z.near", key)
      expect(await store.list()).toEqual(["a.near", "m.near", "z.near"])
    },
  )

  test("rotating initialization does not create an account for an empty key pool", async () => {
    const store = new RotatingKeyStore({ "empty.near": [] })
    expect(await store.list()).toEqual([])
    expect(await store.get("empty.near")).toBeNull()
  })
})
