/**
 * Error classes for NEAR client library
 */

/**
 * Base error class for all NEAR-related errors
 */
export class NearError extends Error {
  code: string
  data?: unknown

  constructor(message: string, code: string, data?: unknown) {
    super(message)
    this.name = "NearError"
    this.code = code
    this.data = data
    Object.setPrototypeOf(this, NearError.prototype)
  }
}

/**
 * Thrown when an account has insufficient balance for an operation
 */
export class InsufficientBalanceError extends NearError {
  required: string
  available: string

  constructor(required: string, available: string) {
    super(
      `Insufficient balance: required ${required} NEAR, available ${available} NEAR`,
      "INSUFFICIENT_BALANCE",
    )
    this.name = "InsufficientBalanceError"
    this.required = required
    this.available = available
    Object.setPrototypeOf(this, InsufficientBalanceError.prototype)
  }
}

/**
 * Thrown when a contract function call fails
 */
export class FunctionCallError extends NearError {
  panic?: string
  methodName: string
  contractId: string

  constructor(contractId: string, methodName: string, panic?: string) {
    const message = panic
      ? `Contract call failed: ${contractId}.${methodName} - ${panic}`
      : `Contract call failed: ${contractId}.${methodName}`

    super(message, "FUNCTION_CALL_ERROR")
    this.name = "FunctionCallError"
    this.contractId = contractId
    this.methodName = methodName
    if (panic !== undefined) {
      this.panic = panic
    }
    Object.setPrototypeOf(this, FunctionCallError.prototype)
  }
}

/**
 * Thrown when a network request fails
 */
export class NetworkError extends NearError {
  statusCode?: number
  retryable: boolean

  constructor(message: string, statusCode?: number, retryable = true) {
    super(message, "NETWORK_ERROR", { statusCode })
    this.name = "NetworkError"
    if (statusCode !== undefined) {
      this.statusCode = statusCode
    }
    this.retryable = retryable
    Object.setPrototypeOf(this, NetworkError.prototype)
  }
}

/**
 * Thrown when a key is invalid or malformed
 */
export class InvalidKeyError extends NearError {
  constructor(message: string) {
    super(message, "INVALID_KEY")
    this.name = "InvalidKeyError"
    Object.setPrototypeOf(this, InvalidKeyError.prototype)
  }
}

/**
 * Thrown when an account does not exist
 */
export class AccountDoesNotExistError extends NearError {
  accountId: string

  constructor(accountId: string) {
    super(`Account does not exist: ${accountId}`, "ACCOUNT_NOT_FOUND")
    this.name = "AccountDoesNotExistError"
    this.accountId = accountId
    Object.setPrototypeOf(this, AccountDoesNotExistError.prototype)
  }
}

/**
 * Thrown when an access key does not exist
 */
export class AccessKeyDoesNotExistError extends NearError {
  accountId: string
  publicKey: string

  constructor(accountId: string, publicKey: string) {
    super(
      `Access key does not exist: ${publicKey} for account ${accountId}`,
      "ACCESS_KEY_NOT_FOUND",
    )
    this.name = "AccessKeyDoesNotExistError"
    this.accountId = accountId
    this.publicKey = publicKey
    Object.setPrototypeOf(this, AccessKeyDoesNotExistError.prototype)
  }
}

/**
 * Thrown when an account ID is invalid
 */
export class InvalidAccountIdError extends NearError {
  accountId: string

  constructor(accountId: string, reason?: string) {
    const message = reason
      ? `Invalid account ID: ${accountId} - ${reason}`
      : `Invalid account ID: ${accountId}`

    super(message, "INVALID_ACCOUNT_ID")
    this.name = "InvalidAccountIdError"
    this.accountId = accountId
    Object.setPrototypeOf(this, InvalidAccountIdError.prototype)
  }
}

/**
 * Thrown when transaction signing fails
 */
export class SignatureError extends NearError {
  constructor(message: string) {
    super(message, "SIGNATURE_ERROR")
    this.name = "SignatureError"
    Object.setPrototypeOf(this, SignatureError.prototype)
  }
}

/**
 * Thrown when gas limit is exceeded
 */
export class GasLimitExceededError extends NearError {
  gasUsed: string
  gasLimit: string

  constructor(gasUsed: string, gasLimit: string) {
    super(
      `Gas limit exceeded: used ${gasUsed}, limit ${gasLimit}`,
      "GAS_LIMIT_EXCEEDED",
    )
    this.name = "GasLimitExceededError"
    this.gasUsed = gasUsed
    this.gasLimit = gasLimit
    Object.setPrototypeOf(this, GasLimitExceededError.prototype)
  }
}

/**
 * Thrown when a transaction times out
 */
export class TransactionTimeoutError extends NearError {
  transactionHash: string

  constructor(transactionHash: string) {
    super(`Transaction timed out: ${transactionHash}`, "TRANSACTION_TIMEOUT")
    this.name = "TransactionTimeoutError"
    this.transactionHash = transactionHash
    Object.setPrototypeOf(this, TransactionTimeoutError.prototype)
  }
}

/**
 * Thrown when wallet operations fail
 */
export class WalletError extends NearError {
  constructor(message: string) {
    super(message, "WALLET_ERROR")
    this.name = "WalletError"
    Object.setPrototypeOf(this, WalletError.prototype)
  }
}
