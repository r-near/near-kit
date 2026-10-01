import * as fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem"
import { Cause, ConfigProvider, Effect, Exit, Layer } from "effect"
import { afterEach, describe, expect, test, vi } from "vitest"
import { ZodError } from "zod"
import { KeyStore } from "../../src/effect/keys.js"
import { FileStorage } from "../../src/effect/file-keystore.js"
import {
  makeNativeStorage,
  NativeStorage,
} from "../../src/effect/native-keystore.js"
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

describe("native resource key-store boundaries", () => {
  test("an explicit credential directory works without environment configuration", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "near-effect-explicit-path-"),
    )
    const unavailable = ConfigProvider.make(() =>
      Effect.fail(
        new ConfigProvider.SourceError({ message: "environment unavailable" }),
      ),
    )
    try {
      const key = generateKey()
      const stored = await Effect.runPromise(
        Effect.gen(function* () {
          const storage = yield* KeyStore
          yield* storage.add("alice.testnet", key)
          return yield* storage.get("alice.testnet")
        }).pipe(
          Effect.provide(
            FileStorage.layer({ basePath: directory }).pipe(
              Layer.provide(NodeFileSystem.layer),
            ),
          ),
          Effect.provideService(ConfigProvider.ConfigProvider, unavailable),
        ),
      )
      expect(stored?.secretKey).toBe(key.secretKey)
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })

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
          const storage = yield* KeyStore
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

  test("filesystem credential encoding failures stay typed without writing a file", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "near-effect-encoding-"),
    )
    const key = generateKey()
    const rejection = new Error("external public key encoding denied")
    const encoding = vi
      .spyOn(key.publicKey, "toString")
      .mockImplementation(() => {
        throw rejection
      })
    try {
      const exit = await Effect.runPromiseExit(
        Effect.gen(function* () {
          const store = yield* KeyStore
          yield* store.add("alice.testnet", key)
        }).pipe(
          Effect.provide(
            FileStorage.layer({ basePath: directory }).pipe(
              Layer.provide(NodeFileSystem.layer),
            ),
          ),
        ),
      )
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(Cause.hasFails(exit.cause)).toBe(true)
        expect(Cause.hasDies(exit.cause)).toBe(false)
        const error = Cause.squash(exit.cause)
        expect(error).toBeInstanceOf(ExternalError)
        if (error instanceof ExternalError) expect(error.cause).toBe(rejection)
      }
      expect(await fs.readdir(directory)).toEqual([])
    } finally {
      encoding.mockRestore()
      await fs.rm(directory, { recursive: true, force: true })
    }
  })

  // The mock owns only OS storage. Serialization and legacy normalization are
  // exercised at the native keyring boundary, which has no previous tests.
  test("keyring layer stores NEAR CLI metadata and reads legacy secrets", async () => {
    const key = generateKey()
    await Effect.runPromise(
      Effect.gen(function* () {
        const storage = yield* makeNativeStorage("Effect test")
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
      }),
    )
  })

  test("keyring permission errors retain identity while missing credentials remain absent", async () => {
    const store = new NativeKeyStore()
    const denied = new Error("keyring access denied")
    keyring.error = denied
    await expect(store.get("alice.testnet")).rejects.toBe(denied)
    const nativeError = await Effect.runPromise(
      Effect.flatMap(KeyStore, (storage) =>
        storage.remove("alice.testnet"),
      ).pipe(Effect.provide(NativeStorage.layer()), Effect.flip),
    )
    expect(nativeError).toBeInstanceOf(ExternalError)
    expect(nativeError.cause).toBe(denied)
    keyring.error = new Error("credential not found")
    await expect(store.get("alice.testnet")).resolves.toBeNull()
    await expect(store.remove("alice.testnet")).resolves.toBeUndefined()
  })

  test.each([
    { stage: "JSON", stored: "{", error: SyntaxError },
    { stage: "schema", stored: "{}", error: ZodError },
    {
      stage: "key",
      stored: JSON.stringify({ public_key: "unused", private_key: "invalid" }),
      error: Error,
    },
  ])(
    "keyring $stage decoding failures stay typed",
    async ({ stored, error }) => {
      keyring.value = stored
      const exit = await Effect.runPromiseExit(
        Effect.flatMap(makeNativeStorage(), (store) =>
          store.get("alice.testnet"),
        ),
      )
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(Cause.hasDies(exit.cause)).toBe(false)
        const failure = Cause.squash(exit.cause)
        expect(failure).toBeInstanceOf(ExternalError)
        if (failure instanceof ExternalError) {
          expect(failure.operation).toBe("NativeKeyStore.get")
          expect(failure.cause).toBeInstanceOf(error)
        }
      }
    },
  )
})
