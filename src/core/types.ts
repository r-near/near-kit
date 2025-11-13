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

export type FullAccessPermission = {
  permission: "FullAccess"
}

export type FunctionCallPermission = {
  permission: "FunctionCall"
  receiverId: string
  methodNames?: string[]
  allowance?: string
}

export type AccessKeyPermission = FullAccessPermission | FunctionCallPermission

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

export interface ViewFunctionCallResult {
  result: number[]
  logs: string[]
  block_height: number
  block_hash: string
}

export interface AccountView {
  amount: string
  locked: string
  code_hash: string
  storage_usage: number
  storage_paid_at: number
  block_height: number
  block_hash: string
}

export interface AccessKeyView {
  nonce: number
  permission: AccessKeyPermission
  block_height: number
  block_hash: string
}

export interface AccessKeyInfoView {
  public_key: string
  access_key: AccessKeyView
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
