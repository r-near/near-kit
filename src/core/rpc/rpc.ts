import { base64 } from "@scure/base"
import {
  InvalidTransactionError,
  NearError,
  NetworkError,
} from "../../errors/index.js"
import type { BlockReference, RpcRetryConfigInput } from "../config-schemas.js"
import type {
  AccessKeyView,
  AccountView,
  ExecutionOutcomeWithId,
  FinalExecutionOutcome,
  FinalExecutionOutcomeMap,
  FinalExecutionOutcomeWithReceipts,
  FinalExecutionOutcomeWithReceiptsMap,
  GasPriceResponse,
  StatusResponse,
  ViewFunctionCallResult,
} from "../types.js"
import {
  checkOutcomeForFunctionCallError,
  extractErrorMessage,
  isRetryableStatus,
  parseQueryError,
  parseRpcError,
} from "./rpc-error-handler.js"
import {
  AccessKeyViewSchema,
  AccountViewSchema,
  FinalExecutionOutcomeSchema,
  FinalExecutionOutcomeWithReceiptsSchema,
  GasPriceResponseSchema,
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

export interface RpcRetryConfig {
  maxRetries: number
  initialDelayMs: number
}

const DEFAULT_RETRY_CONFIG: RpcRetryConfig = {
  maxRetries: 4,
  initialDelayMs: 1000, // 1 second
}

/**
 * Low-level JSON-RPC client for NEAR Protocol.
 *
 * @remarks
 * Most applications should use {@link Near} instead of interacting with this
 * class directly. `RpcClient` is exposed for advanced use cases that need full
 * control over RPC calls or access to methods not wrapped by `Near`.
 */
export class RpcClient {
  private readonly url: string
  private readonly headers: Record<string, string>
  private requestId: number
  private readonly retryConfig: RpcRetryConfig

  constructor(
    url: string,
    headers?: Record<string, string>,
    retryConfig?: RpcRetryConfigInput,
  ) {
    this.url = url
    this.headers = headers || {}
    this.requestId = 0
    this.retryConfig = {
      maxRetries: retryConfig?.maxRetries ?? DEFAULT_RETRY_CONFIG.maxRetries,
      initialDelayMs:
        retryConfig?.initialDelayMs ?? DEFAULT_RETRY_CONFIG.initialDelayMs,
    }
  }

  /**
   * Sleep for the specified number of milliseconds.
   * @internal
   */
  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * Perform a raw JSON-RPC call with automatic retries and error mapping.
   *
   * @param method - RPC method name (e.g. `"query"`, `"status"`).
   * @param params - RPC params object or array.
   *
   * @returns Parsed JSON result typed as `T`.
   *
   * @throws {NetworkError} On HTTP failures, network issues, or malformed responses.
   * @throws {InvalidTransactionError} For transaction failures detected by {@link parseRpcError}.
   * @throws {NearError} For other RPC-level errors.
   */
  async call<T = unknown>(method: string, params: unknown): Promise<T> {
    const request: RpcRequest = {
      jsonrpc: "2.0",
      id: ++this.requestId,
      method,
      params,
    }

    let lastError: NearError | null = null

    // Retry loop with exponential backoff
    // Total attempts = 1 (initial) + maxRetries
    const totalAttempts = 1 + this.retryConfig.maxRetries
    for (let attempt = 0; attempt < totalAttempts; attempt++) {
      try {
        // Debug logging for RPC requests
        if (
          typeof process !== "undefined" &&
          process.env["NEAR_RPC_DEBUG"] === "true"
        ) {
          console.log("[RPC Request]", JSON.stringify(request, null, 2))
        }

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
            isRetryableStatus(response.status),
          )
        }

        const data: RpcResponse<T> = await response.json()

        // Debug logging for RPC responses
        if (
          typeof process !== "undefined" &&
          process.env["NEAR_RPC_DEBUG"] === "true"
        ) {
          console.log("[RPC Response]", JSON.stringify(data, null, 2))
        }

        if (data.error) {
          // Pass status code to parseRpcError for better retryable detection
          parseRpcError(data.error, response.status)
        }

        if (data.result === undefined) {
          throw new NetworkError("RPC response missing result field")
        }

        return data.result
      } catch (error) {
        // Re-throw non-NearError instances as NetworkError
        let nearError: NearError
        if (!(error instanceof NearError)) {
          // Network failure (fetch threw an error)
          nearError = new NetworkError(
            `Network request failed: ${(error as Error).message}`,
            undefined,
            true, // Network failures are always retryable
          )
        } else {
          nearError = error
        }

        lastError = nearError

        // Check if we should retry
        const isRetryable = "retryable" in lastError && lastError.retryable
        const hasRetriesLeft = attempt + 1 < totalAttempts

        if (!isRetryable || !hasRetriesLeft) {
          // Not retryable or out of retries - throw the error
          throw lastError
        }

        // Calculate exponential backoff delay: initialDelay * 2^attempt
        const delayMs = this.retryConfig.initialDelayMs * 2 ** attempt

        // Wait before retrying
        await this.sleep(delayMs)
      }
    }

    if (lastError) {
      throw lastError
    }
    throw new NetworkError("Unknown error during RPC call")
  }

  /**
   * Perform a generic `query` RPC call.
   *
   * @param path - `request_type` (e.g. `"view_account"`, `"view_access_key"`).
   * @param data - Raw args as base64 string or bytes.
   */
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

  /**
   * Call a contract view function via RPC.
   *
   * @param contractId - Account ID of the target contract.
   * @param methodName - Name of the view method.
   * @param args - Arguments object or raw bytes; defaults to `{}`.
   * @param options - Optional {@link BlockReference} to control finality or block.
   */
  async viewFunction(
    contractId: string,
    methodName: string,
    args: unknown = {},
    options?: BlockReference,
  ): Promise<ViewFunctionCallResult> {
    const argsBytes =
      args instanceof Uint8Array
        ? args
        : new TextEncoder().encode(JSON.stringify(args))
    const argsBase64 = base64.encode(argsBytes)

    const result = await this.call("query", {
      request_type: "call_function",
      ...(options?.blockId
        ? { block_id: options.blockId }
        : { finality: options?.finality || "final" }),
      account_id: contractId,
      method_name: methodName,
      args_base64: argsBase64,
    })

    // Check for errors in result (NEAR returns view function errors this way)
    parseQueryError(result, { contractId, methodName })

    return ViewFunctionCallResultSchema.parse(result)
  }

  /**
   * Get basic account information via `view_account`.
   *
   * @param accountId - Account ID to query.
   * @param options - Optional {@link BlockReference} to control finality or block.
   */
  async getAccount(
    accountId: string,
    options?: BlockReference,
  ): Promise<AccountView> {
    const result = await this.call("query", {
      request_type: "view_account",
      ...(options?.blockId
        ? { block_id: options.blockId }
        : { finality: options?.finality || "optimistic" }),
      account_id: accountId,
    })

    return AccountViewSchema.parse(result)
  }

  /**
   * Get an access key via `view_access_key`.
   *
   * @param accountId - Account ID that owns the key.
   * @param publicKey - Public key string (e.g. `"ed25519:..."`).
   * @param options - Optional {@link BlockReference} to control finality or block.
   */
  async getAccessKey(
    accountId: string,
    publicKey: string,
    options?: BlockReference,
  ): Promise<AccessKeyView> {
    const result = await this.call("query", {
      request_type: "view_access_key",
      ...(options?.blockId
        ? { block_id: options.blockId }
        : { finality: options?.finality || "optimistic" }),
      account_id: accountId,
      public_key: publicKey,
    })

    // Check for errors in result (NEAR returns access key errors this way)
    parseQueryError(result, { accountId, publicKey })

    return AccessKeyViewSchema.parse(result)
  }

  /**
   * Send a signed transaction via `send_tx`.
   *
   * @param signedTransaction - Borsh-serialized signed transaction bytes.
   * @param waitUntil - Execution status level to wait for (see {@link TxExecutionStatus}).
   */
  async sendTransaction<
    W extends keyof FinalExecutionOutcomeMap = "EXECUTED_OPTIMISTIC",
  >(
    signedTransaction: Uint8Array,
    waitUntil?: W,
  ): Promise<FinalExecutionOutcomeMap[W]> {
    const actualWaitUntil = (waitUntil ?? "EXECUTED_OPTIMISTIC") as W
    const base64Encoded = base64.encode(signedTransaction)

    // Use send_tx with wait_until parameter instead of deprecated broadcast_tx_commit
    const result = await this.call("send_tx", {
      signed_tx_base64: base64Encoded,
      wait_until: actualWaitUntil,
    })

    const parsed: FinalExecutionOutcome =
      FinalExecutionOutcomeSchema.parse(result)

    // Check for execution failures (only in modes that return execution status)
    // NONE, INCLUDED, and INCLUDED_FINAL don't have status/transaction/outcome fields
    if (
      parsed.final_execution_status !== "NONE" &&
      parsed.final_execution_status !== "INCLUDED" &&
      parsed.final_execution_status !== "INCLUDED_FINAL"
    ) {
      // TypeScript now knows parsed has status, transaction, transaction_outcome, receipts_outcome
      if (
        parsed.status &&
        typeof parsed.status === "object" &&
        "Failure" in parsed.status
      ) {
        // Check transaction_outcome for direct failures
        if (parsed.transaction_outcome) {
          checkOutcomeForFunctionCallError(
            parsed.transaction_outcome,
            parsed.transaction,
          )
        }

        // Check receipts_outcome for cross-contract failures
        const failedReceipt = parsed.receipts_outcome?.find(
          (receipt: ExecutionOutcomeWithId) =>
            typeof receipt.outcome.status === "object" &&
            "Failure" in receipt.outcome.status,
        )

        if (failedReceipt) {
          checkOutcomeForFunctionCallError(failedReceipt, parsed.transaction)
        }

        // Generic transaction failure (non-function-call errors)
        // Extract error message from the actual failure in transaction_outcome or receipts
        let errorMessage = "Transaction execution failed"
        let failureDetails = parsed.status.Failure

        if (
          parsed.transaction_outcome &&
          typeof parsed.transaction_outcome.outcome.status === "object" &&
          "Failure" in parsed.transaction_outcome.outcome.status
        ) {
          failureDetails = parsed.transaction_outcome.outcome.status.Failure
          errorMessage = extractErrorMessage(
            failureDetails as Record<string, unknown>,
          )
        } else if (
          failedReceipt &&
          typeof failedReceipt.outcome.status === "object" &&
          "Failure" in failedReceipt.outcome.status
        ) {
          failureDetails = failedReceipt.outcome.status.Failure
          errorMessage = extractErrorMessage(
            failureDetails as Record<string, unknown>,
          )
        }

        throw new InvalidTransactionError(errorMessage, failureDetails)
      }
    }

    // Safe cast: TypeScript guarantees W is a valid key, Zod validates the structure,
    // and waitUntil determines which variant we get from the RPC
    return parsed as FinalExecutionOutcomeMap[W]
  }

  /**
   * Query transaction status with receipts via `EXPERIMENTAL_tx_status`.
   *
   * @param txHash - Transaction hash.
   * @param senderAccountId - Account ID that sent the transaction.
   * @param waitUntil - Execution status level to wait for.
   */
  async getTransactionStatus<
    W extends
      keyof FinalExecutionOutcomeWithReceiptsMap = "EXECUTED_OPTIMISTIC",
  >(
    txHash: string,
    senderAccountId: string,
    waitUntil?: W,
  ): Promise<FinalExecutionOutcomeWithReceiptsMap[W]> {
    const actualWaitUntil = (waitUntil ?? "EXECUTED_OPTIMISTIC") as W

    // Call EXPERIMENTAL_tx_status with wait_until parameter
    const result = await this.call("EXPERIMENTAL_tx_status", {
      tx_hash: txHash,
      sender_account_id: senderAccountId,
      wait_until: actualWaitUntil,
    })

    const parsed: FinalExecutionOutcomeWithReceipts =
      FinalExecutionOutcomeWithReceiptsSchema.parse(result)

    // Check for execution failures (only in modes that return execution status)
    // NONE, INCLUDED, and INCLUDED_FINAL don't have status/transaction/outcome fields
    if (
      parsed.final_execution_status !== "NONE" &&
      parsed.final_execution_status !== "INCLUDED" &&
      parsed.final_execution_status !== "INCLUDED_FINAL"
    ) {
      // TypeScript now knows parsed has status, transaction, transaction_outcome, receipts_outcome
      if (
        parsed.status &&
        typeof parsed.status === "object" &&
        "Failure" in parsed.status
      ) {
        // Check transaction_outcome for direct failures
        if (parsed.transaction_outcome) {
          checkOutcomeForFunctionCallError(
            parsed.transaction_outcome,
            parsed.transaction,
          )
        }

        // Check receipts_outcome for cross-contract failures
        const failedReceipt = parsed.receipts_outcome?.find(
          (receipt) =>
            typeof receipt.outcome.status === "object" &&
            "Failure" in receipt.outcome.status,
        )

        if (failedReceipt) {
          checkOutcomeForFunctionCallError(failedReceipt, parsed.transaction)
        }

        // Generic transaction failure (non-function-call errors)
        // Extract error message from the actual failure in transaction_outcome or receipts
        let errorMessage = "Transaction execution failed"
        let failureDetails = parsed.status.Failure

        if (
          parsed.transaction_outcome &&
          typeof parsed.transaction_outcome.outcome.status === "object" &&
          "Failure" in parsed.transaction_outcome.outcome.status
        ) {
          failureDetails = parsed.transaction_outcome.outcome.status.Failure
          errorMessage = extractErrorMessage(
            failureDetails as Record<string, unknown>,
          )
        } else if (
          failedReceipt &&
          typeof failedReceipt.outcome.status === "object" &&
          "Failure" in failedReceipt.outcome.status
        ) {
          failureDetails = failedReceipt.outcome.status.Failure
          errorMessage = extractErrorMessage(
            failureDetails as Record<string, unknown>,
          )
        }

        throw new InvalidTransactionError(errorMessage, failureDetails)
      }
    }

    // Safe cast: TypeScript guarantees W is a valid key, Zod validates the structure,
    // and waitUntil determines which variant we get from the RPC
    return parsed as FinalExecutionOutcomeWithReceiptsMap[W]
  }

  /**
   * Get node status via `status`.
   */
  async getStatus(): Promise<StatusResponse> {
    const result = await this.call("status", [])
    return StatusResponseSchema.parse(result)
  }

  /**
   * Get gas price via `gas_price`.
   *
   * @param blockId - Optional block hash or height; `null` for latest.
   */
  async getGasPrice(blockId: string | null = null): Promise<GasPriceResponse> {
    const result = await this.call("gas_price", [blockId])
    return GasPriceResponseSchema.parse(result)
  }
}
