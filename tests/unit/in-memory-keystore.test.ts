/**
 * Comprehensive tests for InMemoryKeyStore class
 */

import { describe, expect, test } from "vitest"
import { InMemoryKeyStore } from "../../src/keys/in-memory-keystore.js"
import {
  Ed25519KeyPair,
  generateKey,
  Secp256k1KeyPair,
} from "../../src/utils/key.js"

describe("InMemoryKeyStore - Constructor", () => {
  test("should create empty keystore", async () => {
    const keyStore = new InMemoryKeyStore()
    const accounts = await keyStore.list()
    expect(accounts).toEqual([])
  })

  test("should pre-populate with single ed25519 key", async () => {
    const key = generateKey()
    const keyStore = new InMemoryKeyStore({
      "alice.near": key.secretKey,
    })

    const retrieved = await keyStore.get("alice.near")
    expect(retrieved).toBeTruthy()
    expect(retrieved?.publicKey.toString()).toBe(key.publicKey.toString())
  })

  test("should pre-populate with multiple keys", async () => {
    const key1 = generateKey()
    const key2 = generateKey()
    const key3 = generateKey()

    const keyStore = new InMemoryKeyStore({
      "alice.near": key1.secretKey,
      "bob.near": key2.secretKey,
      "charlie.near": key3.secretKey,
    })

    const accounts = await keyStore.list()
    expect(accounts.length).toBe(3)
    expect(accounts).toContain("alice.near")
    expect(accounts).toContain("bob.near")
    expect(accounts).toContain("charlie.near")
  })

  test("should parse ed25519 key strings during initialization", async () => {
    const key = generateKey()
    const keyString = key.secretKey

    const keyStore = new InMemoryKeyStore({
      "test.near": keyString,
    })

    const retrieved = await keyStore.get("test.near")
    expect(retrieved).toBeTruthy()
    expect(retrieved?.secretKey).toBe(keyString)
  })

  test("should parse secp256k1 key strings during initialization", async () => {
    const key = Secp256k1KeyPair.fromRandom()
    const keyString = key.secretKey

    const keyStore = new InMemoryKeyStore({
      "test.near": keyString,
    })

    const retrieved = await keyStore.get("test.near")
    expect(retrieved).toBeTruthy()
    expect(retrieved?.secretKey).toBe(keyString)
    expect(retrieved?.publicKey.toString()).toContain("secp256k1:")
  })

  test("should handle mixed ed25519 and secp256k1 keys", async () => {
    const ed25519Key = Ed25519KeyPair.fromRandom()
    const secp256k1Key = Secp256k1KeyPair.fromRandom()

    const keyStore = new InMemoryKeyStore({
      "ed25519.near": ed25519Key.secretKey,
      "secp256k1.near": secp256k1Key.secretKey,
    })

    const ed25519Retrieved = await keyStore.get("ed25519.near")
    const secp256k1Retrieved = await keyStore.get("secp256k1.near")

    expect(ed25519Retrieved?.publicKey.toString()).toContain("ed25519:")
    expect(secp256k1Retrieved?.publicKey.toString()).toContain("secp256k1:")
  })
})

describe("InMemoryKeyStore - add() method", () => {
  test("should add a single key", async () => {
    const keyStore = new InMemoryKeyStore()
    const key = generateKey()

    await keyStore.add("alice.near", key)

    const retrieved = await keyStore.get("alice.near")
    expect(retrieved).toBeTruthy()
    expect(retrieved?.publicKey.toString()).toBe(key.publicKey.toString())
  })

  test("should add multiple keys", async () => {
    const keyStore = new InMemoryKeyStore()
    const key1 = generateKey()
    const key2 = generateKey()
    const key3 = generateKey()

    await keyStore.add("alice.near", key1)
    await keyStore.add("bob.near", key2)
    await keyStore.add("charlie.near", key3)

    const accounts = await keyStore.list()
    expect(accounts.length).toBe(3)
  })

  test("should overwrite existing keys", async () => {
    const keyStore = new InMemoryKeyStore()
    const key1 = generateKey()
    const key2 = generateKey()

    await keyStore.add("alice.near", key1)
    await keyStore.add("alice.near", key2)

    const retrieved = await keyStore.get("alice.near")
    expect(retrieved?.publicKey.toString()).toBe(key2.publicKey.toString())
    expect(retrieved?.publicKey.toString()).not.toBe(key1.publicKey.toString())
  })

  test("should complete async operation correctly", async () => {
    const keyStore = new InMemoryKeyStore()
    const key = generateKey()

    const promise = keyStore.add("test.near", key)
    expect(promise).toBeInstanceOf(Promise)

    await promise
    const retrieved = await keyStore.get("test.near")
    expect(retrieved).toBeTruthy()
  })

  test("should add secp256k1 keys", async () => {
    const keyStore = new InMemoryKeyStore()
    const key = Secp256k1KeyPair.fromRandom()

    await keyStore.add("test.near", key)

    const retrieved = await keyStore.get("test.near")
    expect(retrieved?.publicKey.toString()).toContain("secp256k1:")
  })

  test("should handle special characters in account IDs", async () => {
    const keyStore = new InMemoryKeyStore()
    const key = generateKey()

    await keyStore.add("alice-bob_charlie.test.near", key)

    const retrieved = await keyStore.get("alice-bob_charlie.test.near")
    expect(retrieved).toBeTruthy()
  })
})

describe("InMemoryKeyStore - get() method", () => {
  test("should retrieve existing keys", async () => {
    const keyStore = new InMemoryKeyStore()
    const key = generateKey()

    await keyStore.add("alice.near", key)
    const retrieved = await keyStore.get("alice.near")

    expect(retrieved).toBeTruthy()
    expect(retrieved?.publicKey.toString()).toBe(key.publicKey.toString())
    expect(retrieved?.secretKey).toBe(key.secretKey)
  })

  test("should return null for non-existent keys", async () => {
    const keyStore = new InMemoryKeyStore()

    const retrieved = await keyStore.get("nonexistent.near")
    expect(retrieved).toBeNull()
  })

  test("should retrieve after add()", async () => {
    const keyStore = new InMemoryKeyStore()
    const key = generateKey()

    await keyStore.add("test.near", key)
    const retrieved = await keyStore.get("test.near")

    expect(retrieved).not.toBeNull()
    expect(retrieved?.publicKey.data).toEqual(key.publicKey.data)
  })

  test("should retrieve pre-populated keys", async () => {
    const key = generateKey()
    const keyStore = new InMemoryKeyStore({
      "prepopulated.near": key.secretKey,
    })

    const retrieved = await keyStore.get("prepopulated.near")
    expect(retrieved).toBeTruthy()
    expect(retrieved?.publicKey.toString()).toBe(key.publicKey.toString())
  })

  test("should return null for different account ID", async () => {
    const keyStore = new InMemoryKeyStore()
    const key = generateKey()

    await keyStore.add("alice.near", key)
    const retrieved = await keyStore.get("bob.near")

    expect(retrieved).toBeNull()
  })
})

describe("InMemoryKeyStore - remove() method", () => {
  test("should remove existing keys", async () => {
    const keyStore = new InMemoryKeyStore()
    const key = generateKey()

    await keyStore.add("alice.near", key)

    // Verify key exists
    let retrieved = await keyStore.get("alice.near")
    expect(retrieved).toBeTruthy()

    // Remove the key
    await keyStore.remove("alice.near")

    // Verify key is gone
    retrieved = await keyStore.get("alice.near")
    expect(retrieved).toBeNull()
  })

  test("should not throw when removing non-existent keys", async () => {
    const keyStore = new InMemoryKeyStore()

    // Should not throw
    await expect(keyStore.remove("nonexistent.near")).resolves.toBeUndefined()
  })

  test("should verify key is gone after remove", async () => {
    const keyStore = new InMemoryKeyStore()
    const key1 = generateKey()
    const key2 = generateKey()

    await keyStore.add("alice.near", key1)
    await keyStore.add("bob.near", key2)

    await keyStore.remove("alice.near")

    const aliceRetrieved = await keyStore.get("alice.near")
    const bobRetrieved = await keyStore.get("bob.near")

    expect(aliceRetrieved).toBeNull()
    expect(bobRetrieved).toBeTruthy()
  })

  test("should remove from list()", async () => {
    const keyStore = new InMemoryKeyStore()
    const key = generateKey()

    await keyStore.add("test.near", key)
    await keyStore.remove("test.near")

    const accounts = await keyStore.list()
    expect(accounts).not.toContain("test.near")
  })

  test("should handle removing same key multiple times", async () => {
    const keyStore = new InMemoryKeyStore()
    const key = generateKey()

    await keyStore.add("test.near", key)
    await keyStore.remove("test.near")
    await keyStore.remove("test.near")
    await keyStore.remove("test.near")

    const retrieved = await keyStore.get("test.near")
    expect(retrieved).toBeNull()
  })
})

describe("InMemoryKeyStore - list() method", () => {
  test("should list all account IDs", async () => {
    const keyStore = new InMemoryKeyStore()
    const key1 = generateKey()
    const key2 = generateKey()
    const key3 = generateKey()

    await keyStore.add("alice.near", key1)
    await keyStore.add("bob.near", key2)
    await keyStore.add("charlie.near", key3)

    const accounts = await keyStore.list()

    expect(accounts.length).toBe(3)
    expect(accounts).toContain("alice.near")
    expect(accounts).toContain("bob.near")
    expect(accounts).toContain("charlie.near")
  })

  test("should return empty list for empty keystore", async () => {
    const keyStore = new InMemoryKeyStore()

    const accounts = await keyStore.list()
    expect(accounts).toEqual([])
  })

  test("should list after adding multiple keys", async () => {
    const keyStore = new InMemoryKeyStore()

    expect(await keyStore.list()).toEqual([])

    await keyStore.add("alice.near", generateKey())
    expect((await keyStore.list()).length).toBe(1)

    await keyStore.add("bob.near", generateKey())
    expect((await keyStore.list()).length).toBe(2)
  })

  test("should list after removing keys", async () => {
    const keyStore = new InMemoryKeyStore()
    const key1 = generateKey()
    const key2 = generateKey()

    await keyStore.add("alice.near", key1)
    await keyStore.add("bob.near", key2)

    let accounts = await keyStore.list()
    expect(accounts.length).toBe(2)

    await keyStore.remove("alice.near")

    accounts = await keyStore.list()
    expect(accounts.length).toBe(1)
    expect(accounts).toContain("bob.near")
    expect(accounts).not.toContain("alice.near")
  })

  test("should list pre-populated keys", async () => {
    const keyStore = new InMemoryKeyStore({
      "alice.near": generateKey().secretKey,
      "bob.near": generateKey().secretKey,
    })

    const accounts = await keyStore.list()
    expect(accounts.length).toBe(2)
    expect(accounts).toContain("alice.near")
    expect(accounts).toContain("bob.near")
  })
})

describe("InMemoryKeyStore - clear() method", () => {
  test("should clear all keys", async () => {
    const keyStore = new InMemoryKeyStore()
    const key1 = generateKey()
    const key2 = generateKey()

    await keyStore.add("alice.near", key1)
    await keyStore.add("bob.near", key2)

    keyStore.clear()

    const accounts = await keyStore.list()
    expect(accounts).toEqual([])
  })

  test("should verify list() is empty after clear()", async () => {
    const keyStore = new InMemoryKeyStore({
      "alice.near": generateKey().secretKey,
      "bob.near": generateKey().secretKey,
      "charlie.near": generateKey().secretKey,
    })

    expect((await keyStore.list()).length).toBe(3)

    keyStore.clear()

    expect(await keyStore.list()).toEqual([])
  })

  test("should verify get() returns null after clear()", async () => {
    const keyStore = new InMemoryKeyStore()
    const key = generateKey()

    await keyStore.add("alice.near", key)
    expect(await keyStore.get("alice.near")).toBeTruthy()

    keyStore.clear()

    expect(await keyStore.get("alice.near")).toBeNull()
  })

  test("should allow adding keys after clear()", async () => {
    const keyStore = new InMemoryKeyStore()
    const key1 = generateKey()
    const key2 = generateKey()

    await keyStore.add("alice.near", key1)
    keyStore.clear()
    await keyStore.add("bob.near", key2)

    const accounts = await keyStore.list()
    expect(accounts.length).toBe(1)
    expect(accounts).toContain("bob.near")
  })

  test("should not throw when clearing empty keystore", () => {
    const keyStore = new InMemoryKeyStore()
    expect(() => keyStore.clear()).not.toThrow()
  })
})

describe("InMemoryKeyStore - Edge cases", () => {
  test("should handle adding and removing same key multiple times", async () => {
    const keyStore = new InMemoryKeyStore()
    const key1 = generateKey()
    const key2 = generateKey()

    await keyStore.add("test.near", key1)
    await keyStore.remove("test.near")
    await keyStore.add("test.near", key2)
    await keyStore.remove("test.near")
    await keyStore.add("test.near", key1)

    const retrieved = await keyStore.get("test.near")
    expect(retrieved?.publicKey.toString()).toBe(key1.publicKey.toString())
  })

  test("should handle initial keys with both ed25519 and secp256k1", async () => {
    const ed25519Key = Ed25519KeyPair.fromRandom()
    const secp256k1Key = Secp256k1KeyPair.fromRandom()

    const keyStore = new InMemoryKeyStore({
      "ed25519.near": ed25519Key.secretKey,
      "secp256k1.near": secp256k1Key.secretKey,
    })

    const ed25519Retrieved = await keyStore.get("ed25519.near")
    const secp256k1Retrieved = await keyStore.get("secp256k1.near")

    expect(ed25519Retrieved?.publicKey.toString()).toContain("ed25519:")
    expect(secp256k1Retrieved?.publicKey.toString()).toContain("secp256k1:")
  })

  test("should handle large number of keys", async () => {
    const keyStore = new InMemoryKeyStore()
    const count = 100

    // Add 100 keys
    for (let i = 0; i < count; i++) {
      await keyStore.add(`account${i}.near`, generateKey())
    }

    const accounts = await keyStore.list()
    expect(accounts.length).toBe(count)
  })

  test("should handle special characters in account IDs", async () => {
    const keyStore = new InMemoryKeyStore()
    // const key = generateKey()

    const specialAccounts = [
      "alice-bob.near",
      "test_account.near",
      "a.b.c.d.near",
      "123.near",
      "alice.test.near",
    ]

    for (const account of specialAccounts) {
      await keyStore.add(account, generateKey())
    }

    const accounts = await keyStore.list()
    expect(accounts.length).toBe(specialAccounts.length)

    for (const account of specialAccounts) {
      expect(accounts).toContain(account)
    }
  })

  test("should handle implicit account IDs (hex strings)", async () => {
    const keyStore = new InMemoryKeyStore()
    const key = generateKey()
    const implicitAccountId =
      "e3cb032dbb6e8f45239c79652ba94172378f940d340b429ce5076d1a2f7366e2"

    await keyStore.add(implicitAccountId, key)

    const retrieved = await keyStore.get(implicitAccountId)
    expect(retrieved).toBeTruthy()
  })
})

describe("InMemoryKeyStore - Integration between methods", () => {
  test("add() → get() → remove() → get()", async () => {
    const keyStore = new InMemoryKeyStore()
    const key = generateKey()

    // add()
    await keyStore.add("test.near", key)

    // get() - should exist
    let retrieved = await keyStore.get("test.near")
    expect(retrieved).toBeTruthy()

    // remove()
    await keyStore.remove("test.near")

    // get() - should not exist
    retrieved = await keyStore.get("test.near")
    expect(retrieved).toBeNull()
  })

  test("add() → list() → clear() → list()", async () => {
    const keyStore = new InMemoryKeyStore()

    // add() multiple keys
    await keyStore.add("alice.near", generateKey())
    await keyStore.add("bob.near", generateKey())
    await keyStore.add("charlie.near", generateKey())

    // list() - should have 3 accounts
    let accounts = await keyStore.list()
    expect(accounts.length).toBe(3)

    // clear()
    keyStore.clear()

    // list() - should be empty
    accounts = await keyStore.list()
    expect(accounts.length).toBe(0)
  })

  test("pre-populated keys can be retrieved and removed", async () => {
    const key1 = generateKey()
    const key2 = generateKey()

    const keyStore = new InMemoryKeyStore({
      "alice.near": key1.secretKey,
      "bob.near": key2.secretKey,
    })

    // Retrieve pre-populated keys
    const aliceKey = await keyStore.get("alice.near")
    const bobKey = await keyStore.get("bob.near")
    expect(aliceKey).toBeTruthy()
    expect(bobKey).toBeTruthy()

    // Remove one
    await keyStore.remove("alice.near")

    // Verify removal
    expect(await keyStore.get("alice.near")).toBeNull()
    expect(await keyStore.get("bob.near")).toBeTruthy()

    // List should have one
    const accounts = await keyStore.list()
    expect(accounts.length).toBe(1)
    expect(accounts).toContain("bob.near")
  })

  test("complex workflow with multiple operations", async () => {
    const keyStore = new InMemoryKeyStore({
      "initial.near": generateKey().secretKey,
    })

    // Add more keys
    await keyStore.add("added1.near", generateKey())
    await keyStore.add("added2.near", generateKey())

    // List should have 3
    expect((await keyStore.list()).length).toBe(3)

    // Remove initial key
    await keyStore.remove("initial.near")

    // List should have 2
    expect((await keyStore.list()).length).toBe(2)

    // Overwrite a key
    const newKey = generateKey()
    await keyStore.add("added1.near", newKey)

    // Verify overwrite
    const retrieved = await keyStore.get("added1.near")
    expect(retrieved?.publicKey.toString()).toBe(newKey.publicKey.toString())

    // Clear all
    keyStore.clear()

    // Verify empty
    expect((await keyStore.list()).length).toBe(0)
    expect(await keyStore.get("added2.near")).toBeNull()
  })
})
