import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type { KeyPair, KeyStore as PromiseKeyStore } from "../core/types.js"
import { makeMemoryStorage } from "./key-storage.js"
import { type ExternalError, fromPromise, runPromise } from "./runtime.js"

export interface KeyStoreService {
  readonly get: (
    accountId: string,
  ) => Effect.Effect<KeyPair | null, ExternalError>
  readonly add: (
    accountId: string,
    key: KeyPair,
  ) => Effect.Effect<void, ExternalError>
  readonly remove: (accountId: string) => Effect.Effect<void, ExternalError>
  // oxlint-disable-next-line effecttsgo/lazy-effect -- Kit service operations are named functions, including zero-argument methods.
  readonly list: () => Effect.Effect<string[], ExternalError>
}

/** Built-in Promise projections retain their native service without re-adapting it. */
export const nativeKeyStore = Symbol.for("near-kit/NativeKeyStore")
export interface NativeKeyStore extends PromiseKeyStore {
  readonly [nativeKeyStore]: KeyStoreService
}

/** The sole boundary for application-provided Promise stores. */
export const keyStoreService = (
  store: PromiseKeyStore & Partial<NativeKeyStore>,
): KeyStoreService =>
  store[nativeKeyStore] ??
  KeyStore.of({
    get: (id) => fromPromise(() => store.get(id), "KeyStore.get"),
    add: (id, key) => fromPromise(() => store.add(id, key), "KeyStore.add"),
    remove: (id) => fromPromise(() => store.remove(id), "KeyStore.remove"),
    list: () => fromPromise(() => store.list(), "KeyStore.list"),
  })

/** Injectable storage. Each memory layer construction owns its own state. */
// oxlint-disable-next-line effecttsgo/lazy-effect -- Kit service operations are named functions, including zero-argument methods.
export class KeyStore extends Context.Service<KeyStore, KeyStoreService>()(
  "near-kit/KeyStore",
) {
  static layer = (store: PromiseKeyStore) =>
    Layer.succeed(KeyStore, keyStoreService(store))
  static memory = (initialKeys?: Record<string, string>) =>
    Layer.effect(
      KeyStore,
      Effect.map(makeMemoryStorage(initialKeys), KeyStore.of),
    )
}

/** Project a native service into the documented Promise connection shape. */
export const keyStoreConnection = (
  service: KeyStoreService,
): NativeKeyStore => ({
  [nativeKeyStore]: service,
  get: (id) => runPromise(service.get(id)),
  add: (id, key) => runPromise(service.add(id, key)),
  remove: (id) => runPromise(service.remove(id)),
  list: () => runPromise(service.list()),
})
