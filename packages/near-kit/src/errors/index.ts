/**
 * Error classes for the NEAR client library.
 *
 * @remarks
 * All errors in this module extend {@link NearError}, which carries a stable
 * `code` string and optional `data` field. Many errors also expose a
 * `retryable` flag to indicate whether the operation is safe to retry.
 */

/**
 * Base error class for all NEAR-related errors.
 *
 * Provides a stable `code` and optional `data` payload for structured error
 * handling. Concrete error subclasses in this module narrow down specific
 * failure scenarios (network issues, contract panics, invalid transactions, etc.).
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
 * Thrown when a global contract is not found in the on-chain registry.
 *
 * The `identifier` mirrors how the contract was looked up: by immutable code
 * hash (base58) or by the publishing account ID.
 */
export class GlobalContractNotFoundError extends NearError {
  identifier: { codeHash: string } | { accountId: string }

  constructor(identifier: { codeHash: string } | { accountId: string }) {
    const label =
      "codeHash" in identifier
        ? `code hash ${identifier.codeHash}`
        : `account ${identifier.accountId}`
    super(
      `No global contract published for ${label}`,
      "NO_GLOBAL_CONTRACT_CODE",
    )
    this.name = "GlobalContractNotFoundError"
    this.identifier = identifier
    Object.setPrototypeOf(this, GlobalContractNotFoundError.prototype)
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
 * Thrown when a transaction or a contract-created receipt transfers NEAR to a
 * universal account (`0u...` id) while the network bans such transfers.
 *
 * nearcore rejects these with `TransferToUniversalAccountNotAllowed` from the
 * protocol version that introduces the ban until universal accounts are
 * enabled. Retrying the same transfer will fail the same way until then.
 */
export class TransferToUniversalAccountNotAllowedError extends NearError {
  accountId: string
  retryable = false

  constructor(accountId: string, details?: unknown) {
    super(
      `Transfers to the universal account ${accountId} are not allowed yet: the network rejects transfers to 0u accounts until universal accounts are enabled`,
      "TRANSFER_TO_UNIVERSAL_ACCOUNT_NOT_ALLOWED",
      details,
    )
    this.name = "TransferToUniversalAccountNotAllowedError"
    this.accountId = accountId
    Object.setPrototypeOf(
      this,
      TransferToUniversalAccountNotAllowedError.prototype,
    )
  }
}

/**
 * Thrown when a contract refuses an external call (NEP-667): its
 * `__external_call` method failed, or the call failed a check before or after
 * the run. A refused call is rolled back and nobody pays.
 *
 * Raised by a view call of `__external_call` (the chunk producer's dry run,
 * RPC error `EXTERNAL_CALL_REFUSED`) and by a copy of the call that was
 * included in a chunk and refused at execution. For the latter, `uniqueId` is
 * the copy's unique id.
 *
 * `retryable` is true when the copy did not run because the chunk's external
 * calls had used up their share of the chunk (`ExternalCallChunkShareReached`):
 * sending the call again can land it in a later chunk.
 */
export class ExternalCallRefusedError extends NearError {
  contractId: string
  /** The reason, as nearcore's `TxExecutionError`. */
  details: unknown
  /** The logs of the contract's run; empty for a call refused before its run. */
  logs: string[]
  uniqueId?: string
  blockHeight?: number
  blockHash?: string
  retryable: boolean

  constructor(
    contractId: string,
    details: unknown,
    logs: string[] = [],
    context: {
      uniqueId?: string
      blockHeight?: number
      blockHash?: string
    } = {},
  ) {
    super(
      `External call refused by ${contractId}: ${describeExecutionError(details)}`,
      "EXTERNAL_CALL_REFUSED",
      details,
    )
    this.name = "ExternalCallRefusedError"
    this.contractId = contractId
    this.details = details
    this.logs = logs
    if (context.uniqueId !== undefined) this.uniqueId = context.uniqueId
    if (context.blockHeight !== undefined)
      this.blockHeight = context.blockHeight
    if (context.blockHash !== undefined) this.blockHash = context.blockHash
    const invalidTx = (details as { InvalidTxError?: unknown } | null)
      ?.InvalidTxError
    this.retryable =
      typeof invalidTx === "object" &&
      invalidTx !== null &&
      "ExternalCallChunkShareReached" in invalidTx
    Object.setPrototypeOf(this, ExternalCallRefusedError.prototype)
  }
}

/**
 * Thrown when a waiting `send_tx` of an external call times out before the
 * node finds a copy of the call on chain.
 *
 * The call may still land, or may have landed where this node cannot see it.
 * Send the same call again (`send_tx` returns a copy that already landed), or
 * search for it by `callHash` from `sentAtHeight` with
 * `Near.findExternalCall`.
 */
export class ExternalCallTimeoutError extends NearError {
  retryable = true
  contractId: string
  /** The call hash (without the state init) every copy's unique id comes from. */
  callHash: string
  /** The chain head height seen right before the call was sent. */
  sentAtHeight: number
  /**
   * The unique id of a copy the node saw land that had not reached the
   * requested wait level yet (timeout cause `PENDING`). Look it up with
   * `Near.getExternalCallStatus`.
   */
  uniqueId?: string

  constructor(
    contractId: string,
    callHash: string,
    sentAtHeight: number,
    uniqueId?: string,
  ) {
    super(
      uniqueId === undefined
        ? `External call to ${contractId} (call hash ${callHash}) was not found on chain before the request timed out. It may still land: send it again or search from height ${sentAtHeight}.`
        : `External call to ${contractId} landed as ${uniqueId} but did not reach the requested wait level before the request timed out.`,
      "EXTERNAL_CALL_TIMEOUT",
    )
    this.name = "ExternalCallTimeoutError"
    this.contractId = contractId
    this.callHash = callHash
    this.sentAtHeight = sentAtHeight
    if (uniqueId !== undefined) this.uniqueId = uniqueId
    Object.setPrototypeOf(this, ExternalCallTimeoutError.prototype)
  }
}

/**
 * Thrown when a `FunctionCall` action calls `__external_call`, the method
 * reserved for external contract calls (`ActionErrorKind::ReservedMethodName`,
 * nearcore 2.15). Only an external call or a view call can run it.
 */
export class ReservedMethodNameError extends NearError {
  methodName: string
  retryable = false

  constructor(methodName: string, details?: unknown) {
    super(
      `Method ${methodName} is reserved for external contract calls and can't be called by a FunctionCall action`,
      "RESERVED_METHOD_NAME",
      details,
    )
    this.name = "ReservedMethodNameError"
    this.methodName = methodName
    Object.setPrototypeOf(this, ReservedMethodNameError.prototype)
  }
}

/**
 * Thrown when a view query targets a funded but uninitialized universal
 * (`0u`) account (RPC error `UNINITIALIZED_ACCOUNT`, nearcore 2.15). Pass the
 * account's state init to a view call to run it as if it were installed.
 */
export class UninitializedAccountError extends NearError {
  accountId: string

  constructor(accountId: string) {
    super(
      `Account ${accountId} exists but is not initialized`,
      "UNINITIALIZED_ACCOUNT",
    )
    this.name = "UninitializedAccountError"
    this.accountId = accountId
    Object.setPrototypeOf(this, UninitializedAccountError.prototype)
  }
}

/**
 * Thrown when the `state_init` of a view call is invalid for the account
 * (RPC error `INVALID_STATE_INIT`, nearcore 2.15). `details` holds nearcore's
 * `ActionsValidationError`.
 */
export class InvalidStateInitError extends NearError {
  details?: unknown

  constructor(message: string, details?: unknown) {
    super(
      /^invalid state init/i.test(message)
        ? message
        : `Invalid state init: ${message}`,
      "INVALID_STATE_INIT",
      details,
    )
    this.name = "InvalidStateInitError"
    this.details = details
    Object.setPrototypeOf(this, InvalidStateInitError.prototype)
  }
}

/**
 * Thrown when the node does not know a transaction or external call copy with
 * the requested hash or unique id (RPC error `UNKNOWN_TRANSACTION`). It may not
 * have landed yet, or may be on a shard this node does not track.
 */
export class UnknownTransactionError extends NearError {
  transactionHash: string
  retryable = false

  constructor(transactionHash: string) {
    super(`Transaction ${transactionHash} doesn't exist`, "UNKNOWN_TRANSACTION")
    this.name = "UnknownTransactionError"
    this.transactionHash = transactionHash
    Object.setPrototypeOf(this, UnknownTransactionError.prototype)
  }
}

function describeExecutionError(error: unknown): string {
  if (typeof error === "string") return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
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

  constructor(message?: string, transactionHash?: string, data?: unknown) {
    super(
      message ||
        "Request timed out. The transaction may still be processed. Resubmit the identical transaction.",
      "TIMEOUT_ERROR",
      data,
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
