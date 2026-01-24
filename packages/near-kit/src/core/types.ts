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
  signNep413Message?(
    accountId: string,
    params: SignMessageParams,
  ): SignedMessage
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

/**
 * Custom signing function for transactions.
 *
 * A Signer is an async function that takes a message (the SHA-256 hash of a
 * serialized transaction) and returns a cryptographic signature. Use custom
 * signers to integrate with:
 *
 * - Hardware wallets (Ledger, Trezor)
 * - Key Management Systems (AWS KMS, HashiCorp Vault)
 * - Multi-signature schemes
 * - Custom key derivation logic
 *
 * @param message - SHA-256 hash of the serialized transaction (32 bytes)
 * @returns Promise resolving to a signature with key type info
 *
 * @example
 * ```typescript
 * // Hardware wallet signer
 * const hwSigner: Signer = async (message) => {
 *   const sig = await ledger.signTransaction(message)
 *   return {
 *     keyType: KeyType.ED25519,
 *     data: sig
 *   }
 * }
 *
 * const near = new Near({
 *   network: 'testnet',
 *   signer: hwSigner
 * })
 *
 * // All transactions now use hardware wallet
 * await near.transaction('alice.near').transfer('bob.near', '1').send()
 * ```
 *
 * @see {@link NearConfig.signer} for configuration
 * @see {@link TransactionBuilder.signWith} to override per-transaction
 */
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
// Import for use in SendOptions
import type { FinalExecutionOutcomeMap } from "./rpc/rpc-schemas.js"

export interface SendOptions<
  W extends keyof FinalExecutionOutcomeMap = keyof FinalExecutionOutcomeMap,
> {
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
  waitUntil?: W
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

/**
 * Transaction execution types inferred from validated RPC schemas
 *
 * These types match the actual RPC response format and provide runtime validation.
 *
 * - ExecutionStatus: Status of transaction/receipt execution (SuccessValue, SuccessReceiptId, or Failure)
 * - ExecutionOutcome: Details of transaction execution including gas, logs, and status
 * - ExecutionOutcomeWithId: Execution outcome with transaction/receipt ID and block info
 * - FinalExecutionOutcome: Complete transaction result including all receipts
 * - FinalExecutionOutcomeWithReceipts: Extended outcome with full receipt details (from EXPERIMENTAL_tx_status)
 *
 * @see {@link https://docs.near.org/api/rpc/transactions NEAR RPC Transaction Documentation}
 */
export type {
  ExecutionMetadata,
  ExecutionOutcome,
  ExecutionOutcomeWithId,
  ExecutionStatus,
  FinalExecutionOutcome,
  FinalExecutionOutcomeMap,
  FinalExecutionOutcomeWithReceipts,
  FinalExecutionOutcomeWithReceiptsMap,
  MerklePathItem,
  Receipt,
  RpcAction,
  RpcTransaction,
} from "./rpc/rpc-schemas.js"

// Import for use in this file
import type { FinalExecutionOutcome } from "./rpc/rpc-schemas.js"

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
  BlockHeaderView,
  BlockView,
  ChunkHeaderView,
  GasPriceResponse,
  RpcErrorResponse,
  StatusResponse,
  ViewFunctionCallResult,
} from "./rpc/rpc-schemas.js"

// ==================== Client Configuration ====================
// Re-exported from config-schemas.ts for backward compatibility

export type { NearConfig } from "./config-schemas.js"

/**
 * Pluggable key store interface used by {@link Near} and {@link TransactionBuilder}.
 *
 * Implementations are responsible for persisting key pairs (in memory, on disk,
 * in secure hardware, etc.). The bundled implementations are:
 *
 * - {@link InMemoryKeyStore} for ephemeral keys
 * - {@link FileKeyStore} for NEAR-CLI compatible on-disk storage
 *
 * @remarks
 * All methods are asynchronous to support remote or secure storage backends.
 */
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

/**
 * Base contract method shape used by {@link Contract}.
 *
 * @remarks
 * Library users typically define their own contract interfaces that extend this
 * structure and then pass them to {@link Near.contract}.
 */
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

/**
 * Account information returned by wallet
 */
export interface WalletAccount {
  accountId: string
  publicKey?: string
}

/**
 * Parameters for signing a message (NEP-413)
 *
 * @see https://github.com/near/NEPs/blob/master/neps/nep-0413.md
 */
export interface SignMessageParams {
  /** The message that wants to be transmitted */
  message: string
  /** The recipient to whom the message is destined (e.g. "alice.near" or "myapp.com") */
  recipient: string
  /** A nonce that uniquely identifies this instance of the message (32 bytes) */
  nonce: Uint8Array
  /** Optional, applicable to browser wallets. The URL to call after the signing process */
  callbackUrl?: string
  /** Optional, applicable to browser wallets. A state for CSRF protection */
  state?: string
}

/**
 * Signed message result (NEP-413)
 *
 * @see https://github.com/near/NEPs/blob/master/neps/nep-0413.md
 */
export interface SignedMessage {
  /** The account name to which the publicKey corresponds */
  accountId: string
  /** The public key used to sign, in format "<key-type>:<base58-key-bytes>" */
  publicKey: string
  /** The base58 signature prefixed with the key type (e.g., "ed25519:...") */
  signature: string
  /** Optional state returned from browser wallets (for CSRF protection) */
  state?: string
}

/**
 * Wallet connection interface
 * Compatible with both @near-wallet-selector and @hot-labs/near-connect
 */
export interface WalletConnection {
  /**
   * Get connected accounts from wallet
   */
  getAccounts(): Promise<WalletAccount[]>

  /**
   * Sign and send a transaction using the wallet
   */
  signAndSendTransaction(params: {
    signerId?: string
    receiverId: string
    actions: Action[]
  }): Promise<FinalExecutionOutcome>

  /**
   * Sign a message using the wallet (optional)
   */
  signMessage?(params: SignMessageParams): Promise<SignedMessage>
}
