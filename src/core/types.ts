/**
 * Core type definitions for the NEAR client library
 */

// ==================== Network Configuration ====================
// Re-exported from config-schemas.ts for backward compatibility

export type {
  NetworkPreset,
  CustomNetworkConfig,
  NetworkConfig,
} from "./config-schemas.js"

export type NetworkId = "mainnet" | "testnet" | "localnet"

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
 *
 * Fields:
 * - receiver_id: Account ID that can be called
 * - method_names: List of method names that can be called (empty array means any)
 * - allowance: Optional allowance in yoctoNEAR
 */
export type {
  AccessKeyPermission,
  FunctionCallPermissionDetails,
} from "./rpc/rpc-schemas.js"

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
 * RPC response types with runtime validation via Zod schemas
 *
 * These types are inferred from Zod schemas defined in rpc-schemas.ts
 * and provide both compile-time and runtime type safety.
 *
 * - ViewFunctionCallResult: Result from calling a view function on a contract
 * - AccountView: Account information returned by view_account query
 * - AccessKeyView: Access key information returned by view_access_key query
 * - AccessKeyInfoView: Access key with its public key
 * - StatusResponse: Network status information
 * - GasPriceResponse: Gas price information
 * - AccessKeyListResponse: Access key list from view_access_key_list query
 * - RpcErrorResponse: RPC error response structure
 */
export type {
  AccessKeyInfoView,
  AccessKeyListResponse,
  AccessKeyView,
  AccountView,
  GasPriceResponse,
  RpcErrorResponse,
  StatusResponse,
  ViewFunctionCallResult,
} from "./rpc/rpc-schemas.js"

// ==================== Client Configuration ====================
// Re-exported from config-schemas.ts for backward compatibility

export type { NearConfig } from "./config-schemas.js"

export interface KeyStore {
  add(accountId: string, key: KeyPair): Promise<void>
  get(accountId: string): Promise<KeyPair | null>
  remove(accountId: string): Promise<void>
  list(): Promise<string[]>
}

// ==================== Function Call Options ====================
// Re-exported from config-schemas.ts for backward compatibility

export type { CallOptions } from "./config-schemas.js"

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
