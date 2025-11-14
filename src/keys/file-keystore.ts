/**
 * File-based key store implementation compatible with NEAR CLI
 */

import type { KeyPair, KeyStore } from "../core/types.js"
import { parseKey } from "../utils/key.js"
import {
  type NearCliCredential,
  type Network,
  parseCredentialFile,
} from "./credential-schemas.js"

/**
 * File-based key store compatible with NEAR CLI format
 *
 * This keystore is fully compatible with the NEAR CLI credential format,
 * storing keys in `~/.near-credentials/` with network subdirectories.
 *
 * ## Directory Structure
 * ```
 * ~/.near-credentials/
 *   ├── mainnet/
 *   │   └── account.near.json
 *   ├── testnet/
 *   │   ├── account.testnet.json
 *   │   └── account.testnet/              # Multi-key format (read-only)
 *   │       └── ed25519_PublicKey.json
 *   └── implicit/
 *       └── accountId.json
 * ```
 *
 * ## Features
 * - Compatible with near-cli and near-cli-rs
 * - Supports network subdirectories (mainnet, testnet, etc.)
 * - Reads multi-key format (account.near/ed25519_*.json)
 * - Writes simple format (account.near.json)
 * - Preserves optional seed phrase fields
 *
 * @example
 * ```typescript
 * // Default: ~/.near-credentials/testnet/
 * const keyStore = new FileKeyStore("~/.near-credentials", "testnet")
 *
 * // Custom path
 * const keyStore = new FileKeyStore("/path/to/keys", "mainnet")
 *
 * // Add a key
 * await keyStore.add("example.testnet", keyPair)
 * ```
 */
export class FileKeyStore implements KeyStore {
  private readonly basePath: string
  private readonly network: Network | undefined

  /**
   * Create a new file-based keystore
   *
   * @param basePath - Base directory path (default: "~/.near-credentials")
   * @param network - Network subdirectory (e.g., "testnet", "mainnet")
   *
   * @example
   * ```typescript
   * // Store in ~/.near-credentials/testnet/
   * const keyStore = new FileKeyStore("~/.near-credentials", "testnet")
   *
   * // Store in custom directory without network subdirectory
   * const keyStore = new FileKeyStore("/my/keys")
   * ```
   */
  constructor(basePath = "~/.near-credentials", network?: Network) {
    // Expand home directory
    // biome-ignore lint/complexity/useLiteralKeys: TypeScript requires bracket notation for process.env properties
    this.basePath = basePath.replace(
      /^~/,
      process.env["HOME"] || process.env["USERPROFILE"] || "",
    )
    this.network = network
  }

  /**
   * Get the directory path for storing keys
   * Includes network subdirectory if specified
   */
  private getNetworkPath(): string {
    return this.network ? `${this.basePath}/${this.network}` : this.basePath
  }

  /**
   * Get the file path for a specific account
   * Uses simple format: {network}/{accountId}.json
   */
  private getKeyFilePath(accountId: string): string {
    return `${this.getNetworkPath()}/${accountId}.json`
  }

  /**
   * Get the multi-key directory path for an account
   * Format: {network}/{accountId}/
   */
  private getMultiKeyDirPath(accountId: string): string {
    return `${this.getNetworkPath()}/${accountId}`
  }

  /**
   * Add a key to the keystore
   *
   * Stores in NEAR CLI format with network subdirectory.
   * Uses simple format (one file per account).
   *
   * @param accountId - NEAR account ID
   * @param key - Key pair to store
   * @param options - Optional metadata (seed phrase, derivation path)
   */
  async add(
    accountId: string,
    key: KeyPair,
    options?: {
      seedPhrase?: string
      derivationPath?: string
      implicitAccountId?: string
    },
  ): Promise<void> {
    const fs = await import("node:fs/promises")

    // Ensure directory exists
    const networkPath = this.getNetworkPath()
    await fs.mkdir(networkPath, { recursive: true })

    // Create credential data in NEAR CLI format
    const keyData: NearCliCredential = {
      account_id: accountId,
      public_key: key.publicKey.toString(),
      private_key: key.secretKey, // Use private_key (not secret_key)
    }

    // Add optional fields if provided
    if (options?.seedPhrase) {
      keyData.master_seed_phrase = options.seedPhrase
    }
    if (options?.derivationPath) {
      keyData.seed_phrase_hd_path = options.derivationPath
    }
    if (options?.implicitAccountId) {
      keyData.implicit_account_id = options.implicitAccountId
    }

    const filePath = this.getKeyFilePath(accountId)
    await fs.writeFile(filePath, JSON.stringify(keyData, null, 2))
  }

  /**
   * Get a key from the keystore
   *
   * Attempts to read in this order:
   * 1. Simple format: {network}/{accountId}.json
   * 2. Multi-key format: {network}/{accountId}/ed25519_*.json (first match)
   *
   * @param accountId - NEAR account ID
   * @returns Key pair if found, null otherwise
   */
  async get(accountId: string): Promise<KeyPair | null> {
    try {
      const fs = await import("node:fs/promises")

      // Try simple format first
      const filePath = this.getKeyFilePath(accountId)
      try {
        const content = await fs.readFile(filePath, "utf-8")
        const keyData = parseCredentialFile(JSON.parse(content))
        return parseKey(keyData.private_key)
      } catch (error) {
        // If simple format fails, try multi-key format
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return await this.getFromMultiKeyDir(accountId)
        }
        throw error
      }
    } catch (error) {
      // File doesn't exist or can't be read
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null
      }
      throw error
    }
  }

  /**
   * Try to read from multi-key directory format
   * Format: {network}/{accountId}/ed25519_PublicKey.json
   */
  private async getFromMultiKeyDir(accountId: string): Promise<KeyPair | null> {
    try {
      const fs = await import("node:fs/promises")
      const multiKeyDir = this.getMultiKeyDirPath(accountId)

      // Check if directory exists
      const stat = await fs.stat(multiKeyDir)
      if (!stat.isDirectory()) {
        return null
      }

      // Read all files in the directory
      const files = await fs.readdir(multiKeyDir)

      // Find first ed25519 key file
      const keyFile = files.find(
        (file: string) => file.startsWith("ed25519_") && file.endsWith(".json"),
      )
      if (!keyFile) {
        return null
      }

      // Read and parse the key file
      const content = await fs.readFile(`${multiKeyDir}/${keyFile}`, "utf-8")
      const keyData = parseCredentialFile(JSON.parse(content))
      return parseKey(keyData.private_key)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null
      }
      throw error
    }
  }

  /**
   * Remove a key from the keystore
   *
   * Removes both simple format file and multi-key directory if they exist
   *
   * @param accountId - NEAR account ID
   */
  async remove(accountId: string): Promise<void> {
    const fs = await import("node:fs/promises")

    // Remove simple format file
    const filePath = this.getKeyFilePath(accountId)
    try {
      await fs.unlink(filePath)
    } catch (error) {
      // Ignore if file doesn't exist
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error
      }
    }

    // Remove multi-key directory if it exists
    const multiKeyDir = this.getMultiKeyDirPath(accountId)
    try {
      await fs.rm(multiKeyDir, { recursive: true, force: true })
    } catch (error) {
      // Ignore if directory doesn't exist
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error
      }
    }
  }

  /**
   * List all account IDs in the keystore
   *
   * Returns account IDs from both simple format files and multi-key directories
   *
   * @returns Array of account IDs
   */
  async list(): Promise<string[]> {
    try {
      const fs = await import("node:fs/promises")
      const networkPath = this.getNetworkPath()
      const entries = await fs.readdir(networkPath, { withFileTypes: true })

      const accountIds = new Set<string>()

      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".json")) {
          // Simple format: account.json
          accountIds.add(entry.name.replace(".json", ""))
        } else if (entry.isDirectory()) {
          // Multi-key format: account/
          // Check if directory contains key files
          const dirPath = `${networkPath}/${entry.name}`
          try {
            const files = await fs.readdir(dirPath)
            const hasKeyFiles = files.some(
              (file: string) =>
                file.startsWith("ed25519_") && file.endsWith(".json"),
            )
            if (hasKeyFiles) {
              accountIds.add(entry.name)
            }
          } catch {
            // Ignore errors reading subdirectories
          }
        }
      }

      return Array.from(accountIds).sort()
    } catch (error) {
      // Directory doesn't exist
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return []
      }
      throw error
    }
  }
}
