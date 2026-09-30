/**
 * RPC error handling utilities
 * Classifies NEAR RPC failures as typed domain errors
 */

import * as Schema from "effect/Schema"
import * as Result from "effect/Result"
import { RpcErrorResponseSchema } from "../../effect/protocol-schemas.js"
import {
  AccessKeyDoesNotExistError,
  AccountDoesNotExistError,
  ContractExecutionError,
  ContractNotDeployedError,
  ContractStateTooLargeError,
  FunctionCallError,
  GlobalContractNotFoundError,
  InternalServerError,
  InvalidAccountError,
  InvalidNonceError,
  InvalidShardIdError,
  InvalidTransactionError,
  type NearError,
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
  FinalExecutionOutcome,
  RpcAction,
  RpcMinimalTransaction,
  RpcTransaction,
} from "../types.js"

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
  transaction: RpcTransaction | RpcMinimalTransaction | undefined,
): string | undefined {
  // Minimal transactions (early wait levels) carry no actions to inspect.
  if (!transaction || !("actions" in transaction)) return undefined

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
 * Extract error message from an ActionError failure object.
 *
 * @internal
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
          .map(([key, value]) => `${key}: ${displayRpcValue(value)}`)
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
 * Classify a function-call failure with its execution context and logs.
 *
 * @internal
 */
export function checkOutcomeForFunctionCallError(
  outcome: ExecutionOutcomeWithId,
  transaction: RpcTransaction | RpcMinimalTransaction | undefined,
): FunctionCallError | undefined {
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

      return new FunctionCallError(contractId, methodName, panicMessage, logs)
    }
  }
  return undefined
}

/**
 * Parse the `identifier` from a NO_GLOBAL_CONTRACT_CODE error's info payload.
 *
 * nearcore >= 2.12 serializes it as `{"hash": "..."}` / `{"account_id": "..."}`;
 * older nodes used `{"CodeHash": "..."}` / `{"AccountId": "..."}` (renamed in
 * nearcore#15539). The cause name is authoritative, so an unrecognized payload
 * falls back to a placeholder identifier rather than a generic error — callers
 * that know the queried identifier re-key the error with it (see
 * `RpcClient.viewGlobalContractCode`).
 */
function parseGlobalContractIdentifier(
  identifier: unknown,
): { codeHash: string } | { accountId: string } {
  if (identifier && typeof identifier === "object") {
    const obj = identifier as Record<string, unknown>
    const hash = obj["hash"] ?? obj["CodeHash"]
    if (typeof hash === "string") {
      return { codeHash: hash }
    }
    const accountId = obj["account_id"] ?? obj["AccountId"]
    if (typeof accountId === "string") {
      return { accountId }
    }
  }
  return { accountId: "unknown" }
}

/**
 * Determine if an HTTP status code indicates a retryable error.
 *
 * @internal
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
 * Context for parsing query errors.
 */
interface QueryErrorContext {
  accountId?: string
  publicKey?: string
  contractId?: string
  methodName?: string
}

/**
 * Parse query result errors (from `result.error` field).
 *
 * Query methods (e.g. `view_access_key`, `call_function`) return errors in
 * `result.error` instead of the top-level error field.
 *
 * @internal
 */
const QueryErrorSchema = Schema.Struct({ error: Schema.String })

export function parseQueryError(
  result: unknown,
  context: QueryErrorContext = {},
): NearError | Schema.SchemaError | undefined {
  if (!result || typeof result !== "object" || !("error" in result)) {
    return
  }

  const decoded = Schema.decodeUnknownResult(QueryErrorSchema)(result)
  if (Result.isFailure(decoded)) return decoded.failure
  const errorMsg = decoded.success.error

  // Function call errors (method not found, execution failures, etc.)
  // Check this FIRST to avoid misinterpreting "Method X does not exist" as access key error
  if (context.contractId) {
    return new FunctionCallError(
      context.contractId,
      context.methodName,
      errorMsg,
    )
  }

  // Access key not found
  // Only check this for access key queries (when accountId/publicKey are in context)
  if (
    (context.accountId || context.publicKey) &&
    errorMsg.includes("does not exist")
  ) {
    const accountId = context.accountId || "unknown"
    const publicKey = context.publicKey || "unknown"
    return new AccessKeyDoesNotExistError(accountId, publicKey)
  }

  // Generic query error
  return new NetworkError(`Query error: ${errorMsg}`)
}

// Only fields passed to string/number domain constructors need these refinements.
// Other cause details are retained by the wire codec for forward compatibility.
const ErrorContextSchema = Schema.Struct({
  public_key: Schema.optional(Schema.NullOr(Schema.String)),
  account_id: Schema.optional(Schema.NullOr(Schema.String)),
  contract_account_id: Schema.optional(Schema.NullOr(Schema.String)),
  receipt_id: Schema.optional(Schema.NullOr(Schema.String)),
  transaction_hash: Schema.optional(Schema.NullOr(Schema.String)),
  shard_id: Schema.optional(
    Schema.NullOr(Schema.Union([Schema.String, Schema.Finite])),
  ),
})
const InvalidNonceSchema = Schema.Struct({
  tx_nonce: Schema.Finite,
  ak_nonce: Schema.Finite,
})

/**
 * Parse an RPC failure into the appropriate typed error.
 * Follows NEAR RPC error documentation.
 *
 * @internal
 */
export function parseRpcError(error: unknown, statusCode?: number): NearError {
  if (!error) {
    return new NetworkError("Unknown RPC error")
  }

  const decoded = Schema.decodeUnknownResult(RpcErrorResponseSchema)(error)
  if (Result.isFailure(decoded)) {
    // Parsing failed, fall back to generic error
    const message =
      typeof error === "object" && error !== null && "message" in error
        ? displayRpcValue(error.message)
        : "undefined"
    const code =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "number"
        ? error.code
        : undefined
    return new NetworkError(`RPC error: ${message}`, code, false)
  }
  const parsedError = decoded.success
  const causeName = parsedError.cause?.name
  const causeInfo = parsedError.cause?.info || {}
  const malformed = () =>
    new NetworkError(
      `RPC error: ${parsedError.message}`,
      parsedError.code,
      false,
    )
  if (
    Result.isFailure(Schema.decodeUnknownResult(ErrorContextSchema)(causeInfo))
  )
    return malformed()

  // Handle errors based on ERROR_CAUSE (as per documentation)
  // This is more reliable than string matching on error messages

  // === General Errors (HANDLER_ERROR) ===

  if (causeName === "UNKNOWN_BLOCK") {
    const reference = blockReferenceText(
      causeInfo["block_reference"],
      parsedError.data || parsedError.message,
    )
    return Result.isFailure(reference)
      ? malformed()
      : new UnknownBlockError(reference.success)
  }

  if (causeName === "INVALID_ACCOUNT") {
    const accountId = (causeInfo.requested_account_id as string) || "unknown"
    return new InvalidAccountError(accountId)
  }

  if (causeName === "UNKNOWN_ACCOUNT") {
    const accountId = (causeInfo.requested_account_id as string) || "unknown"
    return new AccountDoesNotExistError(accountId)
  }

  // A `view_gas_key_nonces` query for a key that is not a (funded) gas key.
  // nearcore only echoes the public key here, not the account, so callers
  // that know the account re-key this with full context (see getGasKeyNonces).
  if (causeName === "UNKNOWN_GAS_KEY") {
    const publicKey = (causeInfo["public_key"] as string) || "unknown"
    const accountId =
      (causeInfo["account_id"] as string) ||
      (causeInfo.requested_account_id as string) ||
      "unknown"
    return new AccessKeyDoesNotExistError(accountId, publicKey)
  }

  if (causeName === "UNAVAILABLE_SHARD") {
    return new ShardUnavailableError(parsedError.message)
  }

  if (causeName === "NO_SYNCED_BLOCKS" || causeName === "NOT_SYNCED_YET") {
    return new NodeNotSyncedError(parsedError.message)
  }

  // === Contract Errors ===

  if (causeName === "NO_CONTRACT_CODE") {
    const accountId =
      (causeInfo["contract_account_id"] as string) ||
      (causeInfo["account_id"] as string) ||
      (causeInfo["contract_id"] as string) ||
      "unknown"
    return new ContractNotDeployedError(accountId)
  }

  // A view_global_contract_code[_by_account_id] query for an identifier
  // that has no published code in the global contract registry.
  if (causeName === "NO_GLOBAL_CONTRACT_CODE") {
    return new GlobalContractNotFoundError(
      parseGlobalContractIdentifier(causeInfo["identifier"]),
    )
  }

  if (causeName === "TOO_LARGE_CONTRACT_STATE") {
    const accountId =
      (causeInfo["account_id"] as string) ||
      (causeInfo["contract_id"] as string) ||
      "unknown"
    return new ContractStateTooLargeError(accountId)
  }

  if (causeName === "CONTRACT_EXECUTION_ERROR") {
    const contractId = (causeInfo["contract_id"] as string) || "unknown"
    const methodName = causeInfo.method_name as string | undefined
    return new ContractExecutionError(contractId, methodName, causeInfo)
  }

  // ActionError is for function call panics during transaction execution
  if (causeName === "ActionError") {
    const contractId = (causeInfo["contract_id"] as string) || "unknown"
    const methodName = (causeInfo.method_name as string) || "unknown"
    const panic = parsedError.message || undefined
    return new FunctionCallError(contractId, methodName, panic)
  }

  // === Block / Chunk Errors ===

  if (causeName === "UNKNOWN_CHUNK") {
    const hash = causeInfo["chunk_hash"]
    const reference = causeInfo["chunk_reference"]
    const value =
      typeof hash === "string"
        ? hash
        : typeof reference === "string"
          ? reference
          : field(reference, "chunk_id") ||
            parsedError.data ||
            parsedError.message
    const text = rpcText(value)
    return Result.isFailure(text)
      ? malformed()
      : new UnknownChunkError(text.success)
  }

  if (causeName === "INVALID_SHARD_ID") {
    const shardId = (causeInfo["shard_id"] as number | string) || "unknown"
    return new InvalidShardIdError(shardId)
  }

  // === Network Errors ===

  if (causeName === "UNKNOWN_EPOCH") {
    const reference = blockReferenceText(
      causeInfo["block_reference"],
      parsedError.data || parsedError.message,
    )
    return Result.isFailure(reference)
      ? malformed()
      : new UnknownEpochError(reference.success)
  }

  // === Transaction Errors ===

  if (causeName === "INVALID_TRANSACTION") {
    const data: unknown = parsedError.data
    const txExecError = field(data, "TxExecutionError")
    const invalidTxError =
      field(txExecError, "InvalidTxError") || field(data, "InvalidTxError")
    const invalidNonce = field(invalidTxError, "InvalidNonce")
    if (invalidNonce) {
      if (typeof invalidNonce !== "object") return malformed()
      if ("ak_nonce" in invalidNonce && "tx_nonce" in invalidNonce) {
        const nonce =
          Schema.decodeUnknownResult(InvalidNonceSchema)(invalidNonce)
        if (Result.isFailure(nonce)) return malformed()
        return new InvalidNonceError(
          nonce.success.tx_nonce,
          nonce.success.ak_nonce,
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
    return new InvalidTransactionError(parsedError.message, errorDetails)
  }

  if (causeName === "UNKNOWN_RECEIPT") {
    const receiptId = (causeInfo["receipt_id"] as string) || "unknown"
    return new UnknownReceiptError(receiptId)
  }

  if (causeName === "TIMEOUT_ERROR") {
    const txHash = causeInfo["transaction_hash"] as string | undefined
    return new TimeoutError(parsedError.message, txHash)
  }

  // === Request Validation Errors (400) ===

  if (
    causeName === "PARSE_ERROR" ||
    parsedError.name === "REQUEST_VALIDATION_ERROR"
  ) {
    return new ParseError(parsedError.message, causeInfo)
  }

  // === Internal Errors (500) ===

  if (causeName === "INTERNAL_ERROR" || parsedError.name === "INTERNAL_ERROR") {
    return new InternalServerError(parsedError.message, causeInfo)
  }

  // === Fallback for unknown error types ===

  // Determine if error is retryable based on HTTP status code
  const retryable = statusCode ? isRetryableStatus(statusCode) : false

  return new NetworkError(
    `RPC error [${causeName || parsedError.name}]: ${parsedError.message}`,
    parsedError.code,
    retryable,
  )
}

/** Preserve the historical public error-message coercion, including nested objects. */
function displayRpcValue(value: unknown): string {
  const text = rpcText(value)
  return Result.isSuccess(text) ? text.success : JSON.stringify(value)
}

/** String coercion is its own untrusted-input boundary, not a catch around classification. */
const rpcText = (value: unknown) => Result.try(() => String(value))

function field(value: unknown, key: string): unknown {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)[key]
    : undefined
}

/** Classify transaction/receipt execution failures without throwing through the runtime. */
export function parseExecutionError(
  parsed: FinalExecutionOutcome,
): NearError | undefined {
  if (
    !parsed.status ||
    typeof parsed.status !== "object" ||
    !("Failure" in parsed.status)
  ) {
    return undefined
  }
  if (parsed.transaction_outcome) {
    const error = checkOutcomeForFunctionCallError(
      parsed.transaction_outcome,
      parsed.transaction,
    )
    if (error) return error
  }
  const failedReceipt = parsed.receipts_outcome?.find(
    (receipt) =>
      typeof receipt.outcome.status === "object" &&
      "Failure" in receipt.outcome.status,
  )
  if (failedReceipt) {
    const error = checkOutcomeForFunctionCallError(
      failedReceipt,
      parsed.transaction,
    )
    if (error) return error
  }
  let failureDetails = parsed.status.Failure
  let errorMessage = "Transaction execution failed"
  const failureStatus = [parsed.transaction_outcome, failedReceipt].find(
    (outcome) =>
      outcome &&
      typeof outcome.outcome.status === "object" &&
      "Failure" in outcome.outcome.status,
  )?.outcome.status
  if (
    failureStatus &&
    typeof failureStatus === "object" &&
    "Failure" in failureStatus
  ) {
    failureDetails = failureStatus.Failure
    errorMessage = extractErrorMessage(failureDetails)
  }
  return new InvalidTransactionError(errorMessage, failureDetails)
}

function blockReferenceText(reference: unknown, fallback: unknown) {
  const value =
    typeof reference === "string"
      ? reference
      : field(reference, "block_id") || field(reference, "BlockId") || fallback
  return rpcText(value)
}
