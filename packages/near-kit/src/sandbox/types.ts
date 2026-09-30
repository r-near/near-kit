import type { AccessKeyView } from "../core/rpc/rpc-schemas.js"
/**
 * Default code hash for accounts without deployed contract code.
 * This is a base58-encoded sha256 hash of an empty byte array.
 */
export const EMPTY_CODE_HASH = "11111111111111111111111111111111"

/**
 * State record from sandbox state dump.
 * Used for patching state and creating snapshots.
 */
export interface StateRecord {
  Account?: {
    account_id: string
    account: {
      amount: string
      locked: string
      code_hash: string
      storage_usage: number
      version?: string
    }
  }
  AccessKey?: {
    account_id: string
    public_key: string
    access_key: {
      nonce: number
      permission: AccessKeyView["permission"]
    }
  }
  Contract?: {
    account_id: string
    code: string // base64-encoded WASM
  }
  Data?: {
    account_id: string
    data_key: string // base64-encoded key
    value: string // base64-encoded value
  }
}

/**
 * State snapshot for restoring sandbox state between tests.
 */
export interface StateSnapshot {
  records: StateRecord[]
  timestamp: number
}

export interface SandboxOptions {
  version?: string
  /**
   * Path to a local near-sandbox binary. If provided, skips downloading.
   * Falls back to NEAR_SANDBOX_BIN_PATH environment variable if not set.
   */
  binaryPath?: string
  /**
   * Whether to spawn the sandbox process as detached.
   * Default: true
   * Set to false in test environments to prevent the process from being killed by test runners.
   */
  detached?: boolean
}
