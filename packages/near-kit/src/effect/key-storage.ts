/** Ref-owned native key storage; insertion order is part of the Promise API. */
import { Effect, Ref } from "effect"
import type { KeyPair } from "../core/types.js"
import { parseKey } from "../utils/key.js"

const without = <K, V>(
  values: ReadonlyMap<K, V>,
  key: K,
): ReadonlyMap<K, V> => {
  const next = new Map(values)
  next.delete(key)
  return next
}

export const makeMemoryStorage = (initialKeys?: Record<string, string>) =>
  Effect.gen(function* () {
    const keys = yield* Ref.make<ReadonlyMap<string, KeyPair>>(
      new Map(
        Object.entries(initialKeys ?? {}).map(([id, key]) => [
          id,
          parseKey(key),
        ]),
      ),
    )
    return {
      get: Effect.fn("MemoryKeyStore.get")(function* (id: string) {
        return (yield* Ref.get(keys)).get(id) ?? null
      }),
      add: Effect.fn("MemoryKeyStore.add")(function* (
        id: string,
        key: KeyPair,
      ) {
        yield* Ref.update(keys, (current) => new Map(current).set(id, key))
      }),
      remove: Effect.fn("MemoryKeyStore.remove")(function* (id: string) {
        yield* Ref.update(keys, (current) => without(current, id))
      }),
      list: Effect.fn("MemoryKeyStore.list")(function* () {
        return Array.from((yield* Ref.get(keys)).keys())
      }),
      clear: Effect.fn("MemoryKeyStore.clear")(function* () {
        yield* Ref.set(keys, new Map())
      }),
    }
  })

type RotationState = {
  readonly keys: ReadonlyMap<string, ReadonlyArray<KeyPair>>
  readonly counters: ReadonlyMap<string, number>
}

export const makeRotatingStorage = (initialKeys?: Record<string, string[]>) =>
  Effect.gen(function* () {
    const state = yield* Ref.make<RotationState>({
      keys: new Map(
        Object.entries(initialKeys ?? {})
          .filter(([, keys]) => keys.length > 0)
          .map(([id, keys]) => [id, keys.map(parseKey)]),
      ),
      counters: new Map(),
    })
    return {
      get: Effect.fn("RotatingKeyStore.get")(function* (id: string) {
        return yield* Ref.modify(state, (current) => {
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
        })
      }),
      add: Effect.fn("RotatingKeyStore.add")(function* (
        id: string,
        key: KeyPair,
      ) {
        yield* Ref.update(state, (current) => ({
          ...current,
          keys: new Map(current.keys).set(id, [
            ...(current.keys.get(id) ?? []),
            key,
          ]),
        }))
      }),
      remove: Effect.fn("RotatingKeyStore.remove")(function* (id: string) {
        yield* Ref.update(state, (current) => ({
          keys: without(current.keys, id),
          counters: without(current.counters, id),
        }))
      }),
      list: Effect.fn("RotatingKeyStore.list")(function* () {
        return Array.from((yield* Ref.get(state)).keys.keys())
      }),
      getAll: Effect.fn("RotatingKeyStore.getAll")(function* (id: string) {
        return Array.from((yield* Ref.get(state)).keys.get(id) ?? [])
      }),
      getCurrentIndex: Effect.fn("RotatingKeyStore.getCurrentIndex")(function* (
        id: string,
      ) {
        return (yield* Ref.get(state)).counters.get(id) ?? 0
      }),
      resetCounter: Effect.fn("RotatingKeyStore.resetCounter")(function* (
        id: string,
      ) {
        yield* Ref.update(state, (current) => ({
          ...current,
          counters: new Map(current.counters).set(id, 0),
        }))
      }),
      clear: Effect.fn("RotatingKeyStore.clear")(function* () {
        yield* Ref.set(state, { keys: new Map(), counters: new Map() })
      }),
    }
  })
