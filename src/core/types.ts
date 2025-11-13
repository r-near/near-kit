/**
 * Core type definitions for the NEAR client library
 */

// ==================== Network Configuration ====================

export type NetworkId = "mainnet" | "testnet" | "localnet"

export type NetworkConfig =
  | NetworkId
  | {
      rpcUrl: string
      networkId: string
      nodeUrl?: string
      walletUrl?: string
      helperUrl?: string
    }

// ==================== Key Configuration ====================

export type KeyConfig =
  | string // 'ed25519:...' or seed phrase
  | { type: "ed25519"; key: string }
  | { type: "secp256k1"; key: string }
  | { type: "seed"; phrase: string; path?: string }
  | { type: "ledger"; path?: string }
  | { type: "private-key"; key: Uint8Array }

// ==================== Key Management ====================

export interface KeyPair {
  publicKey: PublicKey
  secretKey: string
  sign(message: Uint8Array): Signature
}

export enum KeyType {
  ED25519 = 0,
  SECP256K1 = 1,
}

export interface PublicKey {
  keyType: KeyType
  data: Uint8Array
  toString(): string
}

export interface Ed25519PublicKey extends PublicKey {
  keyType: KeyType.ED25519
}

export interface Secp256k1PublicKey extends PublicKey {
  keyType: KeyType.SECP256K1
}

export interface Signature {
  keyType: KeyType
  data: Uint8Array
}

export interface Ed25519Signature extends Signature {
  keyType: KeyType.ED25519
}

export interface Secp256k1Signature extends Signature {
  keyType: KeyType.SECP256K1
}

export type Signer = (message: Uint8Array) => Promise<Signature>

// ==================== Permissions ====================

/**
 * Function call permission details from RPC
 */
export interface FunctionCallPermissionDetails {
  /** Account ID that can be called */
  receiver_id: string
  /** List of method names that can be called (empty array means any) */
  method_names: string[]
  /** Optional allowance in yoctoNEAR */
  allowance?: string | null
}

/**
 * Access key permission as returned by RPC
 * Either "FullAccess" string or object with FunctionCall details
 */
export type AccessKeyPermission =
  | "FullAccess"
  | {
      FunctionCall: FunctionCallPermissionDetails
    }

// ==================== Transaction Types ====================

// Action type is now defined in schema.ts and derived from Borsh schema
// Import it first so Transaction can use it
import type { Action } from "./schema.js"
export type { Action }

export interface Transaction {
  signerId: string
  publicKey: PublicKey
  nonce: bigint
  receiverId: string
  actions: Action[]
  blockHash: Uint8Array
}

export interface SignedTransaction {
  transaction: Transaction
  signature: Signature
}

// ==================== Execution Outcomes ====================

export type ExecutionStatus =
  | { type: "Unknown" }
  | { type: "Pending" }
  | { type: "Failure"; error: string }
  | { type: "SuccessValue"; value: string }
  | { type: "SuccessReceiptId"; receiptId: string }

export interface ExecutionOutcome {
  logs: string[]
  receipt_ids: string[]
  gas_burnt: bigint
  tokens_burnt: string
  executor_id: string
  status: ExecutionStatus
}

export interface ExecutionOutcomeWithId {
  id: string
  outcome: ExecutionOutcome
  block_hash: string
}

export interface FinalExecutionOutcome {
  status: ExecutionStatus
  transaction: Transaction
  transaction_outcome: ExecutionOutcomeWithId
  receipts_outcome: ExecutionOutcomeWithId[]
}

export interface SimulationResult {
  outcome: FinalExecutionOutcome
  gasUsed: string
  error?: string
}

// ==================== RPC Types ====================

/**
 * Result from calling a view function on a contract
 */
export interface ViewFunctionCallResult {
  /** Raw result bytes as array of numbers */
  result: number[]
  /** Console logs from the contract execution */
  logs: string[]
  /** Block height at which the function was called */
  block_height: number
  /** Block hash at which the function was called */
  block_hash: string
}

/**
 * Account information returned by view_account query
 */
export interface AccountView {
  /** Account balance in yoctoNEAR */
  amount: string
  /** Locked balance in yoctoNEAR (for staking) */
  locked: string
  /** Hash of the contract code (base58) */
  code_hash: string
  /** Storage used by the account in bytes */
  storage_usage: number
  /** Block height at which storage was paid */
  storage_paid_at: number
  /** Block height of the query */
  block_height: number
  /** Block hash of the query */
  block_hash: string
}

/**
 * Access key information returned by view_access_key query
 */
export interface AccessKeyView {
  /** Current nonce for the access key */
  nonce: number
  /** Permission type (FullAccess or FunctionCall) */
  permission: AccessKeyPermission
  /** Block height of the query */
  block_height: number
  /** Block hash of the query */
  block_hash: string
}

/**
 * Access key with its public key
 */
export interface AccessKeyInfoView {
  /** Public key string (e.g., "ed25519:...") */
  public_key: string
  /** Access key details */
  access_key: AccessKeyView
}

/**
 * Network status information
 */
export interface StatusResponse {
  /** Node version information */
  version: {
    /** Version string (e.g., "1.0.0") */
    version: string
    /** Build identifier */
    build: string
    /** Git commit hash */
    commit?: string
    /** Rustc version used to build */
    rustc_version?: string
  }
  /** Chain ID (e.g., "mainnet", "testnet") */
  chain_id: string
  /** Genesis hash */
  genesis_hash: string
  /** Current protocol version */
  protocol_version: number
  /** Latest protocol version */
  latest_protocol_version: number
  /** RPC address */
  rpc_addr: string
  /** Node's public key (if validator) */
  node_public_key: string
  /** Node's key */
  node_key: string | null
  /** Validator account ID (null if not a validator) */
  validator_account_id: string | null
  /** Validator public key (null if not a validator) */
  validator_public_key: string | null
  /** List of current validators */
  validators: Array<{
    /** Validator account ID */
    account_id: string
  }>
  /** Sync information */
  sync_info: {
    /** Hash of the latest block */
    latest_block_hash: string
    /** Height of the latest block */
    latest_block_height: number
    /** Latest state root hash */
    latest_state_root: string
    /** Timestamp of the latest block */
    latest_block_time: string
    /** Whether the node is currently syncing */
    syncing: boolean
    /** Earliest block hash if available */
    earliest_block_hash?: string
    /** Earliest block height if available */
    earliest_block_height?: number
    /** Earliest block time if available */
    earliest_block_time?: string
    /** Current epoch ID */
    epoch_id?: string
    /** Epoch start height */
    epoch_start_height?: number
  }
  /** Uptime in seconds */
  uptime_sec?: number
}

/**
 * Gas price information
 */
export interface GasPriceResponse {
  /** Gas price in yoctoNEAR */
  gas_price: string
}

/**
 * Access key list response from view_access_key_list query
 */
export interface AccessKeyListResponse {
  /** Block hash at which the query was executed */
  block_hash: string
  /** Block height at which the query was executed */
  block_height: number
  /** List of access keys with their details */
  keys: Array<{
    /** Public key string (e.g., "ed25519:...") */
    public_key: string
    /** Access key details */
    access_key: {
      /** Current nonce for the access key */
      nonce: number
      /** Permission type */
      permission: AccessKeyPermission
    }
  }>
}

/**
 * RPC error response structure
 */
export interface RpcErrorResponse {
  /** Error name/type */
  name: string
  /** Error code */
  code: number
  /** Error message */
  message: string
  /** Additional error data */
  data?: string
  /** Error cause with additional context */
  cause?: {
    /** Cause name/type */
    name: string
    /** Additional info about the error */
    info?: Record<string, unknown>
  }
}

// ==================== Client Configuration ====================

export interface NearConfig {
  network?: NetworkConfig
  privateKey?: string | KeyConfig
  keyStore?: KeyStore | string | Record<string, string>
  signer?: Signer
  wallet?: boolean | "near-wallet" | "sender" | "meteor"
  rpcUrl?: string
  archivalRpcUrl?: string
  headers?: Record<string, string>
  autoGas?: boolean
  readOnly?: boolean
}

export interface KeyStore {
  add(accountId: string, key: KeyPair): Promise<void>
  get(accountId: string): Promise<KeyPair | null>
  remove(accountId: string): Promise<void>
  list(): Promise<string[]>
}

// ==================== Function Call Options ====================

export interface CallOptions {
  gas?: string | number
  attachedDeposit?: string | number
  signerId?: string
}

// ==================== Contract Interface ====================

export interface ContractMethods {
  view: Record<string, (...args: unknown[]) => Promise<unknown>>
  call: Record<string, (...args: unknown[]) => Promise<unknown>>
}

// ==================== Wallet Interface ====================

export interface WalletSignInOptions {
  contractId?: string
  methodNames?: string[]
  successUrl?: string
  failureUrl?: string
}

// ==================== Gas Estimation ====================

export interface GasEstimate {
  total: string
  breakdown: Array<{
    action: string
    gas: string
  }>
}
