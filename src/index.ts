/**
 * near-kit - A simple, intuitive TypeScript library for interacting with NEAR Protocol
 */

// Contract types
export type { Contract, ContractMethods } from "./contracts/contract.js"
// Delegate actions
export { DelegateAction } from "./core/actions.js"
// Main class
export { Near } from "./core/near.js"
export {
  DELEGATE_ACTION_PREFIX,
  type DelegateActionPayloadFormat,
  decodeSignedDelegateAction,
  encodeSignedDelegateAction,
  type SignedDelegateAction,
  serializeDelegateAction,
} from "./core/schema.js"
export type { DelegateActionResult } from "./core/transaction.js"
export { TransactionBuilder } from "./core/transaction.js"
// Types
export type {
  CallOptions,
  FinalExecutionOutcome,
  KeyConfig,
  KeyPair,
  KeyStore,
  NearConfig,
  NetworkConfig,
  PublicKey,
  SendOptions,
  Signature,
  SignedMessage,
  SignMessageParams,
  TxExecutionStatus,
  WalletAccount,
  WalletConnection,
  WalletSignInOptions,
} from "./core/types.js"
// Errors
export {
  AccessKeyDoesNotExistError,
  AccountDoesNotExistError,
  FunctionCallError,
  GasLimitExceededError,
  InsufficientBalanceError,
  InvalidAccountIdError,
  InvalidKeyError,
  NearError,
  NetworkError,
  SignatureError,
  TransactionTimeoutError,
  WalletError,
} from "./errors/index.js"
// Credential schemas and types
export type {
  LegacyCredential,
  NearCliCredential,
  Network,
} from "./keys/index.js"
// Key stores
export {
  InMemoryKeyStore,
  RotatingKeyStore,
  // Node.js-only keystores not exported by default (browser environments don't support them)
  // For Node.js/Bun:
  //   import { FileKeyStore } from "near-kit/keys/file"
  //   import { NativeKeyStore } from "near-kit/keys/native"
} from "./keys/index.js"
// Sandbox is not exported by default (requires Node.js)
// For Node.js/Bun: import { Sandbox } from "near-kit/sandbox"
export type { SandboxOptions } from "./sandbox/index.js"
// Utilities
export {
  Amount,
  formatAmount,
  formatGas,
  Gas,
  generateKey,
  generateNep413Nonce,
  generateSeedPhrase,
  isPrivateKey,
  isValidAccountId,
  isValidPublicKey,
  type PrivateKey,
  parseAmount,
  parseGas,
  parseKey,
  parseSeedPhrase,
  validatePrivateKey,
  verifyNep413Signature,
} from "./utils/index.js"
// Wallet adapters
export { fromHotConnect, fromWalletSelector } from "./wallets/index.js"
