/** File storage compatible with near-cli and near-cli-rs credentials. */
import { NodeFileSystem } from "@effect/platform-node"
import { Effect } from "effect"
import type { KeyPair, KeyStore } from "../core/types.js"
import { makeFileStorage } from "../effect/file-keystore.js"
import { runPromise } from "../effect/runtime.js"
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
      ),
    )
  }

  addEffect(accountId: string, key: KeyPair, options?: CredentialMetadata) {
    return this.storage.add(accountId, key, options)
  }

  getEffect(accountId: string) {
    return this.storage.get(accountId)
  }
  removeEffect(accountId: string) {
    return this.storage.remove(accountId)
  }
  listEffect() {
    return this.storage.list()
  }

  add(
    accountId: string,
    key: KeyPair,
    options?: CredentialMetadata,
  ): Promise<void> {
    return runPromise(this.addEffect(accountId, key, options))
  }

  get(accountId: string): Promise<KeyPair | null> {
    return runPromise(this.getEffect(accountId))
  }
  remove(accountId: string): Promise<void> {
    return runPromise(this.removeEffect(accountId))
  }
  list(): Promise<string[]> {
    return runPromise(this.listEffect())
  }
}
