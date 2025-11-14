/**
 * KeyStore implementations for managing NEAR account keys
 */

import type { KeyPair, KeyStore } from "../core/types.js"
import { parseKey } from "../utils/key.js"

/**
 * In-memory key store
 * Keys are stored in memory and lost when the process exits
 */
export class InMemoryKeyStore implements KeyStore {
  private keys: Map<string, KeyPair>

  constructor(initialKeys?: Record<string, string>) {
    this.keys = new Map()

    if (initialKeys) {
      for (const [accountId, keyString] of Object.entries(initialKeys)) {
        const keyPair = parseKey(keyString)
        this.keys.set(accountId, keyPair)
      }
    }
  }

  async add(accountId: string, key: KeyPair): Promise<void> {
    this.keys.set(accountId, key)
  }

  async get(accountId: string): Promise<KeyPair | null> {
    return this.keys.get(accountId) ?? null
  }

  async remove(accountId: string): Promise<void> {
    this.keys.delete(accountId)
  }

  async list(): Promise<string[]> {
    return Array.from(this.keys.keys())
  }

  clear(): void {
    this.keys.clear()
  }
}

/**
 * File-based key store for Node.js
 * Keys are stored in files on the filesystem
 */
export class FileKeyStore implements KeyStore {
  private readonly basePath: string

  constructor(basePath: string = "~/.near-credentials") {
    // Expand home directory
    this.basePath = basePath.replace(
      /^~/,
      process.env["HOME"] || process.env["USERPROFILE"] || "",
    )
  }

  private getKeyFilePath(accountId: string): string {
    return `${this.basePath}/${accountId}.json`
  }

  async add(accountId: string, key: KeyPair): Promise<void> {
    const fs = await import("node:fs/promises")

    // Ensure directory exists
    await fs.mkdir(this.basePath, { recursive: true })

    const keyData = {
      account_id: accountId,
      public_key: key.publicKey.toString(),
      secret_key: key.secretKey,
    }

    const filePath = this.getKeyFilePath(accountId)
    await fs.writeFile(filePath, JSON.stringify(keyData, null, 2))
  }

  async get(accountId: string): Promise<KeyPair | null> {
    try {
      const fs = await import("node:fs/promises")
      const filePath = this.getKeyFilePath(accountId)
      const content = await fs.readFile(filePath, "utf-8")
      const keyData = JSON.parse(content) as { secret_key: string }
      return parseKey(keyData.secret_key)
    } catch (error) {
      // File doesn't exist or can't be read
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null
      }
      throw error
    }
  }

  async remove(accountId: string): Promise<void> {
    const fs = await import("node:fs/promises")
    const filePath = this.getKeyFilePath(accountId)

    try {
      await fs.unlink(filePath)
    } catch (error) {
      // Ignore if file doesn't exist
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error
      }
    }
  }

  async list(): Promise<string[]> {
    try {
      const fs = await import("node:fs/promises")
      const files = await fs.readdir(this.basePath)

      return files
        .filter((file) => file.endsWith(".json"))
        .map((file) => file.replace(".json", ""))
    } catch (error) {
      // Directory doesn't exist
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return []
      }
      throw error
    }
  }
}

/**
 * Encrypted key store
 * Keys are encrypted with a password before storage
 */
export class EncryptedKeyStore implements KeyStore {
  private readonly password: string
  private readonly storage: Storage | FileKeyStore

  constructor(options: { password: string; storage: Storage | string }) {
    this.password = options.password

    if (typeof options.storage === "string") {
      this.storage = new FileKeyStore(options.storage)
    } else {
      this.storage = options.storage
    }
  }

  private async encrypt(data: string): Promise<string> {
    // TODO: Simple XOR encryption (NOT secure for production!)
    // In production, use a proper encryption library like crypto-js or native crypto
    const encoder = new TextEncoder()
    const dataBytes = encoder.encode(data)
    const keyBytes = encoder.encode(this.password)

    const encrypted = new Uint8Array(dataBytes.length)
    for (let i = 0; i < dataBytes.length; i++) {
      encrypted[i] = dataBytes[i]! ^ keyBytes[i % keyBytes.length]!
    }

    // Convert to base64
    return btoa(String.fromCharCode(...encrypted))
  }

  private async decrypt(encryptedData: string): Promise<string> {
    // Reverse of encrypt
    const decoder = new TextDecoder()
    const encoder = new TextEncoder()

    // Decode from base64
    const encrypted = Uint8Array.from(atob(encryptedData), (c) =>
      c.charCodeAt(0),
    )
    const keyBytes = encoder.encode(this.password)

    const decrypted = new Uint8Array(encrypted.length)
    for (let i = 0; i < encrypted.length; i++) {
      decrypted[i] = encrypted[i]! ^ keyBytes[i % keyBytes.length]!
    }

    return decoder.decode(decrypted)
  }

  async add(accountId: string, key: KeyPair): Promise<void> {
    const keyData = JSON.stringify({
      public_key: key.publicKey.toString(),
      secret_key: key.secretKey,
    })

    const encrypted = await this.encrypt(keyData)

    // Store as a fake KeyPair (just for storage purposes)
    const dummyKey = parseKey(key.secretKey)
    ;(dummyKey as { secretKey: string }).secretKey = encrypted

    if ("setItem" in this.storage) {
      this.storage.setItem(accountId, encrypted)
    } else {
      await (this.storage as FileKeyStore).add(accountId, dummyKey)
    }
  }

  async get(accountId: string): Promise<KeyPair | null> {
    let encrypted: string | null

    if ("getItem" in this.storage) {
      encrypted = this.storage.getItem(accountId)
    } else {
      const storedKey = await (this.storage as FileKeyStore).get(accountId)
      encrypted = storedKey ? storedKey.secretKey : null
    }

    if (!encrypted) {
      return null
    }

    const decrypted = await this.decrypt(encrypted)
    const keyData = JSON.parse(decrypted) as { secret_key: string }

    return parseKey(keyData.secret_key)
  }

  async remove(accountId: string): Promise<void> {
    if ("removeItem" in this.storage) {
      this.storage.removeItem(accountId)
    } else {
      await (this.storage as FileKeyStore).remove(accountId)
    }
  }

  async list(): Promise<string[]> {
    if ("length" in this.storage) {
      const keys: string[] = []
      for (let i = 0; i < this.storage.length; i++) {
        const key = this.storage.key(i)
        if (key) {
          keys.push(key)
        }
      }
      return keys
    } else {
      return await (this.storage as FileKeyStore).list()
    }
  }
}

// Browser Storage interface (for compatibility)
interface Storage {
  readonly length: number
  clear(): void
  getItem(key: string): string | null
  key(index: number): string | null
  removeItem(key: string): void
  setItem(key: string, value: string): void
}
