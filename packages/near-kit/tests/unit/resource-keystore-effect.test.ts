import * as fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem"
import { Effect, Layer } from "effect"
import { afterEach, describe, expect, test, vi } from "vitest"
import { ZodError } from "zod"
import type { KeyPair } from "../../src/core/types.js"
import { getKeyEffect } from "../../src/effect/keys.js"
import { FileKeyStore } from "../../src/keys/file-keystore.js"
import { FileStorage } from "../../src/effect/file-keystore.js"
import { NativeStorage } from "../../src/effect/native-keystore.js"
import { ExternalError } from "../../src/effect/runtime.js"
import { NativeKeyStore } from "../../src/keys/native-keystore.js"
import { generateKey } from "../../src/utils/key.js"

const keyring = vi.hoisted(() => ({
  value: null as string | null,
  error: undefined as Error | undefined,
  service: "",
  account: "",
}))
vi.mock("@napi-rs/keyring", () => ({
  Entry: class {
    constructor(service: string, account: string) {
      keyring.service = service
      keyring.account = account
    }
    getPassword() {
      if (keyring.error) throw keyring.error
      return keyring.value
    }
    setPassword(value: string) {
      if (keyring.error) throw keyring.error
      keyring.value = value
    }
    deletePassword() {
      if (keyring.error) throw keyring.error
      keyring.value = null
    }
  },
}))

afterEach(() => {
  keyring.value = null
  keyring.error = undefined
})

describe.each(["file", "native"] as const)(
  "%s Promise extension boundaries",
  (kind) => {
    test("native lookup honors policy overrides, errors, and calls through super", async () => {
      const directory = await fs.mkdtemp(
        path.join(os.tmpdir(), "near-policy-store-"),
      )
      const key = generateKey()
      const alternate = generateKey()
      const denied = new Error("signing policy denied access")
      let policy: "alternate" | "denied" | "stored" = "alternate"
      const applyPolicy = async (read: () => Promise<KeyPair | null>) => {
        if (policy === "denied") throw denied
        if (policy === "alternate") return alternate
        return read()
      }
      class PolicyFileStore extends FileKeyStore {
        override get(id: string) {
          return applyPolicy(() => super.get(id))
        }
      }
      class PolicyNativeStore extends NativeKeyStore {
        override get(id: string) {
          return applyPolicy(() => super.get(id))
        }
      }
      const store =
        kind === "file"
          ? new PolicyFileStore(directory)
          : new PolicyNativeStore("Policy test")
      try {
        await store.add("alice.testnet", key)
        expect(
          await Effect.runPromise(getKeyEffect(store, "alice.testnet")),
        ).toBe(alternate)
        policy = "denied"
        const error = await Effect.runPromise(
          getKeyEffect(store, "alice.testnet").pipe(Effect.flip),
        )
        expect(error).toBeInstanceOf(ExternalError)
        expect(error.cause).toBe(denied)
        policy = "stored"
        expect(
          (await Effect.runPromise(getKeyEffect(store, "alice.testnet")))
            ?.secretKey,
        ).toBe(key.secretKey)
      } finally {
        await fs.rm(directory, { recursive: true, force: true })
      }
    })
  },
)

describe("native resource key-store boundaries", () => {
  // Existing FileKeyStore tests own disk format compatibility. This guards the
  // native injectable service and its typed failure channel without Promise calls.
  test("filesystem layer reports malformed persisted credentials as a typed failure", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "near-effect-store-"),
    )
    try {
      await fs.writeFile(
        path.join(directory, "broken.testnet.json"),
        JSON.stringify({ public_key: "ed25519:invalid" }),
      )
      const error = await Effect.runPromise(
        Effect.gen(function* () {
          const storage = yield* FileStorage
          return yield* storage.get("broken.testnet").pipe(Effect.flip)
        }).pipe(
          Effect.provide(
            FileStorage.layer({ basePath: directory }).pipe(
              Layer.provide(NodeFileSystem.layer),
            ),
          ),
        ),
      )
      expect(error).toBeInstanceOf(ExternalError)
      expect(error.operation).toBe("FileKeyStore.get")
      expect(error.cause).toBeInstanceOf(ZodError)
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })

  // The mock owns only OS storage. Serialization and legacy normalization are
  // exercised at the native keyring boundary, which has no previous tests.
  test("keyring layer stores NEAR CLI metadata and reads legacy secrets", async () => {
    const key = generateKey()
    await Effect.runPromise(
      Effect.gen(function* () {
        const storage = yield* NativeStorage
        yield* storage.add("alice.testnet", key, {
          seedPhrase: "seed words",
          derivationPath: "m/44'/397'/0'",
        })
        expect(JSON.parse(keyring.value ?? "null")).toEqual({
          account_id: "alice.testnet",
          public_key: key.publicKey.toString(),
          private_key: key.secretKey,
          master_seed_phrase: "seed words",
          seed_phrase_hd_path: "m/44'/397'/0'",
        })
        keyring.value = JSON.stringify({
          public_key: key.publicKey.toString(),
          secret_key: key.secretKey,
        })
        expect((yield* storage.get("alice.testnet"))?.secretKey).toBe(
          key.secretKey,
        )
        expect(keyring.service).toBe("Effect test")
        expect(keyring.account).toBe("alice.testnet")
        yield* storage.remove("alice.testnet")
        expect(keyring.value).toBeNull()
      }).pipe(Effect.provide(NativeStorage.layer("Effect test"))),
    )
  })

  test("keyring permission errors retain identity while missing credentials remain absent", async () => {
    const store = new NativeKeyStore()
    const denied = new Error("keyring access denied")
    keyring.error = denied
    await expect(store.get("alice.testnet")).rejects.toBe(denied)
    const nativeError = await Effect.runPromise(
      store.removeEffect("alice.testnet").pipe(Effect.flip),
    )
    expect(nativeError).toBeInstanceOf(ExternalError)
    expect(nativeError.cause).toBe(denied)
    keyring.error = new Error("credential not found")
    await expect(store.get("alice.testnet")).resolves.toBeNull()
    await expect(store.remove("alice.testnet")).resolves.toBeUndefined()
  })
})
