/**
 * RPC client for NEAR Protocol
 */

import { base64 } from "@scure/base"
import {
  AccessKeyDoesNotExistError,
  FunctionCallError,
  InvalidTransactionError,
  NearError,
  NetworkError,
} from "../../errors/index.js"
import type {
  AccessKeyView,
  AccountView,
  ExecutionOutcomeWithId,
  FinalExecutionOutcome,
  FinalExecutionOutcomeMap,
  GasPriceResponse,
  StatusResponse,
  ViewFunctionCallResult,
} from "../types.js"
import {
  checkOutcomeForFunctionCallError,
  extractErrorMessage,
  isRetryableStatus,
  parseRpcError,
} from "./rpc-error-handler.js"
import {
  AccessKeyViewSchema,
  AccountViewSchema,
  FinalExecutionOutcomeSchema,
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

export class RpcClient {
  private readonly url: string
  private readonly headers: Record<string, string>
  private requestId: number

  constructor(url: string, headers?: Record<string, string>) {
    this.url = url
    this.headers = headers || {}
    this.requestId = 0
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
          isRetryableStatus(response.status),
        )
      }

      const data: RpcResponse<T> = await response.json()

      if (data.error) {
        // Pass status code to parseRpcError for better retryable detection
        parseRpcError(data.error, response.status)
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

  async getStatus(): Promise<StatusResponse> {
    const result = await this.call("status", [])
    return StatusResponseSchema.parse(result)
  }

  async getGasPrice(blockId: string | null = null): Promise<GasPriceResponse> {
    const result = await this.call("gas_price", [blockId])
    return GasPriceResponseSchema.parse(result)
  }
}
