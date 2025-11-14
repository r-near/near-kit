/**
 * Core type definitions for the NEAR client library
 */

// ==================== Network Configuration ====================
// Re-exported from config-schemas.ts for backward compatibility

export type {
  CustomNetworkConfig,
  NetworkConfig,
  NetworkPreset,
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

/**
 * Transaction execution status levels for wait_until parameter.
 *
 * Determines when the RPC should return a response after submitting a transaction:
 *
 * - **NONE**: Don't wait - returns immediately after basic validation (transaction structure is valid)
 * - **INCLUDED**: Wait until transaction is included in a block (signature validated, nonce updated, converted to receipt)
 * - **EXECUTED_OPTIMISTIC**: Wait until transaction execution completes (default - fast, works well for sandbox/testnet)
 * - **INCLUDED_FINAL**: Wait until the block containing the transaction is finalized
 * - **EXECUTED**: Wait until both INCLUDED_FINAL and EXECUTED_OPTIMISTIC conditions are met
 * - **FINAL**: Wait until the block with the last non-refund receipt is finalized (full finality guarantee)
 *
 * @see {@link https://docs.near.org/api/rpc/transactions#send-transaction-await NEAR RPC Documentation}
 */
export type TxExecutionStatus =
  | "NONE"
  | "INCLUDED"
  | "EXECUTED_OPTIMISTIC"
  | "INCLUDED_FINAL"
  | "EXECUTED"
  | "FINAL"

/**
 * Options for sending a transaction
 */
export interface SendOptions {
  /**
   * Controls when the RPC returns after submitting the transaction.
   *
   * **Execution Flow:**
   *
   * 1. **NONE**: Transaction validated (structure check only) - no execution started
   * 2. **INCLUDED**: Transaction included in block, signature validated, nonce updated, receipt created - execution started
   * 3. **EXECUTED_OPTIMISTIC**: All receipts executed (may include cross-contract calls) - execution complete
   * 4. **INCLUDED_FINAL**: Block with transaction is finalized
   * 5. **EXECUTED**: Both INCLUDED_FINAL + EXECUTED_OPTIMISTIC
   * 6. **FINAL**: Block with last non-refund receipt is finalized
   *
   * **Note:** INCLUDED_FINAL may resolve before or after EXECUTED_OPTIMISTIC depending on execution time.
   *
   * @default "EXECUTED_OPTIMISTIC"
   */
  waitUntil?: TxExecutionStatus
}

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
  add(
    accountId: string,
    key: KeyPair,
    options?: {
      seedPhrase?: string
      derivationPath?: string
      implicitAccountId?: string
    },
  ): Promise<void>
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
