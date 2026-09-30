import { Context, Effect, Layer } from "effect"
import type { KeyPair, KeyStore as PromiseKeyStore } from "../core/types.js"
import { makeMemoryStorage } from "./key-storage.js"
import { type ExternalError, fromPromise } from "./runtime.js"

export interface KeyStoreService {
  readonly get: (
    accountId: string,
  ) => Effect.Effect<KeyPair | null, ExternalError>
  readonly add: (
    accountId: string,
    key: KeyPair,
  ) => Effect.Effect<void, ExternalError>
  readonly remove: (accountId: string) => Effect.Effect<void, ExternalError>
  readonly list: () => Effect.Effect<string[], ExternalError>
}

/** Optional native capability of a backwards-compatible key store. */
export interface NativeKeyStore extends PromiseKeyStore {
  getEffect(accountId: string): Effect.Effect<KeyPair | null, ExternalError>
  addEffect(accountId: string, key: KeyPair): Effect.Effect<void, ExternalError>
  removeEffect(accountId: string): Effect.Effect<void, ExternalError>
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
export class KeyStore extends Context.Service<KeyStore, KeyStoreService>()(
  "near-kit/KeyStore",
) {
  static layer = (store: PromiseKeyStore): Layer.Layer<KeyStore> =>
    Layer.succeed(KeyStore, keyStoreService(store))

  static memory = (
    initialKeys?: Record<string, string>,
  ): Layer.Layer<KeyStore> =>
    Layer.effect(
      KeyStore,
      Effect.map(makeMemoryStorage(initialKeys), KeyStore.of),
    )
}
