/**
 * RPC client for NEAR Protocol
 */

import { base64 } from "@scure/base"
import {
  AccessKeyDoesNotExistError,
  AccountDoesNotExistError,
  ContractExecutionError,
  ContractNotDeployedError,
  ContractStateTooLargeError,
  FunctionCallError,
  InternalServerError,
  InvalidAccountError,
  InvalidShardIdError,
  InvalidTransactionError,
  NearError,
  NetworkError,
  NodeNotSyncedError,
  ParseError,
  ShardUnavailableError,
  TimeoutError,
  UnknownAccessKeyError,
  UnknownBlockError,
  UnknownChunkError,
  UnknownEpochError,
  UnknownReceiptError,
} from "../../errors/index.js"
import type {
  AccessKeyView,
  AccountView,
  FinalExecutionOutcome,
  GasPriceResponse,
  StatusResponse,
  TxExecutionStatus,
  ViewFunctionCallResult,
} from "../types.js"
import {
  AccessKeyViewSchema,
  AccountViewSchema,
  FinalExecutionOutcomeSchema,
  GasPriceResponseSchema,
  RpcErrorResponseSchema,
  StatusResponseSchema,
  ViewFunctionCallResultSchema,
} from "./rpc-schemas.js"

export interface RpcRequest {
  jsonrpc: "2.0"
  id: string | number
  method: string
  params: unknown
}

export interface RpcResponse<T = unknown> {
  jsonrpc: "2.0"
  id: string | number
  result?: T
  error?: {
    name: string // ERROR_TYPE
    code: number // Legacy field
    message: string
    data?: string
    cause?: {
      name: string // ERROR_CAUSE
      info?: Record<string, unknown>
    }
  }
}

export class RpcClient {
  private readonly url: string
  private readonly headers: Record<string, string>
  private requestId: number

  constructor(url: string, headers?: Record<string, string>) {
    this.url = url
    this.headers = headers || {}
    this.requestId = 0
  }

  /**
   * Parse RPC error and throw appropriate typed error
   * Follows NEAR RPC error documentation
   */
  private parseRpcError(
    error: RpcResponse["error"],
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
        const accountId =
          (causeInfo.requested_account_id as string) || "unknown"
        throw new InvalidAccountError(accountId)
      }

      if (causeName === "UNKNOWN_ACCOUNT") {
        const accountId =
          (causeInfo.requested_account_id as string) || "unknown"
        throw new AccountDoesNotExistError(accountId)
      }

      if (causeName === "UNAVAILABLE_SHARD") {
        throw new ShardUnavailableError(parsedError.message)
      }

      if (causeName === "NO_SYNCED_BLOCKS" || causeName === "NOT_SYNCED_YET") {
        throw new NodeNotSyncedError(parsedError.message)
      }

      // === Access Key Errors ===

      if (causeName === "UNKNOWN_ACCESS_KEY") {
        const accountId = (causeInfo["account_id"] as string) || "unknown"
        const publicKey = (causeInfo["public_key"] as string) || "unknown"
        throw new UnknownAccessKeyError(accountId, publicKey)
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
          (causeInfo.contract_id as string) ||
          "unknown"
        throw new ContractStateTooLargeError(accountId)
      }

      if (causeName === "CONTRACT_EXECUTION_ERROR") {
        const contractId = (causeInfo.contract_id as string) || "unknown"
        const methodName = causeInfo.method_name as string | undefined
        throw new ContractExecutionError(contractId, methodName, causeInfo)
      }

      // ActionError is for function call panics during transaction execution
      if (causeName === "ActionError") {
        const contractId = (causeInfo.contract_id as string) || "unknown"
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
        // Check for retryable transaction errors in cause.info
        throw new InvalidTransactionError(parsedError.message, causeInfo)
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
      const retryable = statusCode ? this.isRetryableStatus(statusCode) : false

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

  /**
   * Determine if an HTTP status code indicates a retryable error
   */
  private isRetryableStatus(statusCode: number): boolean {
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

  async call<T = unknown>(method: string, params: unknown): Promise<T> {
    const request: RpcRequest = {
      jsonrpc: "2.0",
      id: ++this.requestId,
      method,
      params,
    }

    try {
      const response = await fetch(this.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.headers,
        },
        body: JSON.stringify(request),
      })

      if (!response.ok) {
        // Use isRetryableStatus to determine if this HTTP error is retryable
        throw new NetworkError(
          `HTTP ${response.status}: ${response.statusText}`,
          response.status,
          this.isRetryableStatus(response.status),
        )
      }

      const data: RpcResponse<T> = await response.json()

      if (data.error) {
        // Pass status code to parseRpcError for better retryable detection
        this.parseRpcError(data.error, response.status)
      }

      if (data.result === undefined) {
        throw new NetworkError("RPC response missing result field")
      }

      return data.result
    } catch (error) {
      // Re-throw all NearError instances (includes all our custom error types)
      if (error instanceof NearError) {
        throw error
      }

      // Network failure (fetch threw an error)
      throw new NetworkError(
        `Network request failed: ${(error as Error).message}`,
        undefined,
        true, // Network failures are always retryable
      )
    }
  }

  async query<T = unknown>(
    path: string,
    data: string | Uint8Array,
  ): Promise<T> {
    return this.call("query", {
      request_type: path,
      finality: "final",
      args_base64: typeof data === "string" ? data : base64.encode(data),
    })
  }

  async viewFunction(
    contractId: string,
    methodName: string,
    args: unknown = {},
  ): Promise<ViewFunctionCallResult> {
    const argsBase64 = base64.encode(
      new TextEncoder().encode(JSON.stringify(args)),
    )

    const result = await this.call("query", {
      request_type: "call_function",
      finality: "final",
      account_id: contractId,
      method_name: methodName,
      args_base64: argsBase64,
    })

    // Check for errors in result (NEAR returns view function errors this way)
    if (result && typeof result === "object" && "error" in result) {
      const errorMsg = (result as { error: string }).error
      throw new FunctionCallError(contractId, methodName, errorMsg)
    }

    return ViewFunctionCallResultSchema.parse(result)
  }

  async getAccount(accountId: string): Promise<AccountView> {
    const result = await this.call("query", {
      request_type: "view_account",
      finality: "optimistic", // Use optimistic for latest state (important for sandbox/localnet)
      account_id: accountId,
    })

    return AccountViewSchema.parse(result)
  }

  async getAccessKey(
    accountId: string,
    publicKey: string,
  ): Promise<AccessKeyView> {
    const result = await this.call("query", {
      request_type: "view_access_key",
      finality: "optimistic", // Use optimistic for latest state (important for sandbox/localnet)
      account_id: accountId,
      public_key: publicKey,
    })

    // Check for errors in result (NEAR returns access key errors this way)
    if (result && typeof result === "object" && "error" in result) {
      const errorMsg = (result as { error: string }).error
      // Check if it's an access key not found error
      if (errorMsg.includes("does not exist")) {
        throw new AccessKeyDoesNotExistError(accountId, publicKey)
      }
      throw new NetworkError(`Query error: ${errorMsg}`)
    }

    return AccessKeyViewSchema.parse(result)
  }

  async sendTransaction(
    signedTransaction: Uint8Array,
    waitUntil: TxExecutionStatus = "EXECUTED_OPTIMISTIC",
  ): Promise<FinalExecutionOutcome> {
    const base64Encoded = base64.encode(signedTransaction)
    // Use send_tx with wait_until parameter instead of deprecated broadcast_tx_commit
    const result = await this.call("send_tx", {
      signed_tx_base64: base64Encoded,
      wait_until: waitUntil,
    })

    const parsed = FinalExecutionOutcomeSchema.parse(result)

    // Check if transaction execution failed and throw appropriate error
    // Status can be "Unknown", "Pending", or an object with SuccessValue/SuccessReceiptId/Failure
    if (typeof parsed.status === "object" && "Failure" in parsed.status) {
      const failure = parsed.status.Failure
      const errorMessage = failure.error_message || failure.error_type || "Transaction execution failed"

      // Helper function to check if a failure is a FunctionCallError
      const isFunctionCallError = (failureObj: any): boolean => {
        return (
          failureObj.ActionError?.kind?.FunctionCallError !== undefined ||
          failureObj.FunctionCallError !== undefined
        )
      }

      // Helper function to extract panic message from FunctionCallError
      const extractPanicMessage = (failureObj: any): string | undefined => {
        const functionCallError =
          failureObj.ActionError?.kind?.FunctionCallError ||
          failureObj.FunctionCallError

        if (!functionCallError) return undefined

        // Extract from ExecutionError or HostError
        if (typeof functionCallError.ExecutionError === 'string') {
          return functionCallError.ExecutionError
        }
        if (typeof functionCallError.HostError === 'string') {
          return functionCallError.HostError
        }

        // Fallback to stringified error
        return JSON.stringify(functionCallError)
      }

      // Check transaction_outcome first (direct contract failures without cross-contract calls)
      if (
        typeof parsed.transaction_outcome.outcome.status === "object" &&
        "Failure" in parsed.transaction_outcome.outcome.status
      ) {
        const outcomeFailure = parsed.transaction_outcome.outcome.status.Failure

        // Only throw FunctionCallError if the failure is actually from a function call
        if (isFunctionCallError(outcomeFailure)) {
          const contractId = parsed.transaction_outcome.outcome.executor_id
          const logs = parsed.transaction_outcome.outcome.logs
          // Try to extract method name from transaction actions
          const functionCallAction = parsed.transaction.actions.find(
            action => typeof action === "object" && "FunctionCall" in action
          )
          const methodName = functionCallAction && typeof functionCallAction === "object" && "FunctionCall" in functionCallAction
            ? functionCallAction.FunctionCall.method_name
            : undefined

          // Extract actual panic message from nested FunctionCallError
          const panicMessage = extractPanicMessage(outcomeFailure)

          throw new FunctionCallError(contractId, methodName, panicMessage, logs)
        }
      }

      // Check receipts_outcome for cross-contract call failures
      const failedReceipt = parsed.receipts_outcome.find(
        receipt => typeof receipt.outcome.status === "object" && "Failure" in receipt.outcome.status
      )

      if (failedReceipt && typeof failedReceipt.outcome.status === "object" && "Failure" in failedReceipt.outcome.status) {
        const receiptFailure = failedReceipt.outcome.status.Failure

        // Only throw FunctionCallError if the failure is actually from a function call
        if (isFunctionCallError(receiptFailure)) {
          const contractId = failedReceipt.outcome.executor_id
          const logs = failedReceipt.outcome.logs
          // Try to extract method name from transaction actions
          const functionCallAction = parsed.transaction.actions.find(
            action => typeof action === "object" && "FunctionCall" in action
          )
          const methodName = functionCallAction && typeof functionCallAction === "object" && "FunctionCall" in functionCallAction
            ? functionCallAction.FunctionCall.method_name
            : undefined

          // Extract actual panic message from nested FunctionCallError
          const panicMessage = extractPanicMessage(receiptFailure)

          throw new FunctionCallError(contractId, methodName, panicMessage, logs)
        }
      }

      // Generic transaction failure (ActionError from other actions, or other failure types)
      throw new InvalidTransactionError(errorMessage, failure)
    }

    return parsed
  }

  async getStatus(): Promise<StatusResponse> {
    const result = await this.call("status", [])
    return StatusResponseSchema.parse(result)
  }

  async getGasPrice(blockId: string | null = null): Promise<GasPriceResponse> {
    const result = await this.call("gas_price", [blockId])
    return GasPriceResponseSchema.parse(result)
  }
}
