/** Native OS credential storage using @napi-rs/keyring. Node.js/Bun only. */
import { Effect } from "effect"
import type { KeyPair, KeyStore } from "../core/types.js"
import { makeNativeStorage } from "../effect/native-keystore.js"
import { runPromise } from "../effect/runtime.js"
import type { CredentialMetadata } from "./credential-schemas.js"

/**
 * Stores credentials in macOS Keychain, Windows Credential Manager, or the
 * Linux keyring. The optional native dependency loads on first access.
 * OS keyrings do not support enumeration, so `list()` returns an empty array.
 */
export class NativeKeyStore implements KeyStore {
  private readonly storage

  constructor(service = "NEAR Credentials") {
    this.storage = Effect.runSync(makeNativeStorage(service))
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
