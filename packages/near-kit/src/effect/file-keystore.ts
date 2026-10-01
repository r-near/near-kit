/** Native filesystem storage. Filesystem authority is supplied by a Layer. */
import * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as PlatformError from "effect/PlatformError"
import type { KeyPair } from "../core/types.js"
import {
  type CredentialMetadata,
  parseCredentialFile,
  makeCredential,
  type Network,
} from "../keys/credential-schemas.js"
import { parseKey } from "../utils/key.js"
import { KeyStore, type KeyStoreService } from "./keys.js"
import { ExternalError } from "./runtime.js"

export interface FileStorageOptions {
  readonly basePath?: string
  readonly network?: Network
}

export interface FileStorageService extends KeyStoreService {
  readonly add: (
    accountId: string,
    key: KeyPair,
    options?: CredentialMetadata,
  ) => Effect.Effect<void, ExternalError>
}

const storageError = (operation: string) => (cause: unknown) =>
  cause instanceof ExternalError
    ? cause
    : new ExternalError({
        operation,
        cause: PlatformError.isPlatformError(cause)
          ? (cause.reason.cause ?? cause)
          : cause,
      })

const isMissing = (error: PlatformError.PlatformError) =>
  error.reason._tag === "NotFound"
const isKeyFile = (file: string) =>
  file.startsWith("ed25519_") && file.endsWith(".json")

/** Path expansion is evaluated once, at construction, just like the Promise API. */
export const resolveCredentialPath = (basePath = "~/.near-credentials") =>
  basePath.startsWith("~")
    ? Effect.gen(function* () {
        const home = yield* Config.String("HOME").pipe(Config.withDefault(""))
        const userProfile = yield* Config.String("USERPROFILE").pipe(
          Config.withDefault(""),
        )
        return basePath.replace(/^~/, home || userProfile)
      })
    : Effect.succeed(basePath)

export const makeFileStorage = Effect.fn("FileStorage.make")(function* (
  options: FileStorageOptions = {},
) {
  const fs = yield* FileSystem.FileSystem
  const basePath = yield* resolveCredentialPath(options.basePath)
  const directory = options.network
    ? `${basePath}/${options.network}`
    : basePath
  const keyPath = (id: string) => `${directory}/${id}.json`
  const multiPath = (id: string) => `${directory}/${id}`

  const readKey = Effect.fn("FileStorage.readKey")(function* (file: string) {
    const content = yield* fs.readFileString(file)
    return yield* Effect.try({
      try: () => parseKey(parseCredentialFile(JSON.parse(content)).private_key),
      catch: storageError("FileKeyStore.get"),
    })
  })

  const readMulti = Effect.fn("FileStorage.readMulti")(function* (id: string) {
    const dir = multiPath(id)
    const stat = yield* fs.stat(dir)
    if (stat.type !== "Directory") return null
    const files = yield* fs.readDirectory(dir)
    const file = files.find(isKeyFile)
    return file ? yield* readKey(`${dir}/${file}`) : null
  })

  return {
    add: Effect.fn("FileStorage.add")(
      function* (id: string, key: KeyPair, metadata?: CredentialMetadata) {
        yield* fs.makeDirectory(directory, { recursive: true })
        const content = yield* Effect.try({
          try: () => JSON.stringify(makeCredential(id, key, metadata), null, 2),
          catch: storageError("FileKeyStore.add"),
        })
        yield* fs.writeFileString(keyPath(id), content)
      },
      Effect.mapError(storageError("FileKeyStore.add")),
    ),
    get: Effect.fn("FileStorage.get")(
      function* (id: string) {
        return yield* readKey(keyPath(id)).pipe(
          Effect.catchIf(
            (error) => PlatformError.isPlatformError(error) && isMissing(error),
            () => readMulti(id),
          ),
          Effect.catchIf(
            (error) => PlatformError.isPlatformError(error) && isMissing(error),
            () => Effect.succeed(null),
          ),
        )
      },
      Effect.mapError(storageError("FileKeyStore.get")),
    ),
    remove: Effect.fn("FileStorage.remove")(
      function* (id: string) {
        yield* fs
          .remove(keyPath(id))
          .pipe(Effect.catchIf(isMissing, () => Effect.void))
        yield* fs
          .remove(multiPath(id), { recursive: true, force: true })
          .pipe(Effect.catchIf(isMissing, () => Effect.void))
      },
      Effect.mapError(storageError("FileKeyStore.remove")),
    ),
    list: Effect.fn("FileStorage.list")(
      function* () {
        const files = yield* fs
          .readDirectory(directory)
          .pipe(Effect.catchIf(isMissing, () => Effect.succeed([])))
        const accounts = new Set<string>()
        for (const file of files) {
          const filePath = `${directory}/${file}`
          // The former Dirent boundary ignored symlinks rather than following them.
          const symlink = yield* fs
            .readLink(filePath)
            .pipe(
              Effect.match({ onFailure: () => false, onSuccess: () => true }),
            )
          if (symlink) continue
          const stat = yield* fs.stat(filePath)
          if (stat.type === "File" && file.endsWith(".json"))
            accounts.add(file.replace(".json", ""))
          else if (stat.type === "Directory") {
            const nested = yield* fs
              .readDirectory(filePath)
              .pipe(Effect.orElseSucceed(() => []))
            if (nested.some(isKeyFile)) accounts.add(file)
          }
        }
        return Array.from(accounts).sort()
      },
      Effect.mapError(storageError("FileKeyStore.list")),
    ),
  } satisfies FileStorageService
})

/** Node-only layer implementing the shared key-store service. */
export const FileStorage = {
  layer: (options: FileStorageOptions = {}) =>
    Layer.effect(KeyStore, makeFileStorage(options)),
}
