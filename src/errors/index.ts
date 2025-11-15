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
  methodName?: string
  contractId: string
  logs: string[]

  constructor(
    contractId: string,
    methodName: string | undefined,
    panic?: string,
    logs: string[] = [],
  ) {
    const methodPart = methodName ? `.${methodName}` : ""
    const message = panic
      ? `Contract call failed: ${contractId}${methodPart} - ${panic}`
      : `Contract call failed: ${contractId}${methodPart}`

    super(message, "FUNCTION_CALL_ERROR")
    this.name = "FunctionCallError"
    this.contractId = contractId
    if (methodName !== undefined) {
      this.methodName = methodName
    }
    this.logs = logs
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

/**
 * Thrown when a requested block cannot be found
 * Suggests using an archival node for old blocks
 */
export class UnknownBlockError extends NearError {
  blockReference: string

  constructor(blockReference: string) {
    super(
      `Block not found: ${blockReference}. It may have been garbage-collected. Try an archival node for blocks older than 5 epochs.`,
      "UNKNOWN_BLOCK",
    )
    this.name = "UnknownBlockError"
    this.blockReference = blockReference
    Object.setPrototypeOf(this, UnknownBlockError.prototype)
  }
}

/**
 * Thrown when account ID format is invalid
 */
export class InvalidAccountError extends NearError {
  accountId: string

  constructor(accountId: string) {
    super(`Invalid account ID format: ${accountId}`, "INVALID_ACCOUNT")
    this.name = "InvalidAccountError"
    this.accountId = accountId
    Object.setPrototypeOf(this, InvalidAccountError.prototype)
  }
}

/**
 * Thrown when the requested shard is not available on this node
 */
export class ShardUnavailableError extends NearError {
  retryable = true

  constructor(message?: string) {
    super(
      message ||
        "The requested shard is not tracked by this node. Try a different node.",
      "UNAVAILABLE_SHARD",
    )
    this.name = "ShardUnavailableError"
    Object.setPrototypeOf(this, ShardUnavailableError.prototype)
  }
}

/**
 * Thrown when the node is still syncing
 */
export class NodeNotSyncedError extends NearError {
  retryable = true

  constructor(message?: string) {
    super(
      message ||
        "Node is still syncing. Wait for sync to complete or try a different node.",
      "NOT_SYNCED",
    )
    this.name = "NodeNotSyncedError"
    Object.setPrototypeOf(this, NodeNotSyncedError.prototype)
  }
}

/**
 * Thrown when an account has no contract deployed
 */
export class ContractNotDeployedError extends NearError {
  accountId: string

  constructor(accountId: string) {
    super(`No contract deployed on account: ${accountId}`, "NO_CONTRACT_CODE")
    this.name = "ContractNotDeployedError"
    this.accountId = accountId
    Object.setPrototypeOf(this, ContractNotDeployedError.prototype)
  }
}

/**
 * Thrown when contract state is too large to return
 */
export class ContractStateTooLargeError extends NearError {
  accountId: string

  constructor(accountId: string) {
    super(
      `Contract state too large (>50kb) for account ${accountId}. Try a node with larger limits.`,
      "TOO_LARGE_CONTRACT_STATE",
    )
    this.name = "ContractStateTooLargeError"
    this.accountId = accountId
    Object.setPrototypeOf(this, ContractStateTooLargeError.prototype)
  }
}

/**
 * Thrown when a view function call execution fails
 */
export class ContractExecutionError extends NearError {
  contractId: string
  methodName?: string
  details?: unknown

  constructor(contractId: string, methodName?: string, details?: unknown) {
    const message = methodName
      ? `Contract execution failed: ${contractId}.${methodName}`
      : `Contract execution failed: ${contractId}`

    super(message, "CONTRACT_EXECUTION_ERROR", details)
    this.name = "ContractExecutionError"
    this.contractId = contractId
    if (methodName !== undefined) {
      this.methodName = methodName
    }
    if (details !== undefined) {
      this.details = details
    }
    Object.setPrototypeOf(this, ContractExecutionError.prototype)
  }
}

/**
 * Thrown when a chunk cannot be found
 */
export class UnknownChunkError extends NearError {
  chunkReference: string

  constructor(chunkReference: string) {
    super(
      `Chunk not found: ${chunkReference}. It may have been garbage-collected. Try an archival node.`,
      "UNKNOWN_CHUNK",
    )
    this.name = "UnknownChunkError"
    this.chunkReference = chunkReference
    Object.setPrototypeOf(this, UnknownChunkError.prototype)
  }
}

/**
 * Thrown when an invalid shard ID is provided
 */
export class InvalidShardIdError extends NearError {
  shardId: number | string

  constructor(shardId: number | string) {
    super(
      `Invalid shard ID: ${shardId}. Provide a valid shard ID within the network's range.`,
      "INVALID_SHARD_ID",
    )
    this.name = "InvalidShardIdError"
    this.shardId = shardId
    Object.setPrototypeOf(this, InvalidShardIdError.prototype)
  }
}

/**
 * Thrown when an epoch cannot be found
 */
export class UnknownEpochError extends NearError {
  blockReference: string

  constructor(blockReference: string) {
    super(
      `Epoch not found for block: ${blockReference}. The block may be invalid or too old. Try an archival node.`,
      "UNKNOWN_EPOCH",
    )
    this.name = "UnknownEpochError"
    this.blockReference = blockReference
    Object.setPrototypeOf(this, UnknownEpochError.prototype)
  }
}

/**
 * Thrown when transaction nonce is invalid
 * This happens when a transaction uses a nonce that has already been used
 */
export class InvalidNonceError extends NearError {
  txNonce: number
  akNonce: number
  retryable = true // Can retry with updated nonce

  constructor(txNonce: number, akNonce: number) {
    super(
      `Invalid transaction nonce: transaction nonce ${txNonce} must be greater than access key nonce ${akNonce}`,
      "INVALID_NONCE",
    )
    this.name = "InvalidNonceError"
    this.txNonce = txNonce
    this.akNonce = akNonce
    Object.setPrototypeOf(this, InvalidNonceError.prototype)
  }
}

/**
 * Thrown when a transaction is invalid
 * Check details for specific reasons like ShardCongested or ShardStuck
 */
export class InvalidTransactionError extends NearError {
  retryable: boolean
  shardCongested: boolean
  shardStuck: boolean
  details?: unknown

  constructor(message: string, details?: unknown) {
    super(message, "INVALID_TRANSACTION", details)
    this.name = "InvalidTransactionError"
    this.details = details

    // Check if this is a retryable transaction error
    const detailsObj = details as
      | { ShardCongested?: boolean; ShardStuck?: boolean }
      | undefined
    this.shardCongested = !!detailsObj?.ShardCongested
    this.shardStuck = !!detailsObj?.ShardStuck
    this.retryable = this.shardCongested || this.shardStuck

    Object.setPrototypeOf(this, InvalidTransactionError.prototype)
  }
}

/**
 * Thrown when a receipt cannot be found
 */
export class UnknownReceiptError extends NearError {
  receiptId: string

  constructor(receiptId: string) {
    super(
      `Receipt not found: ${receiptId}. It may not have been observed on this node.`,
      "UNKNOWN_RECEIPT",
    )
    this.name = "UnknownReceiptError"
    this.receiptId = receiptId
    Object.setPrototypeOf(this, UnknownReceiptError.prototype)
  }
}

/**
 * Thrown when request parameters cannot be parsed
 */
export class ParseError extends NearError {
  constructor(message: string, details?: unknown) {
    super(
      `Request validation failed: ${message}. Check that all parameters are valid.`,
      "PARSE_ERROR",
      details,
    )
    this.name = "ParseError"
    Object.setPrototypeOf(this, ParseError.prototype)
  }
}

/**
 * Thrown when a request times out (408)
 * This is always retryable - resubmit the identical transaction
 */
export class TimeoutError extends NearError {
  retryable = true
  transactionHash?: string

  constructor(message?: string, transactionHash?: string) {
    super(
      message ||
        "Request timed out. The transaction may still be processed. Resubmit the identical transaction.",
      "TIMEOUT_ERROR",
    )
    this.name = "TimeoutError"
    if (transactionHash !== undefined) {
      this.transactionHash = transactionHash
    }
    Object.setPrototypeOf(this, TimeoutError.prototype)
  }
}

/**
 * Thrown when the RPC server encounters an internal error (500)
 * This is always retryable
 */
export class InternalServerError extends NearError {
  retryable = true

  constructor(message?: string, details?: unknown) {
    super(
      message ||
        "Internal server error. The node may be overloaded. Try again or use a different node.",
      "INTERNAL_ERROR",
      details,
    )
    this.name = "InternalServerError"
    Object.setPrototypeOf(this, InternalServerError.prototype)
  }
}
