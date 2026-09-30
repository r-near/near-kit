/** Operating-system keyrings have no Effect-native backend; this is the FFI boundary. */
import { Context, Effect, Layer } from "effect"
import type { KeyPair } from "../core/types.js"
import {
  type CredentialMetadata,
  decodeCredential,
  makeCredential,
} from "../keys/credential-schemas.js"
import { parseKey } from "../utils/key.js"
import type { FileStorageService } from "./file-keystore.js"
import { ExternalError, fromPromise } from "./runtime.js"

export interface NativeStorageService extends FileStorageService {}

const keyringError = (operation: string) => (cause: unknown) =>
  new ExternalError({ operation, cause })
const notFound = (error: ExternalError) =>
  error.cause instanceof Error && error.cause.message.includes("not found")

export const makeNativeStorage = Effect.fn("NativeStorage.make")(function* (
  service = "NEAR Credentials",
) {
  // Loading is deferred until an operation actually needs the optional native library.
  const module = yield* Effect.cached(
    fromPromise(() => import("@napi-rs/keyring"), "NativeKeyStore.load"),
  )
  const entry = Effect.fn("NativeStorage.entry")(function* (accountId: string) {
    const { Entry } = yield* module
    return yield* Effect.try({
      try: () => new Entry(service, accountId),
      catch: keyringError("NativeKeyStore.entry"),
    })
  })

  return NativeStorage.of({
    add: Effect.fn("NativeStorage.add")(function* (
      id: string,
      key: KeyPair,
      metadata?: CredentialMetadata,
    ) {
      const target = yield* entry(id)
      yield* Effect.try({
        try: () =>
          target.setPassword(JSON.stringify(makeCredential(id, key, metadata))),
        catch: keyringError("NativeKeyStore.add"),
      })
    }),
    get: Effect.fn("NativeStorage.get")(
      function* (id: string) {
        const target = yield* entry(id)
        const stored = yield* Effect.try({
          try: () => target.getPassword(),
          catch: keyringError("NativeKeyStore.get"),
        })
        if (!stored) return null
        const json = yield* Effect.try({
          try: () => JSON.parse(stored) as unknown,
          catch: keyringError("NativeKeyStore.get"),
        })
        const credential = yield* decodeCredential(json).pipe(
          Effect.mapError(keyringError("NativeKeyStore.get")),
        )
        return yield* Effect.try({
          try: () => parseKey(credential.private_key),
          catch: keyringError("NativeKeyStore.get"),
        })
      },
      Effect.catchIf(notFound, () => Effect.succeed(null)),
    ),
    remove: Effect.fn("NativeStorage.remove")(
      function* (id: string) {
        const target = yield* entry(id)
        yield* Effect.try({
          try: () => {
            target.deletePassword()
          },
          catch: keyringError("NativeKeyStore.remove"),
        })
      },
      Effect.catchIf(notFound, () => Effect.void),
    ),
    list: Effect.fn("NativeStorage.list")(() => Effect.succeed<string[]>([])),
  })
})

export class NativeStorage extends Context.Service<
  NativeStorage,
  NativeStorageService
>()("near-kit/NativeStorage") {
  static layer = (service?: string) =>
    Layer.effect(NativeStorage, makeNativeStorage(service))
}
