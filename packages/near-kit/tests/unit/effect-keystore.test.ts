import { Effect } from "effect"
import { describe, expect, test, vi } from "vitest"
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
    const pending = legacy.addEffect("alice.near", key)
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

  test("application Promise overrides remain visible to native consumers", async () => {
    const key = generateKey()
    class ApplicationStore extends InMemoryKeyStore {
      override async get(accountId: string) {
        return (await super.get(accountId)) ?? key
      }
    }
    const store = new ApplicationStore()
    const spy = vi.spyOn(store, "get")
    const native = keyStoreService(store)
    expect(await Effect.runPromise(native.get("alice.near"))).toBe(key)
    expect(spy).toHaveBeenCalledTimes(1)
  })
  test.each([
    ["memory", () => new InMemoryKeyStore()],
    ["rotating", () => new RotatingKeyStore()],
  ] as const)("%s keeps insertion order when accounts are removed and re-added", async (_name, make) => {
    const store = make()
    const key = generateKey()
    for (const id of ["z.near", "a.near", "m.near"]) await store.add(id, key)
    expect(await store.list()).toEqual(["z.near", "a.near", "m.near"])
    await store.remove("z.near")
    await store.add("z.near", key)
    expect(await store.list()).toEqual(["a.near", "m.near", "z.near"])
  })

  test("rotating initialization does not create an account for an empty key pool", async () => {
    const store = new RotatingKeyStore({ "empty.near": [] })
    expect(await store.list()).toEqual([])
    expect(await store.get("empty.near")).toBeNull()
  })
})
