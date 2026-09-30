/** File storage compatible with near-cli and near-cli-rs credentials. */
import { NodeFileSystem } from "@effect/platform-node"
import { ConfigProvider, Effect } from "effect"
import type { KeyPair, KeyStore } from "../core/types.js"
import { makeFileStorage } from "../effect/file-keystore.js"
import { fromPromise, runPromise } from "../effect/runtime.js"
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
  private readonly storage

  constructor(basePath = "~/.near-credentials", network?: Network) {
    this.storage = Effect.runSync(
      makeFileStorage({ basePath, ...(network ? { network } : {}) }).pipe(
        Effect.provide(NodeFileSystem.layer),
        Effect.provideService(
          ConfigProvider.ConfigProvider,
          ConfigProvider.fromEnv(),
        ),
      ),
    )
  }

  addEffect(accountId: string, key: KeyPair, options?: CredentialMetadata) {
    if (this.add !== originalMethods.add)
      return fromPromise(
        () => this.add(accountId, key, options),
        "FileKeyStore.add",
      )
    return this.storage.add(accountId, key, options)
  }

  getEffect(accountId: string) {
    if (this.get !== originalMethods.get)
      return fromPromise(() => this.get(accountId), "FileKeyStore.get")
    return this.storage.get(accountId)
  }
  removeEffect(accountId: string) {
    if (this.remove !== originalMethods.remove)
      return fromPromise(() => this.remove(accountId), "FileKeyStore.remove")
    return this.storage.remove(accountId)
  }
  listEffect() {
    if (this.list !== originalMethods.list)
      return fromPromise(() => this.list(), "FileKeyStore.list")
    return this.storage.list()
  }

  add(
    accountId: string,
    key: KeyPair,
    options?: CredentialMetadata,
  ): Promise<void> {
    return runPromise(this.storage.add(accountId, key, options))
  }

  get(accountId: string): Promise<KeyPair | null> {
    return runPromise(this.storage.get(accountId))
  }
  remove(accountId: string): Promise<void> {
    return runPromise(this.storage.remove(accountId))
  }
  list(): Promise<string[]> {
    return runPromise(this.storage.list())
  }
}

// Promise overrides are external extension points; super calls enter the native
// storage directly, avoiding override recursion at the Effect boundary.
/* oxlint-disable typescript/unbound-method -- Identity comparisons only; these methods are never invoked unbound. */
const originalMethods = {
  add: FileKeyStore.prototype.add,
  get: FileKeyStore.prototype.get,
  remove: FileKeyStore.prototype.remove,
  list: FileKeyStore.prototype.list,
}
/* oxlint-enable typescript/unbound-method */
