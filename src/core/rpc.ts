/**
 * RPC client for NEAR Protocol
 */

import { base64 } from "@scure/base"
import { NetworkError } from "../errors/index.js"
import type {
  ViewFunctionCallResult,
  AccountView,
  AccessKeyView,
  StatusResponse,
  GasPriceResponse,
} from "./types.js"

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
          response.status >= 500
        )
      }

      const data: RpcResponse<T> = await response.json()

      if (data.error) {
        throw new NetworkError(
          `RPC error: ${data.error.message}`,
          data.error.code,
          false
        )
      }

      if (data.result === undefined) {
        throw new NetworkError("RPC response missing result field")
      }

      return data.result
    } catch (error) {
      if (error instanceof NetworkError) {
        throw error
      }

      // Network failure
      throw new NetworkError(
        `Network request failed: ${(error as Error).message}`,
        undefined,
        true
      )
    }
  }

  async query<T = unknown>(
    path: string,
    data: string | Uint8Array
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

    return this.call("query", {
      request_type: "call_function",
      finality: "final",
      account_id: contractId,
      method_name: methodName,
      args_base64: argsBase64,
    })
  }

  async getAccount(accountId: string): Promise<AccountView> {
    return this.call("query", {
      request_type: "view_account",
      finality: "final",
      account_id: accountId,
    })
  }

  async getAccessKey(
    accountId: string,
    publicKey: string,
  ): Promise<AccessKeyView> {
    return this.call("query", {
      request_type: "view_access_key",
      finality: "final",
      account_id: accountId,
      public_key: publicKey,
    })
  }

  async sendTransaction(signedTransaction: Uint8Array): Promise<unknown> {
    const base64Encoded = base64.encode(signedTransaction)
    return this.call("broadcast_tx_commit", [base64Encoded])
  }

  async getStatus(): Promise<StatusResponse> {
    return this.call("status", [])
  }

  async getGasPrice(blockId: string | null = null): Promise<GasPriceResponse> {
    return this.call("gas_price", [blockId])
  }
}
