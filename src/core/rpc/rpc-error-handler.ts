/**
 * RPC error handling utilities
 * Parses NEAR RPC errors and throws appropriate typed exceptions
 */

import {
  AccessKeyDoesNotExistError,
  AccountDoesNotExistError,
  ContractExecutionError,
  ContractNotDeployedError,
  ContractStateTooLargeError,
  FunctionCallError,
  InternalServerError,
  InvalidAccountError,
  InvalidNonceError,
  InvalidShardIdError,
  InvalidTransactionError,
  NearError,
  NetworkError,
  NodeNotSyncedError,
  ParseError,
  ShardUnavailableError,
  TimeoutError,
  UnknownBlockError,
  UnknownChunkError,
  UnknownEpochError,
  UnknownReceiptError,
} from "../../errors/index.js"
import type {
  ExecutionOutcomeWithId,
  RpcAction,
  RpcTransaction,
} from "../types.js"
import { RpcErrorResponseSchema } from "./rpc-schemas.js"

// ==================== Failure Type Definitions ====================

/**
 * Function call error structure from FunctionCallError
 */
interface FunctionCallErrorPayload {
  ExecutionError?: string
  HostError?: string
  [key: string]: unknown
}

/**
 * ActionError failure structure
 */
interface ActionErrorFailure {
  ActionError?: {
    kind?: {
      FunctionCallError?: FunctionCallErrorPayload
      [key: string]: unknown
    }
    [key: string]: unknown
  }
  [key: string]: unknown
}

/**
 * FunctionCallError failure structure (direct, not wrapped in ActionError)
 */
interface DirectFunctionCallFailure {
  FunctionCallError?: FunctionCallErrorPayload
  [key: string]: unknown
}

/**
 * Combined failure type
 */
type ExecutionFailure = ActionErrorFailure | DirectFunctionCallFailure

// ==================== RPC Error Response Type ====================

export interface RpcErrorResponse {
  name: string
  code: number
  message: string
  data?: string
  cause?: {
    name: string
    info?: Record<string, unknown>
  }
}

// ==================== Helper Functions ====================

/**
 * Check if a failure object represents a FunctionCallError
 */
function isFunctionCallError(failure: ExecutionFailure): boolean {
  return (
    (failure as ActionErrorFailure).ActionError?.kind?.FunctionCallError !==
      undefined ||
    (failure as DirectFunctionCallFailure).FunctionCallError !== undefined
  )
}

/**
 * Extract panic message from FunctionCallError
 */
function extractPanicMessage(failure: ExecutionFailure): string | undefined {
  const functionCallError =
    (failure as ActionErrorFailure).ActionError?.kind?.FunctionCallError ||
    (failure as DirectFunctionCallFailure).FunctionCallError

  if (!functionCallError) return undefined

  if (typeof functionCallError.ExecutionError === "string") {
    return functionCallError.ExecutionError
  }
  if (typeof functionCallError.HostError === "string") {
    return functionCallError.HostError
  }

  return JSON.stringify(functionCallError)
}

/**
 * Extract method name from transaction actions
 */
function extractMethodName(
  transaction: RpcTransaction | undefined,
): string | undefined {
  if (!transaction) return undefined

  const functionCallAction = transaction.actions.find(
    (action: RpcAction) =>
      typeof action === "object" && "FunctionCall" in action,
  )

  if (
    functionCallAction &&
    typeof functionCallAction === "object" &&
    "FunctionCall" in functionCallAction
  ) {
    return functionCallAction.FunctionCall.method_name
  }

  return undefined
}

/**
 * Extract error message from an ActionError failure object
 */
export function extractErrorMessage(failure: Record<string, unknown>): string {
  // Handle ActionError structure
  if (
    "ActionError" in failure &&
    typeof failure["ActionError"] === "object" &&
    failure["ActionError"] !== null
  ) {
    const actionError = failure["ActionError"] as Record<string, unknown>
    if (
      "kind" in actionError &&
      typeof actionError["kind"] === "object" &&
      actionError["kind"] !== null
    ) {
      const kind = actionError["kind"] as Record<string, unknown>

      // Get the error type (first key in kind object)
      const errorType = Object.keys(kind)[0]
      if (!errorType) {
        return JSON.stringify(failure)
      }

      const errorData = kind[errorType]

      // Format error message with data if available
      if (errorData && typeof errorData === "object" && errorData !== null) {
        const dataObj = errorData as Record<string, unknown>
        const dataStr = Object.entries(dataObj)
          .map(([key, value]) => `${key}: ${value}`)
          .join(", ")
        return `${errorType} (${dataStr})`
      }

      return errorType
    }
  }

  // Fallback to JSON stringified representation
  return JSON.stringify(failure)
}

/**
 * Check outcome for FunctionCallError and throw if found
 */
export function checkOutcomeForFunctionCallError(
  outcome: ExecutionOutcomeWithId,
  transaction: RpcTransaction | undefined,
): void {
  if (
    typeof outcome.outcome.status === "object" &&
    "Failure" in outcome.outcome.status
  ) {
    const failure = outcome.outcome.status.Failure as ExecutionFailure

    if (isFunctionCallError(failure)) {
      const contractId = outcome.outcome.executor_id
      const logs = outcome.outcome.logs
      const methodName = extractMethodName(transaction)
      const panicMessage = extractPanicMessage(failure)

      throw new FunctionCallError(contractId, methodName, panicMessage, logs)
    }
  }
}

/**
 * Determine if an HTTP status code indicates a retryable error
 */
export function isRetryableStatus(statusCode: number): boolean {
  // 408 Request Timeout - retryable
  // 429 Too Many Requests - retryable (rate limiting)
  // 503 Service Unavailable - retryable
  // 5xx Server Errors - retryable
  return (
    statusCode === 408 ||
    statusCode === 429 ||
    statusCode === 503 ||
    (statusCode >= 500 && statusCode < 600)
  )
}

/**
 * Context for parsing query errors
 */
interface QueryErrorContext {
  accountId?: string
  publicKey?: string
  contractId?: string
  methodName?: string
}

/**
 * Parse query result errors (from result.error field)
 * Query methods (view_access_key, call_function) return errors in result.error
 * instead of the top-level error field
 */
export function parseQueryError(
  result: unknown,
  context: QueryErrorContext = {},
): void {
  if (!result || typeof result !== "object" || !("error" in result)) {
    return
  }

  const errorMsg = (result as { error: string }).error

  // Access key not found
  if (errorMsg.includes("does not exist")) {
    const accountId = context.accountId || "unknown"
    const publicKey = context.publicKey || "unknown"
    throw new AccessKeyDoesNotExistError(accountId, publicKey)
  }

  // Function call errors (method not found, execution failures, etc.)
  if (context.contractId) {
    throw new FunctionCallError(
      context.contractId,
      context.methodName,
      errorMsg,
    )
  }

  // Generic query error
  throw new NetworkError(`Query error: ${errorMsg}`)
}

/**
 * Parse RPC error and throw appropriate typed error
 * Follows NEAR RPC error documentation
 */
export function parseRpcError(
  error: RpcErrorResponse | undefined,
  statusCode?: number,
): never {
  if (!error) {
    throw new NetworkError("Unknown RPC error")
  }

  // Try to parse the error using the schema
  try {
    const parsedError = RpcErrorResponseSchema.parse(error)
    const causeName = parsedError.cause?.name
    const causeInfo = parsedError.cause?.info || {}

    // Handle errors based on ERROR_CAUSE (as per documentation)
    // This is more reliable than string matching on error messages

    // === General Errors (HANDLER_ERROR) ===

    if (causeName === "UNKNOWN_BLOCK") {
      const blockRef =
        (causeInfo["block_reference"] as string) || parsedError.message
      throw new UnknownBlockError(blockRef)
    }

    if (causeName === "INVALID_ACCOUNT") {
      const accountId = (causeInfo.requested_account_id as string) || "unknown"
      throw new InvalidAccountError(accountId)
    }

    if (causeName === "UNKNOWN_ACCOUNT") {
      const accountId = (causeInfo.requested_account_id as string) || "unknown"
      throw new AccountDoesNotExistError(accountId)
    }

    if (causeName === "UNAVAILABLE_SHARD") {
      throw new ShardUnavailableError(parsedError.message)
    }

    if (causeName === "NO_SYNCED_BLOCKS" || causeName === "NOT_SYNCED_YET") {
      throw new NodeNotSyncedError(parsedError.message)
    }

    // === Contract Errors ===

    if (causeName === "NO_CONTRACT_CODE") {
      const accountId =
        (causeInfo["account_id"] as string) ||
        (causeInfo["contract_id"] as string) ||
        "unknown"
      throw new ContractNotDeployedError(accountId)
    }

    if (causeName === "TOO_LARGE_CONTRACT_STATE") {
      const accountId =
        (causeInfo["account_id"] as string) ||
        (causeInfo["contract_id"] as string) ||
        "unknown"
      throw new ContractStateTooLargeError(accountId)
    }

    if (causeName === "CONTRACT_EXECUTION_ERROR") {
      const contractId = (causeInfo["contract_id"] as string) || "unknown"
      const methodName = causeInfo.method_name as string | undefined
      throw new ContractExecutionError(contractId, methodName, causeInfo)
    }

    // ActionError is for function call panics during transaction execution
    if (causeName === "ActionError") {
      const contractId = (causeInfo["contract_id"] as string) || "unknown"
      const methodName = (causeInfo.method_name as string) || "unknown"
      const panic = parsedError.message || undefined
      throw new FunctionCallError(contractId, methodName, panic)
    }

    // === Block / Chunk Errors ===

    if (causeName === "UNKNOWN_CHUNK") {
      const chunkRef =
        (causeInfo["chunk_reference"] as string) || parsedError.message
      throw new UnknownChunkError(chunkRef)
    }

    if (causeName === "INVALID_SHARD_ID") {
      const shardId = (causeInfo["shard_id"] as number | string) || "unknown"
      throw new InvalidShardIdError(shardId)
    }

    // === Network Errors ===

    if (causeName === "UNKNOWN_EPOCH") {
      const blockRef =
        (causeInfo["block_reference"] as string) || parsedError.message
      throw new UnknownEpochError(blockRef)
    }

    // === Transaction Errors ===

    if (causeName === "INVALID_TRANSACTION") {
      // Check for InvalidNonce error in data field
      if (parsedError.data && typeof parsedError.data === "object") {
        // Navigate nested error structure: TxExecutionError.InvalidTxError.InvalidNonce
        const txExecError = parsedError.data.TxExecutionError
        const invalidTxError =
          txExecError?.InvalidTxError || parsedError.data.InvalidTxError
        const invalidNonce = invalidTxError?.InvalidNonce

        if (
          invalidNonce &&
          "ak_nonce" in invalidNonce &&
          "tx_nonce" in invalidNonce
        ) {
          throw new InvalidNonceError(
            invalidNonce.tx_nonce as number,
            invalidNonce.ak_nonce as number,
          )
        }
      }

      // Extract detailed error info from data field if available
      let errorDetails = causeInfo
      if (parsedError.data && typeof parsedError.data === "object") {
        const txError =
          parsedError.data.TxExecutionError || parsedError.data.InvalidTxError
        if (txError) {
          errorDetails = { ...causeInfo, ...txError }
        }
      }
      throw new InvalidTransactionError(parsedError.message, errorDetails)
    }

    if (causeName === "UNKNOWN_RECEIPT") {
      const receiptId = (causeInfo["receipt_id"] as string) || "unknown"
      throw new UnknownReceiptError(receiptId)
    }

    if (causeName === "TIMEOUT_ERROR") {
      const txHash = causeInfo["transaction_hash"] as string | undefined
      throw new TimeoutError(parsedError.message, txHash)
    }

    // === Request Validation Errors (400) ===

    if (
      causeName === "PARSE_ERROR" ||
      parsedError.name === "REQUEST_VALIDATION_ERROR"
    ) {
      throw new ParseError(parsedError.message, causeInfo)
    }

    // === Internal Errors (500) ===

    if (
      causeName === "INTERNAL_ERROR" ||
      parsedError.name === "INTERNAL_ERROR"
    ) {
      throw new InternalServerError(parsedError.message, causeInfo)
    }

    // === Fallback for unknown error types ===

    // Determine if error is retryable based on HTTP status code
    const retryable = statusCode ? isRetryableStatus(statusCode) : false

    throw new NetworkError(
      `RPC error [${causeName || parsedError.name}]: ${parsedError.message}`,
      parsedError.code,
      retryable,
    )
  } catch (parseError) {
    // If parsing fails or we already threw a specific error, re-throw it
    if (parseError instanceof NearError) {
      throw parseError
    }

    // Parsing failed, fall back to generic error
    throw new NetworkError(`RPC error: ${error.message}`, error.code, false)
  }
}
