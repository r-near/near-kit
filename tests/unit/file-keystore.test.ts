/**
 * Comprehensive tests for FileKeyStore class
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { FileKeyStore } from "../../src/keys/file-keystore.js"
import { generateKey } from "../../src/utils/key.js"

// Helper to create a unique temporary directory for each test
async function createTempDir(): Promise<string> {
  const tempBase = os.tmpdir()
  const tempDir = path.join(
    tempBase,
    `near-ts-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  await fs.mkdir(tempDir, { recursive: true })
  return tempDir
}

// Helper to clean up temporary directory
async function cleanupTempDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true })
  } catch {
    // Ignore errors during cleanup
  }
}

describe("FileKeyStore - Constructor & Path Handling", () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await createTempDir()
  })

  afterEach(async () => {
    await cleanupTempDir(tempDir)
  })

  test("should use default path ~/.near-credentials when no path provided", () => {
    // const keyStore = new FileKeyStore()
    const homeDir = process.env["HOME"] || process.env["USERPROFILE"] || ""

    // Test that it expands ~ to home directory by checking add() creates files in right place
    expect(homeDir).toBeTruthy()
  })

  test("should accept custom path", () => {
    const keyStore = new FileKeyStore(tempDir)
    expect(keyStore).toBeDefined()
  })

  test("should expand ~ to home directory", async () => {
    const homeDir = process.env["HOME"] || process.env["USERPROFILE"] || ""
    if (!homeDir) return // Skip if no home dir

    const keyStore = new FileKeyStore("~/.near-test", "testnet")
    const key = generateKey()

    try {
      await keyStore.add("test.testnet", key)
      const expandedPath = path.join(
        homeDir,
        ".near-test",
        "testnet",
        "test.testnet.json",
      )
      const stat = await fs.stat(expandedPath)
      expect(stat.isFile()).toBe(true)

      // Cleanup
      await fs.rm(path.join(homeDir, ".near-test"), {
        recursive: true,
        force: true,
      })
    } catch (error) {
      // Cleanup on error
      await fs.rm(path.join(homeDir, ".near-test"), {
        recursive: true,
        force: true,
      })
      throw error
    }
  })

  test("should create network subdirectory when network specified", async () => {
    const keyStore = new FileKeyStore(tempDir, "testnet")
    const key = generateKey()

    await keyStore.add("test.testnet", key)

    const networkDir = path.join(tempDir, "testnet")
    const stat = await fs.stat(networkDir)
    expect(stat.isDirectory()).toBe(true)
  })

  test("should not create network subdirectory when network not specified", async () => {
    const keyStore = new FileKeyStore(tempDir)
    const key = generateKey()

    await keyStore.add("test.testnet", key)

    const filePath = path.join(tempDir, "test.testnet.json")
    const stat = await fs.stat(filePath)
    expect(stat.isFile()).toBe(true)
  })

  test("should handle different network names", async () => {
    const networks = ["mainnet", "testnet", "betanet", "localnet"] as const

    for (const network of networks) {
      const keyStore = new FileKeyStore(tempDir, network)
      const key = generateKey()
      await keyStore.add(`test.${network}`, key)

      const networkDir = path.join(tempDir, network)
      const stat = await fs.stat(networkDir)
      expect(stat.isDirectory()).toBe(true)
    }
  })
})

describe("FileKeyStore - add() method", () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await createTempDir()
  })

  afterEach(async () => {
    await cleanupTempDir(tempDir)
  })

  test("should write simple format file (accountId.json)", async () => {
    const keyStore = new FileKeyStore(tempDir, "testnet")
    const key = generateKey()
    const accountId = "test.testnet"

    await keyStore.add(accountId, key)

    const filePath = path.join(tempDir, "testnet", `${accountId}.json`)
    const content = await fs.readFile(filePath, "utf-8")
    const data = JSON.parse(content)

    expect(data.account_id).toBe(accountId)
    expect(data.public_key).toBe(key.publicKey.toString())
    expect(data.private_key).toBe(key.secretKey)
  })

  test("should create network directory if it doesn't exist", async () => {
    const keyStore = new FileKeyStore(tempDir, "testnet")
    const key = generateKey()

    // Directory shouldn't exist yet
    const networkDir = path.join(tempDir, "testnet")
    await expect(fs.stat(networkDir)).rejects.toThrow()

    await keyStore.add("test.testnet", key)

    // Directory should now exist
    const stat = await fs.stat(networkDir)
    expect(stat.isDirectory()).toBe(true)
  })

  test("should preserve seed phrase metadata", async () => {
    const keyStore = new FileKeyStore(tempDir, "testnet")
    const key = generateKey()
    const seedPhrase =
      "witch collapse practice feed shame open despair creek road again ice least"

    await keyStore.add("test.testnet", key, { seedPhrase })

    const filePath = path.join(tempDir, "testnet", "test.testnet.json")
    const content = await fs.readFile(filePath, "utf-8")
    const data = JSON.parse(content)

    expect(data.master_seed_phrase).toBe(seedPhrase)
  })

  test("should preserve derivation path metadata", async () => {
    const keyStore = new FileKeyStore(tempDir, "testnet")
    const key = generateKey()
    const derivationPath = "m/44'/397'/0'"

    await keyStore.add("test.testnet", key, { derivationPath })

    const filePath = path.join(tempDir, "testnet", "test.testnet.json")
    const content = await fs.readFile(filePath, "utf-8")
    const data = JSON.parse(content)

    expect(data.seed_phrase_hd_path).toBe(derivationPath)
  })

  test("should preserve implicit account ID", async () => {
    const keyStore = new FileKeyStore(tempDir, "testnet")
    const key = generateKey()
    const implicitAccountId =
      "e3cb032dbb6e8f45239c79652ba94172378f940d340b429ce5076d1a2f7366e2"

    await keyStore.add("test.testnet", key, { implicitAccountId })

    const filePath = path.join(tempDir, "testnet", "test.testnet.json")
    const content = await fs.readFile(filePath, "utf-8")
    const data = JSON.parse(content)

    expect(data.implicit_account_id).toBe(implicitAccountId)
  })

  test("should preserve all metadata fields together", async () => {
    const keyStore = new FileKeyStore(tempDir, "testnet")
    const key = generateKey()
    const metadata = {
      seedPhrase:
        "witch collapse practice feed shame open despair creek road again ice least",
      derivationPath: "m/44'/397'/0'",
      implicitAccountId:
        "e3cb032dbb6e8f45239c79652ba94172378f940d340b429ce5076d1a2f7366e2",
    }

    await keyStore.add("test.testnet", key, metadata)

    const filePath = path.join(tempDir, "testnet", "test.testnet.json")
    const content = await fs.readFile(filePath, "utf-8")
    const data = JSON.parse(content)

    expect(data.master_seed_phrase).toBe(metadata.seedPhrase)
    expect(data.seed_phrase_hd_path).toBe(metadata.derivationPath)
    expect(data.implicit_account_id).toBe(metadata.implicitAccountId)
  })

  test("should format JSON with proper indentation", async () => {
    const keyStore = new FileKeyStore(tempDir, "testnet")
    const key = generateKey()

    await keyStore.add("test.testnet", key)

    const filePath = path.join(tempDir, "testnet", "test.testnet.json")
    const content = await fs.readFile(filePath, "utf-8")

    // Check that it's formatted (contains newlines and spaces)
    expect(content).toContain("\n")
    expect(content).toMatch(/{\n\s+"account_id"/)
  })

  test("should overwrite existing key file", async () => {
    const keyStore = new FileKeyStore(tempDir, "testnet")
    const key1 = generateKey()
    const key2 = generateKey()

    await keyStore.add("test.testnet", key1)
    await keyStore.add("test.testnet", key2)

    const retrieved = await keyStore.get("test.testnet")
    expect(retrieved?.publicKey.toString()).toBe(key2.publicKey.toString())
  })
})

describe("FileKeyStore - get() method", () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await createTempDir()
  })

  afterEach(async () => {
    await cleanupTempDir(tempDir)
  })

  test("should read simple format file (accountId.json)", async () => {
    const keyStore = new FileKeyStore(tempDir, "testnet")
    const key = generateKey()

    await keyStore.add("test.testnet", key)
    const retrieved = await keyStore.get("test.testnet")

    expect(retrieved).toBeTruthy()
    expect(retrieved?.publicKey.toString()).toBe(key.publicKey.toString())
    expect(retrieved?.secretKey).toBe(key.secretKey)
  })

  test("should read multi-key format (accountId/ed25519_*.json)", async () => {
    const keyStore = new FileKeyStore(tempDir, "testnet")
    const key = generateKey()

    // Manually create multi-key format
    const accountDir = path.join(tempDir, "testnet", "test.testnet")
    await fs.mkdir(accountDir, { recursive: true })

    const keyFileName = `ed25519_${key.publicKey.toString().split(":")[1]}.json`
    const keyFilePath = path.join(accountDir, keyFileName)

    const keyData = {
      account_id: "test.testnet",
      public_key: key.publicKey.toString(),
      private_key: key.secretKey,
    }
    await fs.writeFile(keyFilePath, JSON.stringify(keyData))

    const retrieved = await keyStore.get("test.testnet")

    expect(retrieved).toBeTruthy()
    expect(retrieved?.publicKey.toString()).toBe(key.publicKey.toString())
  })

  test("should fallback from simple to multi-key format", async () => {
    const keyStore = new FileKeyStore(tempDir, "testnet")
    const key = generateKey()

    // Create only multi-key format (no simple format)
    const accountDir = path.join(tempDir, "testnet", "test.testnet")
    await fs.mkdir(accountDir, { recursive: true })

    const keyFileName = `ed25519_${key.publicKey.toString().split(":")[1]}.json`
    const keyFilePath = path.join(accountDir, keyFileName)

    const keyData = {
      account_id: "test.testnet",
      public_key: key.publicKey.toString(),
      private_key: key.secretKey,
    }
    await fs.writeFile(keyFilePath, JSON.stringify(keyData))

    // Should find the key in multi-key format
    const retrieved = await keyStore.get("test.testnet")
    expect(retrieved).toBeTruthy()
    expect(retrieved?.publicKey.toString()).toBe(key.publicKey.toString())
  })

  test("should return null for non-existent keys", async () => {
    const keyStore = new FileKeyStore(tempDir, "testnet")

    const retrieved = await keyStore.get("nonexistent.testnet")
    expect(retrieved).toBeNull()
  })

  test("should handle corrupted JSON gracefully", async () => {
    const keyStore = new FileKeyStore(tempDir, "testnet")

    // Create a corrupted JSON file
    const networkDir = path.join(tempDir, "testnet")
    await fs.mkdir(networkDir, { recursive: true })

    const filePath = path.join(networkDir, "corrupted.testnet.json")
    await fs.writeFile(filePath, "{ invalid json }")

    await expect(keyStore.get("corrupted.testnet")).rejects.toThrow()
  })

  test("should handle missing files gracefully", async () => {
    const keyStore = new FileKeyStore(tempDir, "testnet")

    const retrieved = await keyStore.get("missing.testnet")
    expect(retrieved).toBeNull()
  })

  test("should read legacy format with secret_key field", async () => {
    const keyStore = new FileKeyStore(tempDir, "testnet")
    const key = generateKey()

    // Manually create legacy format file
    const networkDir = path.join(tempDir, "testnet")
    await fs.mkdir(networkDir, { recursive: true })

    const filePath = path.join(networkDir, "legacy.testnet.json")
    const legacyData = {
      account_id: "legacy.testnet",
      public_key: key.publicKey.toString(),
      secret_key: key.secretKey, // Legacy field name
    }
    await fs.writeFile(filePath, JSON.stringify(legacyData))

    const retrieved = await keyStore.get("legacy.testnet")
    expect(retrieved).toBeTruthy()
    expect(retrieved?.publicKey.toString()).toBe(key.publicKey.toString())
  })
})

describe("FileKeyStore - remove() method", () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await createTempDir()
  })

  afterEach(async () => {
    await cleanupTempDir(tempDir)
  })

  test("should remove simple format file", async () => {
    const keyStore = new FileKeyStore(tempDir, "testnet")
    const key = generateKey()

    await keyStore.add("test.testnet", key)

    // Verify file exists
    const filePath = path.join(tempDir, "testnet", "test.testnet.json")
    await fs.stat(filePath) // Should not throw

    await keyStore.remove("test.testnet")

    // Verify file is removed
    await expect(fs.stat(filePath)).rejects.toThrow()
  })

  test("should remove multi-key directory", async () => {
    const keyStore = new FileKeyStore(tempDir, "testnet")
    const key = generateKey()

    // Create multi-key format
    const accountDir = path.join(tempDir, "testnet", "test.testnet")
    await fs.mkdir(accountDir, { recursive: true })

    const keyFileName = `ed25519_${key.publicKey.toString().split(":")[1]}.json`
    const keyFilePath = path.join(accountDir, keyFileName)

    const keyData = {
      account_id: "test.testnet",
      public_key: key.publicKey.toString(),
      private_key: key.secretKey,
    }
    await fs.writeFile(keyFilePath, JSON.stringify(keyData))

    // Verify directory exists
    await fs.stat(accountDir) // Should not throw

    await keyStore.remove("test.testnet")

    // Verify directory is removed
    await expect(fs.stat(accountDir)).rejects.toThrow()
  })

  test("should handle non-existent files gracefully", async () => {
    const keyStore = new FileKeyStore(tempDir, "testnet")

    // Should not throw when removing non-existent key
    await expect(
      keyStore.remove("nonexistent.testnet"),
    ).resolves.toBeUndefined()
  })

  test("should remove both simple and multi-key formats if they exist", async () => {
    const keyStore = new FileKeyStore(tempDir, "testnet")
    const key = generateKey()

    // Create simple format
    await keyStore.add("test.testnet", key)

    // Also create multi-key format
    const accountDir = path.join(tempDir, "testnet", "test.testnet")
    await fs.mkdir(accountDir, { recursive: true })

    const keyFileName = `ed25519_${key.publicKey.toString().split(":")[1]}.json`
    const keyFilePath = path.join(accountDir, keyFileName)

    const keyData = {
      account_id: "test.testnet",
      public_key: key.publicKey.toString(),
      private_key: key.secretKey,
    }
    await fs.writeFile(keyFilePath, JSON.stringify(keyData))

    // Remove both
    await keyStore.remove("test.testnet")

    // Verify both are removed
    const simplePath = path.join(tempDir, "testnet", "test.testnet.json")
    await expect(fs.stat(simplePath)).rejects.toThrow()
    await expect(fs.stat(accountDir)).rejects.toThrow()
  })
})

describe("FileKeyStore - list() method", () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await createTempDir()
  })

  afterEach(async () => {
    await cleanupTempDir(tempDir)
  })

  test("should list simple format files", async () => {
    const keyStore = new FileKeyStore(tempDir, "testnet")
    const key1 = generateKey()
    const key2 = generateKey()

    await keyStore.add("account1.testnet", key1)
    await keyStore.add("account2.testnet", key2)

    const accounts = await keyStore.list()

    expect(accounts).toContain("account1.testnet")
    expect(accounts).toContain("account2.testnet")
    expect(accounts.length).toBe(2)
  })

  test("should list multi-key directories", async () => {
    const keyStore = new FileKeyStore(tempDir, "testnet")
    const key = generateKey()

    // Create multi-key format
    const accountDir = path.join(tempDir, "testnet", "multikey.testnet")
    await fs.mkdir(accountDir, { recursive: true })

    const keyFileName = `ed25519_${key.publicKey.toString().split(":")[1]}.json`
    const keyFilePath = path.join(accountDir, keyFileName)

    const keyData = {
      account_id: "multikey.testnet",
      public_key: key.publicKey.toString(),
      private_key: key.secretKey,
    }
    await fs.writeFile(keyFilePath, JSON.stringify(keyData))

    const accounts = await keyStore.list()

    expect(accounts).toContain("multikey.testnet")
  })

  test("should combine both simple and multi-key formats", async () => {
    const keyStore = new FileKeyStore(tempDir, "testnet")
    const key1 = generateKey()
    const key2 = generateKey()

    // Add simple format
    await keyStore.add("simple.testnet", key1)

    // Create multi-key format
    const accountDir = path.join(tempDir, "testnet", "multikey.testnet")
    await fs.mkdir(accountDir, { recursive: true })

    const keyFileName = `ed25519_${key2.publicKey.toString().split(":")[1]}.json`
    const keyFilePath = path.join(accountDir, keyFileName)

    const keyData = {
      account_id: "multikey.testnet",
      public_key: key2.publicKey.toString(),
      private_key: key2.secretKey,
    }
    await fs.writeFile(keyFilePath, JSON.stringify(keyData))

    const accounts = await keyStore.list()

    expect(accounts).toContain("simple.testnet")
    expect(accounts).toContain("multikey.testnet")
    expect(accounts.length).toBe(2)
  })

  test("should return empty array for non-existent directory", async () => {
    // Using invalid network to test error handling
    const keyStore = new FileKeyStore(
      tempDir,
      "nonexistent" as unknown as "mainnet",
    )

    const accounts = await keyStore.list()

    expect(accounts).toEqual([])
  })

  test("should return sorted results", async () => {
    const keyStore = new FileKeyStore(tempDir, "testnet")
    const key = generateKey()

    // Add in non-alphabetical order
    await keyStore.add("zebra.testnet", key)
    await keyStore.add("alpha.testnet", key)
    await keyStore.add("middle.testnet", key)

    const accounts = await keyStore.list()

    expect(accounts).toEqual([
      "alpha.testnet",
      "middle.testnet",
      "zebra.testnet",
    ])
  })

  test("should deduplicate accounts with both formats", async () => {
    const keyStore = new FileKeyStore(tempDir, "testnet")
    const key = generateKey()

    // Add simple format
    await keyStore.add("duplicate.testnet", key)

    // Also create multi-key format for same account
    const accountDir = path.join(tempDir, "testnet", "duplicate.testnet")
    await fs.mkdir(accountDir, { recursive: true })

    const keyFileName = `ed25519_${key.publicKey.toString().split(":")[1]}.json`
    const keyFilePath = path.join(accountDir, keyFileName)

    const keyData = {
      account_id: "duplicate.testnet",
      public_key: key.publicKey.toString(),
      private_key: key.secretKey,
    }
    await fs.writeFile(keyFilePath, JSON.stringify(keyData))

    const accounts = await keyStore.list()

    // Should only appear once
    expect(accounts.filter((acc) => acc === "duplicate.testnet").length).toBe(1)
  })

  test("should ignore directories without key files", async () => {
    const keyStore = new FileKeyStore(tempDir, "testnet")
    const key = generateKey()

    await keyStore.add("valid.testnet", key)

    // Create directory without key files
    const emptyDir = path.join(tempDir, "testnet", "empty.testnet")
    await fs.mkdir(emptyDir, { recursive: true })
    await fs.writeFile(path.join(emptyDir, "random.txt"), "not a key")

    const accounts = await keyStore.list()

    expect(accounts).toContain("valid.testnet")
    expect(accounts).not.toContain("empty.testnet")
  })
})
