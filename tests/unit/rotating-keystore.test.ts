/**
 * Comprehensive tests for RotatingKeyStore class
 */

import { describe, expect, test } from "bun:test"
import { RotatingKeyStore } from "../../src/keys/rotating-keystore.js"
import {
  Ed25519KeyPair,
  generateKey,
  Secp256k1KeyPair,
} from "../../src/utils/key.js"

describe("RotatingKeyStore - Constructor", () => {
  test("should create empty keystore", async () => {
    const keyStore = new RotatingKeyStore()
    const accounts = await keyStore.list()
    expect(accounts).toEqual([])
  })

  test("should pre-populate with single key", async () => {
    const key = generateKey()
    const keyStore = new RotatingKeyStore({
      "alice.near": [key.secretKey],
    })

    const retrieved = await keyStore.get("alice.near")
    expect(retrieved).toBeTruthy()
    expect(retrieved?.publicKey.toString()).toBe(key.publicKey.toString())
  })

  test("should pre-populate with multiple keys for one account", async () => {
    const key1 = generateKey()
    const key2 = generateKey()
    const key3 = generateKey()

    const keyStore = new RotatingKeyStore({
      "alice.near": [key1.secretKey, key2.secretKey, key3.secretKey],
    })

    const accounts = await keyStore.list()
    expect(accounts.length).toBe(1)
    expect(accounts).toContain("alice.near")

    const allKeys = await keyStore.getAll("alice.near")
    expect(allKeys.length).toBe(3)
  })

  test("should pre-populate with multiple accounts", async () => {
    const key1 = generateKey()
    const key2 = generateKey()
    const key3 = generateKey()

    const keyStore = new RotatingKeyStore({
      "alice.near": [key1.secretKey, key2.secretKey],
      "bob.near": [key3.secretKey],
    })

    const accounts = await keyStore.list()
    expect(accounts.length).toBe(2)
    expect(accounts).toContain("alice.near")
    expect(accounts).toContain("bob.near")
  })

  test("should parse ed25519 key strings during initialization", async () => {
    const key = generateKey()
    const keyString = key.secretKey

    const keyStore = new RotatingKeyStore({
      "test.near": [keyString],
    })

    const retrieved = await keyStore.get("test.near")
    expect(retrieved).toBeTruthy()
    expect(retrieved?.secretKey).toBe(keyString)
  })

  test("should parse secp256k1 key strings during initialization", async () => {
    const key = Secp256k1KeyPair.fromRandom()
    const keyString = key.secretKey

    const keyStore = new RotatingKeyStore({
      "test.near": [keyString],
    })

    const retrieved = await keyStore.get("test.near")
    expect(retrieved).toBeTruthy()
    expect(retrieved?.secretKey).toBe(keyString)
    expect(retrieved?.publicKey.toString()).toContain("secp256k1:")
  })

  test("should handle mixed ed25519 and secp256k1 keys", async () => {
    const ed25519Key1 = Ed25519KeyPair.fromRandom()
    const ed25519Key2 = Ed25519KeyPair.fromRandom()
    const secp256k1Key = Secp256k1KeyPair.fromRandom()

    const keyStore = new RotatingKeyStore({
      "alice.near": [
        ed25519Key1.secretKey,
        secp256k1Key.secretKey,
        ed25519Key2.secretKey,
      ],
    })

    const allKeys = await keyStore.getAll("alice.near")
    expect(allKeys.length).toBe(3)
    expect(allKeys[0]?.publicKey.toString()).toContain("ed25519:")
    expect(allKeys[1]?.publicKey.toString()).toContain("secp256k1:")
    expect(allKeys[2]?.publicKey.toString()).toContain("ed25519:")
  })
})

describe("RotatingKeyStore - add() method", () => {
  test("should add a single key", async () => {
    const keyStore = new RotatingKeyStore()
    const key = generateKey()

    await keyStore.add("alice.near", key)

    const retrieved = await keyStore.get("alice.near")
    expect(retrieved).toBeTruthy()
    expect(retrieved?.publicKey.toString()).toBe(key.publicKey.toString())
  })

  test("should add multiple keys to same account", async () => {
    const keyStore = new RotatingKeyStore()
    const key1 = generateKey()
    const key2 = generateKey()
    const key3 = generateKey()

    await keyStore.add("alice.near", key1)
    await keyStore.add("alice.near", key2)
    await keyStore.add("alice.near", key3)

    const allKeys = await keyStore.getAll("alice.near")
    expect(allKeys.length).toBe(3)
  })

  test("should add keys to different accounts", async () => {
    const keyStore = new RotatingKeyStore()
    const key1 = generateKey()
    const key2 = generateKey()
    const key3 = generateKey()

    await keyStore.add("alice.near", key1)
    await keyStore.add("bob.near", key2)
    await keyStore.add("charlie.near", key3)

    const accounts = await keyStore.list()
    expect(accounts.length).toBe(3)
  })

  test("should NOT overwrite existing keys (appends instead)", async () => {
    const keyStore = new RotatingKeyStore()
    const key1 = generateKey()
    const key2 = generateKey()

    await keyStore.add("alice.near", key1)
    await keyStore.add("alice.near", key2)

    const allKeys = await keyStore.getAll("alice.near")
    expect(allKeys.length).toBe(2)
    expect(allKeys[0]?.publicKey.toString()).toBe(key1.publicKey.toString())
    expect(allKeys[1]?.publicKey.toString()).toBe(key2.publicKey.toString())
  })

  test("should complete async operation correctly", async () => {
    const keyStore = new RotatingKeyStore()
    const key = generateKey()

    const promise = keyStore.add("test.near", key)
    expect(promise).toBeInstanceOf(Promise)

    await promise
    const retrieved = await keyStore.get("test.near")
    expect(retrieved).toBeTruthy()
  })

  test("should add secp256k1 keys", async () => {
    const keyStore = new RotatingKeyStore()
    const key = Secp256k1KeyPair.fromRandom()

    await keyStore.add("test.near", key)

    const retrieved = await keyStore.get("test.near")
    expect(retrieved?.publicKey.toString()).toContain("secp256k1:")
  })
})

describe("RotatingKeyStore - get() method (rotation)", () => {
  test("should retrieve existing keys", async () => {
    const keyStore = new RotatingKeyStore()
    const key = generateKey()

    await keyStore.add("alice.near", key)
    const retrieved = await keyStore.get("alice.near")

    expect(retrieved).toBeTruthy()
    expect(retrieved?.publicKey.toString()).toBe(key.publicKey.toString())
    expect(retrieved?.secretKey).toBe(key.secretKey)
  })

  test("should return null for non-existent keys", async () => {
    const keyStore = new RotatingKeyStore()

    const retrieved = await keyStore.get("nonexistent.near")
    expect(retrieved).toBeNull()
  })

  test("should rotate through multiple keys in round-robin order", async () => {
    const keyStore = new RotatingKeyStore()
    const key1 = generateKey()
    const key2 = generateKey()
    const key3 = generateKey()

    await keyStore.add("alice.near", key1)
    await keyStore.add("alice.near", key2)
    await keyStore.add("alice.near", key3)

    // First rotation cycle
    const retrieved1 = await keyStore.get("alice.near")
    expect(retrieved1?.publicKey.toString()).toBe(key1.publicKey.toString())

    const retrieved2 = await keyStore.get("alice.near")
    expect(retrieved2?.publicKey.toString()).toBe(key2.publicKey.toString())

    const retrieved3 = await keyStore.get("alice.near")
    expect(retrieved3?.publicKey.toString()).toBe(key3.publicKey.toString())

    // Second rotation cycle - back to first key
    const retrieved4 = await keyStore.get("alice.near")
    expect(retrieved4?.publicKey.toString()).toBe(key1.publicKey.toString())

    const retrieved5 = await keyStore.get("alice.near")
    expect(retrieved5?.publicKey.toString()).toBe(key2.publicKey.toString())
  })

  test("should rotate independently for different accounts", async () => {
    const keyStore = new RotatingKeyStore()
    const aliceKey1 = generateKey()
    const aliceKey2 = generateKey()
    const bobKey1 = generateKey()
    const bobKey2 = generateKey()

    await keyStore.add("alice.near", aliceKey1)
    await keyStore.add("alice.near", aliceKey2)
    await keyStore.add("bob.near", bobKey1)
    await keyStore.add("bob.near", bobKey2)

    // Alice gets first key
    const alice1 = await keyStore.get("alice.near")
    expect(alice1?.publicKey.toString()).toBe(aliceKey1.publicKey.toString())

    // Bob gets first key (independent of Alice)
    const bob1 = await keyStore.get("bob.near")
    expect(bob1?.publicKey.toString()).toBe(bobKey1.publicKey.toString())

    // Alice gets second key
    const alice2 = await keyStore.get("alice.near")
    expect(alice2?.publicKey.toString()).toBe(aliceKey2.publicKey.toString())

    // Bob gets second key
    const bob2 = await keyStore.get("bob.near")
    expect(bob2?.publicKey.toString()).toBe(bobKey2.publicKey.toString())
  })

  test("should handle single key (no rotation needed)", async () => {
    const keyStore = new RotatingKeyStore()
    const key = generateKey()

    await keyStore.add("alice.near", key)

    // All calls return the same key
    for (let i = 0; i < 5; i++) {
      const retrieved = await keyStore.get("alice.near")
      expect(retrieved?.publicKey.toString()).toBe(key.publicKey.toString())
    }
  })
})

describe("RotatingKeyStore - getAll() method", () => {
  test("should return all keys without rotation", async () => {
    const keyStore = new RotatingKeyStore()
    const key1 = generateKey()
    const key2 = generateKey()
    const key3 = generateKey()

    await keyStore.add("alice.near", key1)
    await keyStore.add("alice.near", key2)
    await keyStore.add("alice.near", key3)

    // Get all keys multiple times - should not affect rotation
    const allKeys1 = await keyStore.getAll("alice.near")
    const allKeys2 = await keyStore.getAll("alice.near")

    expect(allKeys1.length).toBe(3)
    expect(allKeys2.length).toBe(3)
    expect(allKeys1[0]?.publicKey.toString()).toBe(key1.publicKey.toString())
    expect(allKeys1[1]?.publicKey.toString()).toBe(key2.publicKey.toString())
    expect(allKeys1[2]?.publicKey.toString()).toBe(key3.publicKey.toString())

    // Verify rotation still starts from beginning
    const rotated = await keyStore.get("alice.near")
    expect(rotated?.publicKey.toString()).toBe(key1.publicKey.toString())
  })

  test("should return empty array for non-existent account", async () => {
    const keyStore = new RotatingKeyStore()

    const allKeys = await keyStore.getAll("nonexistent.near")
    expect(allKeys).toEqual([])
  })

  test("should return all keys in order", async () => {
    const keyStore = new RotatingKeyStore()
    const keys = [generateKey(), generateKey(), generateKey(), generateKey()]

    for (const key of keys) {
      await keyStore.add("test.near", key)
    }

    const allKeys = await keyStore.getAll("test.near")
    expect(allKeys.length).toBe(4)

    for (let i = 0; i < keys.length; i++) {
      expect(allKeys[i]?.publicKey.toString()).toBe(
        keys[i]?.publicKey.toString(),
      )
    }
  })
})

describe("RotatingKeyStore - getCurrentIndex() method", () => {
  test("should return 0 for new account", () => {
    const keyStore = new RotatingKeyStore()
    const index = keyStore.getCurrentIndex("new.near")
    expect(index).toBe(0)
  })

  test("should track rotation index", async () => {
    const keyStore = new RotatingKeyStore()
    await keyStore.add("alice.near", generateKey())
    await keyStore.add("alice.near", generateKey())
    await keyStore.add("alice.near", generateKey())

    expect(keyStore.getCurrentIndex("alice.near")).toBe(0)

    await keyStore.get("alice.near")
    expect(keyStore.getCurrentIndex("alice.near")).toBe(1)

    await keyStore.get("alice.near")
    expect(keyStore.getCurrentIndex("alice.near")).toBe(2)

    await keyStore.get("alice.near")
    expect(keyStore.getCurrentIndex("alice.near")).toBe(3)

    // Counter continues incrementing even after full rotation
    await keyStore.get("alice.near")
    expect(keyStore.getCurrentIndex("alice.near")).toBe(4)
  })

  test("should track different accounts independently", async () => {
    const keyStore = new RotatingKeyStore()
    await keyStore.add("alice.near", generateKey())
    await keyStore.add("bob.near", generateKey())

    await keyStore.get("alice.near")
    await keyStore.get("alice.near")
    await keyStore.get("bob.near")

    expect(keyStore.getCurrentIndex("alice.near")).toBe(2)
    expect(keyStore.getCurrentIndex("bob.near")).toBe(1)
  })
})

describe("RotatingKeyStore - resetCounter() method", () => {
  test("should reset counter to 0", async () => {
    const keyStore = new RotatingKeyStore()
    const key1 = generateKey()
    const key2 = generateKey()

    await keyStore.add("alice.near", key1)
    await keyStore.add("alice.near", key2)

    // Advance counter
    await keyStore.get("alice.near")
    await keyStore.get("alice.near")
    expect(keyStore.getCurrentIndex("alice.near")).toBe(2)

    // Reset
    keyStore.resetCounter("alice.near")
    expect(keyStore.getCurrentIndex("alice.near")).toBe(0)

    // Next get returns first key
    const retrieved = await keyStore.get("alice.near")
    expect(retrieved?.publicKey.toString()).toBe(key1.publicKey.toString())
  })

  test("should not affect other accounts", async () => {
    const keyStore = new RotatingKeyStore()
    await keyStore.add("alice.near", generateKey())
    await keyStore.add("bob.near", generateKey())

    await keyStore.get("alice.near")
    await keyStore.get("bob.near")

    keyStore.resetCounter("alice.near")

    expect(keyStore.getCurrentIndex("alice.near")).toBe(0)
    expect(keyStore.getCurrentIndex("bob.near")).toBe(1)
  })
})

describe("RotatingKeyStore - remove() method", () => {
  test("should remove all keys for account", async () => {
    const keyStore = new RotatingKeyStore()
    const key1 = generateKey()
    const key2 = generateKey()

    await keyStore.add("alice.near", key1)
    await keyStore.add("alice.near", key2)

    // Verify keys exist
    let allKeys = await keyStore.getAll("alice.near")
    expect(allKeys.length).toBe(2)

    // Remove the account
    await keyStore.remove("alice.near")

    // Verify keys are gone
    allKeys = await keyStore.getAll("alice.near")
    expect(allKeys.length).toBe(0)

    const retrieved = await keyStore.get("alice.near")
    expect(retrieved).toBeNull()
  })

  test("should reset counter when removing", async () => {
    const keyStore = new RotatingKeyStore()
    await keyStore.add("alice.near", generateKey())

    await keyStore.get("alice.near")
    expect(keyStore.getCurrentIndex("alice.near")).toBe(1)

    await keyStore.remove("alice.near")
    expect(keyStore.getCurrentIndex("alice.near")).toBe(0)
  })

  test("should not throw when removing non-existent keys", async () => {
    const keyStore = new RotatingKeyStore()

    // Should not throw
    await expect(keyStore.remove("nonexistent.near")).resolves.toBeUndefined()
  })

  test("should not affect other accounts", async () => {
    const keyStore = new RotatingKeyStore()
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
    const keyStore = new RotatingKeyStore()
    const key = generateKey()

    await keyStore.add("test.near", key)
    await keyStore.remove("test.near")

    const accounts = await keyStore.list()
    expect(accounts).not.toContain("test.near")
  })
})

describe("RotatingKeyStore - list() method", () => {
  test("should list all account IDs", async () => {
    const keyStore = new RotatingKeyStore()
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
    const keyStore = new RotatingKeyStore()

    const accounts = await keyStore.list()
    expect(accounts).toEqual([])
  })

  test("should list accounts with multiple keys only once", async () => {
    const keyStore = new RotatingKeyStore()

    await keyStore.add("alice.near", generateKey())
    await keyStore.add("alice.near", generateKey())
    await keyStore.add("alice.near", generateKey())

    const accounts = await keyStore.list()
    expect(accounts.length).toBe(1)
    expect(accounts).toContain("alice.near")
  })
})

describe("RotatingKeyStore - clear() method", () => {
  test("should clear all keys and counters", async () => {
    const keyStore = new RotatingKeyStore()
    const key1 = generateKey()
    const key2 = generateKey()

    await keyStore.add("alice.near", key1)
    await keyStore.add("bob.near", key2)

    await keyStore.get("alice.near")
    expect(keyStore.getCurrentIndex("alice.near")).toBe(1)

    keyStore.clear()

    const accounts = await keyStore.list()
    expect(accounts).toEqual([])
    expect(keyStore.getCurrentIndex("alice.near")).toBe(0)
  })

  test("should allow adding keys after clear()", async () => {
    const keyStore = new RotatingKeyStore()
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
    const keyStore = new RotatingKeyStore()
    expect(() => keyStore.clear()).not.toThrow()
  })
})

describe("RotatingKeyStore - Concurrent transaction simulation", () => {
  test("should distribute keys evenly for concurrent requests", async () => {
    const keyStore = new RotatingKeyStore()
    const key1 = generateKey()
    const key2 = generateKey()
    const key3 = generateKey()

    await keyStore.add("alice.near", key1)
    await keyStore.add("alice.near", key2)
    await keyStore.add("alice.near", key3)

    // Simulate 9 concurrent transaction builds
    const keys = await Promise.all([
      keyStore.get("alice.near"),
      keyStore.get("alice.near"),
      keyStore.get("alice.near"),
      keyStore.get("alice.near"),
      keyStore.get("alice.near"),
      keyStore.get("alice.near"),
      keyStore.get("alice.near"),
      keyStore.get("alice.near"),
      keyStore.get("alice.near"),
    ])

    // Should rotate: key1, key2, key3, key1, key2, key3, key1, key2, key3
    expect(keys[0]?.publicKey.toString()).toBe(key1.publicKey.toString())
    expect(keys[1]?.publicKey.toString()).toBe(key2.publicKey.toString())
    expect(keys[2]?.publicKey.toString()).toBe(key3.publicKey.toString())
    expect(keys[3]?.publicKey.toString()).toBe(key1.publicKey.toString())
    expect(keys[4]?.publicKey.toString()).toBe(key2.publicKey.toString())
    expect(keys[5]?.publicKey.toString()).toBe(key3.publicKey.toString())
    expect(keys[6]?.publicKey.toString()).toBe(key1.publicKey.toString())
    expect(keys[7]?.publicKey.toString()).toBe(key2.publicKey.toString())
    expect(keys[8]?.publicKey.toString()).toBe(key3.publicKey.toString())
  })

  test("should handle high number of rotations", async () => {
    const keyStore = new RotatingKeyStore()
    const keys = [generateKey(), generateKey(), generateKey(), generateKey()]

    for (const key of keys) {
      await keyStore.add("test.near", key)
    }

    // Simulate 100 concurrent requests
    const retrieved = []
    for (let i = 0; i < 100; i++) {
      retrieved.push(await keyStore.get("test.near"))
    }

    // Verify round-robin distribution
    for (let i = 0; i < 100; i++) {
      const expectedKey = keys[i % keys.length]
      expect(retrieved[i]?.publicKey.toString()).toBe(
        expectedKey?.publicKey.toString(),
      )
    }
  })
})

describe("RotatingKeyStore - Edge cases", () => {
  test("should handle empty key array for account", async () => {
    const keyStore = new RotatingKeyStore({
      "alice.near": [],
    })

    const retrieved = await keyStore.get("alice.near")
    expect(retrieved).toBeNull()
  })

  test("should handle adding keys after initialization", async () => {
    const key1 = generateKey()
    const key2 = generateKey()

    const keyStore = new RotatingKeyStore({
      "alice.near": [key1.secretKey],
    })

    // Add more keys
    await keyStore.add("alice.near", key2)

    const allKeys = await keyStore.getAll("alice.near")
    expect(allKeys.length).toBe(2)
  })

  test("should handle large number of keys", async () => {
    const keyStore = new RotatingKeyStore()
    const count = 100

    // Add 100 keys to one account
    for (let i = 0; i < count; i++) {
      await keyStore.add("test.near", generateKey())
    }

    const allKeys = await keyStore.getAll("test.near")
    expect(allKeys.length).toBe(count)

    // Verify rotation works
    const key1 = await keyStore.get("test.near")
    const key2 = await keyStore.get("test.near")
    expect(key1?.publicKey.toString()).not.toBe(key2?.publicKey.toString())
  })

  test("should handle implicit account IDs (hex strings)", async () => {
    const keyStore = new RotatingKeyStore()
    const key = generateKey()
    const implicitAccountId =
      "e3cb032dbb6e8f45239c79652ba94172378f940d340b429ce5076d1a2f7366e2"

    await keyStore.add(implicitAccountId, key)

    const retrieved = await keyStore.get(implicitAccountId)
    expect(retrieved).toBeTruthy()
  })
})

describe("RotatingKeyStore - Integration", () => {
  test("complex workflow with rotation", async () => {
    const key1 = generateKey()
    const key2 = generateKey()

    const keyStore = new RotatingKeyStore({
      "alice.near": [key1.secretKey, key2.secretKey],
    })

    // First rotation
    const retrieved1 = await keyStore.get("alice.near")
    expect(retrieved1?.publicKey.toString()).toBe(key1.publicKey.toString())

    // Second rotation
    const retrieved2 = await keyStore.get("alice.near")
    expect(retrieved2?.publicKey.toString()).toBe(key2.publicKey.toString())

    // Add third key
    const key3 = generateKey()
    await keyStore.add("alice.near", key3)

    // Should continue rotation with all 3 keys
    const retrieved3 = await keyStore.get("alice.near")
    expect(retrieved3?.publicKey.toString()).toBe(key3.publicKey.toString())

    // Back to first key
    const retrieved4 = await keyStore.get("alice.near")
    expect(retrieved4?.publicKey.toString()).toBe(key1.publicKey.toString())

    // Reset counter
    keyStore.resetCounter("alice.near")

    // Should start from first key again
    const retrieved5 = await keyStore.get("alice.near")
    expect(retrieved5?.publicKey.toString()).toBe(key1.publicKey.toString())
  })
})
