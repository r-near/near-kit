import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type { KeyPair, KeyStore as PromiseKeyStore } from "../core/types.js"
import { makeMemoryStorage } from "./key-storage.js"
import {
  type ExternalError,
  type NearFailure,
  fromPromise,
  runPromise,
} from "./runtime.js"

export interface KeyStoreService {
  readonly get: (
    accountId: string,
  ) => Effect.Effect<KeyPair | null, ExternalError>
  readonly add: (
    accountId: string,
    key: KeyPair,
  ) => Effect.Effect<void, ExternalError>
  readonly remove: (accountId: string) => Effect.Effect<void, ExternalError>
  // oxlint-disable-next-line effecttsgo/lazy-effect -- Kit service operations remain named Effect.fn functions, including zero-argument methods.
  readonly list: () => Effect.Effect<string[], ExternalError>
}

/** Optional native capability of a backwards-compatible key store. */
export interface NativeKeyStore extends PromiseKeyStore {
  getEffect(accountId: string): Effect.Effect<KeyPair | null, ExternalError>
  addEffect(accountId: string, key: KeyPair): Effect.Effect<void, ExternalError>
  removeEffect(accountId: string): Effect.Effect<void, ExternalError>
  // oxlint-disable-next-line effecttsgo/lazy-effect -- Kit service operations remain named Effect.fn functions, including zero-argument methods.
  listEffect(): Effect.Effect<string[], ExternalError>
}

export const getKeyEffect = (store: PromiseKeyStore, accountId: string) => {
  const native = store as Partial<NativeKeyStore>
  return native.getEffect
    ? native.getEffect.call(store, accountId)
    : fromPromise(() => store.get(accountId), "KeyStore.get")
}

/** Adapt Promise-only application stores while keeping built-ins native. */
export const keyStoreService = (store: PromiseKeyStore): KeyStoreService => {
  const native = store as Partial<NativeKeyStore>
  return {
    get: (accountId) => getKeyEffect(store, accountId),
    add: (accountId, key) =>
      native.addEffect
        ? native.addEffect.call(store, accountId, key)
        : fromPromise(() => store.add(accountId, key), "KeyStore.add"),
    remove: (accountId) =>
      native.removeEffect
        ? native.removeEffect.call(store, accountId)
        : fromPromise(() => store.remove(accountId), "KeyStore.remove"),
    list: () =>
      native.listEffect
        ? native.listEffect.call(store)
        : fromPromise(() => store.list(), "KeyStore.list"),
  }
}

/** Injectable key storage; each layer construction owns its own store. */
// oxlint-disable-next-line effecttsgo/lazy-effect -- Kit service operations remain named Effect.fn functions, including zero-argument methods.
export class KeyStore extends Context.Service<KeyStore, KeyStoreService>()(
  "near-kit/KeyStore",
) {
  static layer = (store: PromiseKeyStore): Layer.Layer<KeyStore> =>
    Layer.succeed(KeyStore, keyStoreService(store))

  static memory = (
    initialKeys?: Record<string, string>,
  ): Layer.Layer<KeyStore, NearFailure> =>
    Layer.effect(
      KeyStore,
      Effect.map(makeMemoryStorage(initialKeys), KeyStore.of),
    )
}

/** A public KeyStore connection backed directly by native operations. */
export const keyStoreConnection = (
  service: KeyStoreService,
): NativeKeyStore => ({
  get: (id) => runPromise(service.get(id)),
  add: (id, key) => runPromise(service.add(id, key)),
  remove: (id) => runPromise(service.remove(id)),
  list: () => runPromise(service.list()),
  getEffect: service.get,
  addEffect: service.add,
  removeEffect: service.remove,
  listEffect: service.list,
})
