/**
 * Native OS keystore implementation using system credential storage
 */

import type { KeyPair, KeyStore } from "../core/types.js"
import { parseKey } from "../utils/key.js"
import {
  type NearCliCredential,
  parseCredentialFile,
} from "./credential-schemas.js"

/**
 * Native OS keystore using system credential storage
 *
 * This keystore uses the operating system's native secure credential storage:
 * - **macOS**: Keychain Access
 * - **Windows**: Credential Manager (DPAPI)
 * - **Linux**: keyutils (kernel keyring) or D-Bus Secret Service API
 *
 * ## Security Benefits
 * - Keys stored in OS-level secure storage (not plain files)
 * - Encrypted by OS using hardware-backed keys when available
 * - Protected by user's system password/biometrics
 * - Isolated from other applications
 *
 * ## Requirements
 * - Requires `@napi-rs/keyring` native dependency
 * - Linux: Uses either keyutils (kernel keyring, no additional requirements) or
 *   D-Bus Secret Service API (requires a daemon like GNOME Keyring or KWallet,
 *   but no additional system libraries like `libsecret`)
 *
 * ## Limitations
 * - Not available in browser environments (use InMemoryKeyStore instead)
 * - Requires user to be logged in to the system
 * - Keys are machine-specific (not synced across devices)
 *
 * @example
 * ```typescript
 * // Use OS keyring for maximum security
 * const keyStore = new NativeKeyStore()
 * const near = new Near({ keyStore })
 *
 * // Keys stored in:
 * // - macOS: Keychain Access > "NEAR Credentials"
 * // - Windows: Credential Manager > Generic Credentials
 * // - Linux: GNOME Keyring / KDE Wallet
 * ```
 */
export class NativeKeyStore implements KeyStore {
  private readonly service: string

  /**
   * Create a new native OS keystore
   *
   * @param service - Service name for credential storage (default: "NEAR Credentials")
   *                  This appears in Keychain Access (macOS) or Credential Manager (Windows)
   *
   * @example
   * ```typescript
   * // Default service name
   * const keyStore = new NativeKeyStore()
   *
   * // Custom service name for your app
   * const keyStore = new NativeKeyStore("MyApp NEAR Keys")
   * ```
   */
  constructor(service = "NEAR Credentials") {
    this.service = service
  }

  /**
   * Create an Entry instance for keyring operations
   */
  private async getEntry(accountId: string) {
    // Dynamic import to allow graceful fallback if not installed
    const { Entry } = await import("@napi-rs/keyring")
    return new Entry(this.service, accountId)
  }

  /**
   * Add a key to the OS keystore
   *
   * Stores the key securely in the operating system's credential storage.
   * The key is encrypted by the OS and protected by the user's system password.
   *
   * @param accountId - NEAR account ID (used as credential name)
   * @param key - Key pair to store
   * @param options - Optional metadata (stored alongside the key in OS keyring)
   *
   * @throws {Error} If keyring access fails (e.g., user denies permission)
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
    const entry = await this.getEntry(accountId)

    // Store full key data as JSON
    const keyData: NearCliCredential = {
      account_id: accountId,
      public_key: key.publicKey.toString(),
      private_key: key.secretKey,
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

    // Store as JSON string in keyring
    entry.setPassword(JSON.stringify(keyData))
  }

  /**
   * Get a key from the OS keystore
   *
   * Retrieves and decrypts the key from the operating system's credential storage.
   *
   * @param accountId - NEAR account ID
   * @returns Key pair if found, null otherwise
   *
   * @throws {Error} If keyring access fails or key is corrupted
   */
  async get(accountId: string): Promise<KeyPair | null> {
    try {
      const entry = await this.getEntry(accountId)
      const stored = entry.getPassword()

      if (!stored) {
        return null
      }

      // Parse stored JSON data
      const keyData = parseCredentialFile(JSON.parse(stored))
      return parseKey(keyData.private_key)
    } catch (error) {
      // Key not found or access denied
      if (error instanceof Error && error.message.includes("not found")) {
        return null
      }
      throw error
    }
  }

  /**
   * Remove a key from the OS keystore
   *
   * Permanently deletes the credential from the operating system's storage.
   *
   * @param accountId - NEAR account ID
   */
  async remove(accountId: string): Promise<void> {
    try {
      const entry = await this.getEntry(accountId)
      entry.deletePassword()
    } catch (error) {
      // Ignore if credential doesn't exist
      if (error instanceof Error && error.message.includes("not found")) {
        return
      }
      throw error
    }
  }

  /**
   * List all account IDs in the OS keystore
   *
   * ⚠️  **Note**: The underlying keyring library doesn't support listing all
   * credentials for a service. This method returns an empty array.
   *
   * If you need to track multiple accounts, maintain a list separately
   * (e.g., in a config file) and use this keystore only for secure key storage.
   *
   * @returns Empty array (OS keyrings don't support enumeration for security)
   */
  async list(): Promise<string[]> {
    // Native keyrings don't support listing credentials for security reasons
    // Applications should track account IDs separately if needed
    return []
  }
}
