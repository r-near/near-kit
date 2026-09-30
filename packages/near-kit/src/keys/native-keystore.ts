/** Native OS credential storage using @napi-rs/keyring. Node.js/Bun only. */
import * as Effect from "effect/Effect"
import type { KeyPair, KeyStore } from "../core/types.js"
import { makeNativeStorage } from "../effect/native-keystore.js"
import { fromPromise, runPromise } from "../effect/runtime.js"
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
    if (this.add !== originalMethods.add)
      return fromPromise(
        () => this.add(accountId, key, options),
        "NativeKeyStore.add",
      )
    return this.storage.add(accountId, key, options)
  }
  getEffect(accountId: string) {
    if (this.get !== originalMethods.get)
      return fromPromise(() => this.get(accountId), "NativeKeyStore.get")
    return this.storage.get(accountId)
  }
  removeEffect(accountId: string) {
    if (this.remove !== originalMethods.remove)
      return fromPromise(() => this.remove(accountId), "NativeKeyStore.remove")
    return this.storage.remove(accountId)
  }
  listEffect() {
    if (this.list !== originalMethods.list)
      return fromPromise(() => this.list(), "NativeKeyStore.list")
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
  add: NativeKeyStore.prototype.add,
  get: NativeKeyStore.prototype.get,
  remove: NativeKeyStore.prototype.remove,
  list: NativeKeyStore.prototype.list,
}
/* oxlint-enable typescript/unbound-method */
