/**
 * RPC client for NEAR Protocol
 */

import { base64 } from "@scure/base"
import {
  AccessKeyDoesNotExistError,
  AccountDoesNotExistError,
  FunctionCallError,
  NetworkError,
} from "../../errors/index.js"
import type {
  AccessKeyView,
  AccountView,
  GasPriceResponse,
  StatusResponse,
  ViewFunctionCallResult,
} from "../types.js"
import {
  AccessKeyViewSchema,
  AccountViewSchema,
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
    code: number
    message: string
    data?: unknown
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
   */
  private parseRpcError(error: RpcResponse["error"]): never {
    if (!error) {
      throw new NetworkError("Unknown RPC error")
    }

    // Try to parse the error using the schema
    try {
      const parsedError = RpcErrorResponseSchema.parse(error)

      // Check for specific error types based on error name/message
      const errorName = parsedError.name.toLowerCase()
      const errorMessage = parsedError.message.toLowerCase()
      const errorData = parsedError.data?.toLowerCase() || ""

      // Account does not exist
      if (
        errorName.includes("accountdoesnotexist") ||
        errorMessage.includes("does not exist") ||
        errorData.includes("does not exist")
      ) {
        // Try to extract account ID from error message
        const accountIdMatch =
          parsedError.message.match(/account ([^\s]+) does not exist/i) ||
          parsedError.data?.match(/account ([^\s]+) does not exist/i)
        const accountId = accountIdMatch?.[1] || "unknown"
        throw new AccountDoesNotExistError(accountId)
      }

      // Access key does not exist
      if (
        errorName.includes("accesskeydoesnotexist") ||
        errorMessage.includes("access key") ||
        errorData.includes("access key")
      ) {
        // Try to extract account ID and public key from error message
        const match =
          parsedError.message.match(
            /access key ([^\s]+) does not exist.*account ([^\s]+)/i,
          ) ||
          parsedError.data?.match(
            /access key ([^\s]+) does not exist.*account ([^\s]+)/i,
          )
        const publicKey = match?.[1] || "unknown"
        const accountId = match?.[2] || "unknown"
        throw new AccessKeyDoesNotExistError(accountId, publicKey)
      }

      // Function call error (panic)
      if (parsedError.cause?.name === "ActionError") {
        const contractId =
          (parsedError.cause?.info?.contract_id as string) || "unknown"
        const methodName =
          (parsedError.cause?.info?.method_name as string) || "unknown"
        const panic = parsedError.message || undefined
        throw new FunctionCallError(contractId, methodName, panic)
      }

      // Generic RPC error - fall back to NetworkError
      throw new NetworkError(
        `RPC error: ${parsedError.message}`,
        parsedError.code,
        false,
      )
    } catch (parseError) {
      // If parsing fails, fall back to generic error
      if (
        parseError instanceof AccountDoesNotExistError ||
        parseError instanceof AccessKeyDoesNotExistError ||
        parseError instanceof FunctionCallError
      ) {
        throw parseError
      }

      throw new NetworkError(`RPC error: ${error.message}`, error.code, false)
    }
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
        throw new NetworkError(
          `HTTP ${response.status}: ${response.statusText}`,
          response.status,
          response.status >= 500,
        )
      }

      const data: RpcResponse<T> = await response.json()

      if (data.error) {
        this.parseRpcError(data.error)
      }

      if (data.result === undefined) {
        throw new NetworkError("RPC response missing result field")
      }

      return data.result
    } catch (error) {
      if (
        error instanceof NetworkError ||
        error instanceof AccountDoesNotExistError ||
        error instanceof AccessKeyDoesNotExistError ||
        error instanceof FunctionCallError
      ) {
        throw error
      }

      // Network failure
      throw new NetworkError(
        `Network request failed: ${(error as Error).message}`,
        undefined,
        true,
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

    return ViewFunctionCallResultSchema.parse(result)
  }

  async getAccount(accountId: string): Promise<AccountView> {
    const result = await this.call("query", {
      request_type: "view_account",
      finality: "final",
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
      finality: "final",
      account_id: accountId,
      public_key: publicKey,
    })

    return AccessKeyViewSchema.parse(result)
  }

  async sendTransaction(signedTransaction: Uint8Array): Promise<unknown> {
    const base64Encoded = base64.encode(signedTransaction)
    return this.call("broadcast_tx_commit", [base64Encoded])
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
