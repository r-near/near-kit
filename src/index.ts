/**
 * near-kit - A simple, intuitive TypeScript library for interacting with NEAR Protocol
 */

// Delegate actions
export {
  DelegateAction,
  SignedDelegate,
} from "./core/actions.js"
// Main class
export { Near } from "./core/near.js"
export {
  DELEGATE_ACTION_PREFIX,
  serializeDelegateAction,
  serializeSignedDelegate,
} from "./core/schema.js"
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
  SimulationResult,
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
  FileKeyStore,
  InMemoryKeyStore,
  // NativeKeyStore is not exported by default (requires native Node.js modules)
  // For Node.js/Bun: import { NativeKeyStore } from "near-kit/dist/keys/native-keystore.js"
} from "./keys/index.js"
export type { SandboxOptions } from "./sandbox/index.js"
// Sandbox
export { Sandbox } from "./sandbox/index.js"
// Utilities
export {
  Amount,
  formatAmount,
  formatGas,
  Gas,
  generateKey,
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
} from "./utils/index.js"
// Wallet adapters
export { fromHotConnect, fromWalletSelector } from "./wallets/index.js"
