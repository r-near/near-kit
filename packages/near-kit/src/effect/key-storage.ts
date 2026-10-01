/** Ref-owned storage; insertion order and round-robin updates are atomic. */
import * as Effect from "effect/Effect"
import * as Ref from "effect/Ref"
import type { KeyPair } from "../core/types.js"
import { inputEffect } from "./runtime.js"
import { parseKey } from "../utils/key.js"

type Memory = Ref.Ref<ReadonlyMap<string, KeyPair>>
type RotationState = {
  readonly keys: ReadonlyMap<string, ReadonlyArray<KeyPair>>
  readonly counters: ReadonlyMap<string, number>
}
type Rotation = Ref.Ref<RotationState>

const without = <K, V>(
  values: ReadonlyMap<K, V>,
  key: K,
): ReadonlyMap<K, V> => {
  const next = new Map(values)
  next.delete(key)
  return next
}

// Named programs are shared across instances; construction only binds their state.
const memoryGet = Effect.fn("MemoryKeyStore.get")((state: Memory, id: string) =>
  Effect.map(Ref.get(state), (current) => current.get(id) ?? null),
)
const memoryAdd = Effect.fn("MemoryKeyStore.add")(
  (state: Memory, id: string, key: KeyPair) =>
    Ref.update(state, (current) => new Map(current).set(id, key)),
)
const memoryRemove = Effect.fn("MemoryKeyStore.remove")(
  (state: Memory, id: string) =>
    Ref.update(state, (current) => without(current, id)),
)
const memoryList = Effect.fn("MemoryKeyStore.list")((state: Memory) =>
  Effect.map(Ref.get(state), (current) => Array.from(current.keys())),
)
const memoryClear = Effect.fn("MemoryKeyStore.clear")((state: Memory) =>
  Ref.set(state, new Map()),
)

export const makeMemoryStorage = Effect.fn("MemoryKeyStore.make")(function* (
  initialKeys?: Record<string, string>,
) {
  const initial = yield* inputEffect(
    () =>
      new Map(
        Object.entries(initialKeys ?? {}).map(([id, key]) => [
          id,
          parseKey(key),
        ]),
      ),
    "MemoryKeyStore.initialize",
  )
  const state = yield* Ref.make<ReadonlyMap<string, KeyPair>>(initial)
  return {
    get: (id: string) => memoryGet(state, id),
    add: (id: string, key: KeyPair) => memoryAdd(state, id, key),
    remove: (id: string) => memoryRemove(state, id),
    list: () => memoryList(state),
    clear: () => memoryClear(state),
  }
})

const rotatingGet = Effect.fn("RotatingKeyStore.get")(
  (state: Rotation, id: string) =>
    Ref.modify(state, (current) => {
      const keys = current.keys.get(id) ?? []
      if (keys.length === 0) return [null, current] as const
      const counter = current.counters.get(id) ?? 0
      return [
        keys[counter % keys.length] ?? null,
        {
          ...current,
          counters: new Map(current.counters).set(id, counter + 1),
        },
      ] as const
    }),
)
const rotatingAdd = Effect.fn("RotatingKeyStore.add")(
  (state: Rotation, id: string, key: KeyPair) =>
    Ref.update(state, (current) => ({
      ...current,
      keys: new Map(current.keys).set(id, [
        ...(current.keys.get(id) ?? []),
        key,
      ]),
    })),
)
const rotatingRemove = Effect.fn("RotatingKeyStore.remove")(
  (state: Rotation, id: string) =>
    Ref.update(state, (current) => ({
      keys: without(current.keys, id),
      counters: without(current.counters, id),
    })),
)
const rotatingList = Effect.fn("RotatingKeyStore.list")((state: Rotation) =>
  Effect.map(Ref.get(state), (current) => Array.from(current.keys.keys())),
)
const rotatingGetAll = Effect.fn("RotatingKeyStore.getAll")(
  (state: Rotation, id: string) =>
    Effect.map(Ref.get(state), (current) =>
      Array.from(current.keys.get(id) ?? []),
    ),
)
const rotatingGetIndex = Effect.fn("RotatingKeyStore.getCurrentIndex")(
  (state: Rotation, id: string) =>
    Effect.map(Ref.get(state), (current) => current.counters.get(id) ?? 0),
)
const rotatingReset = Effect.fn("RotatingKeyStore.resetCounter")(
  (state: Rotation, id: string) =>
    Ref.update(state, (current) => ({
      ...current,
      counters: new Map(current.counters).set(id, 0),
    })),
)
const rotatingClear = Effect.fn("RotatingKeyStore.clear")((state: Rotation) =>
  Ref.set(state, { keys: new Map(), counters: new Map() }),
)

export const makeRotatingStorage = Effect.fn("RotatingKeyStore.make")(
  function* (initialKeys?: Record<string, string[]>) {
    const keys = yield* inputEffect(
      () =>
        new Map(
          Object.entries(initialKeys ?? {})
            .filter(([, keys]) => keys.length > 0)
            .map(([id, keys]) => [id, keys.map(parseKey)]),
        ),
      "RotatingKeyStore.initialize",
    )
    const state = yield* Ref.make<RotationState>({ keys, counters: new Map() })
    return {
      get: (id: string) => rotatingGet(state, id),
      add: (id: string, key: KeyPair) => rotatingAdd(state, id, key),
      remove: (id: string) => rotatingRemove(state, id),
      list: () => rotatingList(state),
      getAll: (id: string) => rotatingGetAll(state, id),
      getCurrentIndex: (id: string) => rotatingGetIndex(state, id),
      resetCounter: (id: string) => rotatingReset(state, id),
      clear: () => rotatingClear(state),
    }
  },
)
