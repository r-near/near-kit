import { nativeKeyStore } from "../effect/keys.js"
/** Native OS credential storage using @napi-rs/keyring. Node.js/Bun only. */
import type * as Effect from "effect/Effect"
import type { KeyPair, KeyStore } from "../core/types.js"
import { makeNativeStorage } from "../effect/native-keystore.js"
import { runPromise, runSync } from "../effect/runtime.js"
import type { CredentialMetadata } from "./credential-schemas.js"

/**
 * Stores credentials in macOS Keychain, Windows Credential Manager, or the
 * Linux keyring. The optional native dependency loads on first access.
 * OS keyrings do not support enumeration, so `list()` returns an empty array.
 */
export class NativeKeyStore implements KeyStore {
  readonly [nativeKeyStore]: Effect.Success<
    ReturnType<typeof makeNativeStorage>
  >

  constructor(service = "NEAR Credentials") {
    this[nativeKeyStore] = runSync(makeNativeStorage(service))
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
