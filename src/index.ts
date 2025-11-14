/**
 * near-kit - A simple, intuitive TypeScript library for interacting with NEAR Protocol
 */

// Main class
export { Near } from "./core/near.js"
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
  SimulationResult,
  TxExecutionStatus,
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
// Key stores
export {
  EncryptedKeyStore,
  FileKeyStore,
  InMemoryKeyStore,
} from "./keys/index.js"
export type { SandboxOptions } from "./sandbox/index.js"
// Sandbox
export { Sandbox } from "./sandbox/index.js"
// Utilities
export {
  formatGas,
  formatNearAmount,
  generateKey,
  generateSeedPhrase,
  isValidAccountId,
  isValidPublicKey,
  parseGas,
  parseKey,
  parseNearAmount,
  parseSeedPhrase,
  toGas,
  toTGas,
} from "./utils/index.js"
