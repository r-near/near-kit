/** Operating-system keyrings have no Effect-native backend; this is the FFI boundary. */
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type { KeyPair } from "../core/types.js"
import {
  type CredentialMetadata,
  parseCredentialFile,
  makeCredential,
} from "../keys/credential-schemas.js"
import { parseKey } from "../utils/key.js"
import type { FileStorageService } from "./file-keystore.js"
import { KeyStore } from "./keys.js"
import { type ExternalError, fromPromise, fromSync } from "./runtime.js"

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
    return yield* fromSync(
      () => new Entry(service, accountId),
      "NativeKeyStore.entry",
    )
  })

  return {
    add: Effect.fn("NativeStorage.add")(function* (
      id: string,
      key: KeyPair,
      metadata?: CredentialMetadata,
    ) {
      const target = yield* entry(id)
      yield* fromSync(
        () =>
          target.setPassword(JSON.stringify(makeCredential(id, key, metadata))),
        "NativeKeyStore.add",
      )
    }),
    get: Effect.fn("NativeStorage.get")(
      function* (id: string) {
        const target = yield* entry(id)
        return yield* fromSync(() => {
          const stored = target.getPassword()
          return stored
            ? parseKey(parseCredentialFile(JSON.parse(stored)).private_key)
            : null
        }, "NativeKeyStore.get")
      },
      Effect.catchIf(notFound, () => Effect.succeed(null)),
    ),
    remove: Effect.fn("NativeStorage.remove")(
      function* (id: string) {
        const target = yield* entry(id)
        yield* fromSync(() => {
          target.deletePassword()
        }, "NativeKeyStore.remove")
      },
      Effect.catchIf(notFound, () => Effect.void),
    ),
    list: Effect.fn("NativeStorage.list")(() => Effect.succeed<string[]>([])),
  } satisfies FileStorageService
})

/** Node-only layer implementing the shared key-store service. */
export const NativeStorage = {
  layer: (service?: string) =>
    Layer.effect(KeyStore, makeNativeStorage(service)),
}
