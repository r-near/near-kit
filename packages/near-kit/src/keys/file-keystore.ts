import { nativeKeyStore } from "../effect/keys.js"
/** File storage compatible with near-cli and near-cli-rs credentials. */
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem"
import * as ConfigProvider from "effect/ConfigProvider"
import * as Effect from "effect/Effect"
import type { KeyPair, KeyStore } from "../core/types.js"
import { makeFileStorage } from "../effect/file-keystore.js"
import { runPromise, runSync } from "../effect/runtime.js"
import type { CredentialMetadata, Network } from "./credential-schemas.js"

/**
 * Stores `{accountId}.json` files, with optional network subdirectories, and
 * reads NEAR CLI multi-key directories. Node.js/Bun only.
 *
 * @example
 * const store = new FileKeyStore("~/.near-credentials", "testnet")
 * await store.add("alice.testnet", keyPair)
 */
export class FileKeyStore implements KeyStore {
  readonly [nativeKeyStore]: Effect.Success<ReturnType<typeof makeFileStorage>>

  constructor(basePath = "~/.near-credentials", network?: Network) {
    this[nativeKeyStore] = runSync(
      makeFileStorage({ basePath, ...(network ? { network } : {}) }).pipe(
        Effect.provide(NodeFileSystem.layer),
        Effect.provideService(
          ConfigProvider.ConfigProvider,
          ConfigProvider.fromEnv(),
        ),
      ),
    )
  }

  add(
    accountId: string,
    key: KeyPair,
    options?: CredentialMetadata,
  ): Promise<void> {
    return runPromise(this[nativeKeyStore].add(accountId, key, options))
  }

  get(accountId: string): Promise<KeyPair | null> {
    return runPromise(this[nativeKeyStore].get(accountId))
  }
  remove(accountId: string): Promise<void> {
    return runPromise(this[nativeKeyStore].remove(accountId))
  }
  list(): Promise<string[]> {
    return runPromise(this[nativeKeyStore].list())
  }
}
