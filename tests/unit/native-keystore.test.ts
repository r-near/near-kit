import { beforeEach, describe, expect, it, vi } from "vitest"

import { NativeKeyStore } from "../../src/keys/native-keystore.js"
import { generateKey } from "../../src/utils/key.js"

const store = new Map<string, string>()
let throwOnGet: Error | null = null
let throwOnDelete: Error | null = null

vi.mock("@napi-rs/keyring", () => {
  class Entry {
    #service: string
    #accountId: string

    constructor(service: string, accountId: string) {
      this.#service = service
      this.#accountId = accountId
    }

    setPassword(value: string) {
      store.set(`${this.#service}:${this.#accountId}`, value)
    }

    getPassword() {
      if (throwOnGet) {
        throw throwOnGet
      }
      return store.get(`${this.#service}:${this.#accountId}`)
    }

    deletePassword() {
      if (throwOnDelete) {
        throw throwOnDelete
      }
      const deleted = store.delete(`${this.#service}:${this.#accountId}`)
      if (!deleted) {
        throw new Error("not found")
      }
    }
  }

  return { Entry }
})

describe("NativeKeyStore", () => {
  beforeEach(() => {
    store.clear()
    throwOnGet = null
    throwOnDelete = null
  })

  it("stores and retrieves keys via OS keyring", async () => {
    const keyStore = new NativeKeyStore("Test Service")
    const keyPair = generateKey()

    await keyStore.add("alice.near", keyPair, {
      seedPhrase: "test seed phrase",
      derivationPath: "m/44'/397'/0'",
      implicitAccountId: "implicit-id",
    })

    const retrieved = await keyStore.get("alice.near")
    expect(retrieved?.secretKey).toBe(keyPair.secretKey)
  })

  it("returns null when key is missing or not found", async () => {
    const keyStore = new NativeKeyStore()
    const missing = await keyStore.get("missing.near")
    expect(missing).toBeNull()

    throwOnGet = new Error("credential not found")
    const missingFromKeyring = await keyStore.get("missing.near")
    expect(missingFromKeyring).toBeNull()
  })

  it("rethrows unexpected get errors", async () => {
    const keyStore = new NativeKeyStore()
    throwOnGet = new Error("permission denied")

    await expect(keyStore.get("alice.near")).rejects.toThrow(
      "permission denied",
    )
  })

  it("ignores not found errors on remove", async () => {
    const keyStore = new NativeKeyStore()
    throwOnDelete = new Error("not found")

    await expect(keyStore.remove("ghost.near")).resolves.toBeUndefined()
  })

  it("rethrows unexpected keyring errors on remove", async () => {
    const keyStore = new NativeKeyStore()
    throwOnDelete = new Error("permission denied")

    await expect(keyStore.remove("alice.near")).rejects.toThrow(
      "permission denied",
    )
  })

  it("lists accounts as empty array", async () => {
    const keyStore = new NativeKeyStore()
    const list = await keyStore.list()
    expect(list).toEqual([])
  })
})
