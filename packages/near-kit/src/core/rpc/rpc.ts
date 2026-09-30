import { base58, base64 } from "@scure/base"
import { Effect, Option, Schedule, Schema, Stream } from "effect"
import type { z } from "zod"
import * as Protocol from "../../effect/protocol-schemas.js"
import { ExternalError, fromPromise, runPromise } from "../../effect/runtime.js"
import {
  AccessKeyDoesNotExistError,
  GlobalContractNotFoundError,
  InvalidTransactionError,
  NearError,
  NetworkError,
} from "../../errors/index.js"
import type { BlockReference, RpcRetryConfigInput } from "../config-schemas.js"
import type {
  AccessKeyListResponse,
  AccessKeyView,
  AccountView,
  BlockEffectsResponse,
  BlockView,
  ContractCodeView,
  ExecutionOutcomeWithId,
  FinalExecutionOutcome,
  FinalExecutionOutcomeMap,
  FinalExecutionOutcomeWithReceipts,
  FinalExecutionOutcomeWithReceiptsMap,
  GasKeyNoncesResponse,
  GasPriceResponse,
  GenesisConfigResponse,
  GlobalContractReference,
  MaintenanceWindowsResponse,
  ReceiptToTxResponse,
  StateItem,
  StatusResponse,
  ViewFunctionCallResult,
  ViewStateResult,
} from "../types.js"
import {
  checkOutcomeForFunctionCallError,
  extractErrorMessage,
  isRetryableStatus,
  parseQueryError,
  parseRpcError,
} from "./rpc-error-handler.js"
import {
  AccessKeyListResponseSchema,
  AccessKeyViewSchema,
  AccountViewSchema,
  BlockEffectsResponseSchema,
  BlockViewSchema,
  ContractCodeViewSchema,
  FinalExecutionOutcomeSchema,
  FinalExecutionOutcomeWithReceiptsSchema,
  GasKeyNoncesResponseSchema,
  GasPriceResponseSchema,
  GenesisConfigResponseSchema,
  MaintenanceWindowsResponseSchema,
  ReceiptToTxResponseSchema,
  StatusResponseSchema,
  ViewFunctionCallResultSchema,
  ViewStateResultSchema,
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
  private transport: RpcFetch = (url, init) => globalThis.fetch(url, init)

  /** Construct a client using an explicit HTTP transport (proxies, instrumentation or tests). */
  static withTransport(
    url: string,
    transport: RpcFetch,
    headers?: Record<string, string>,
    retryConfig?: RpcRetryConfigInput,
  ): RpcClient {
    const client = new RpcClient(url, headers, retryConfig)
    client.transport = transport
    return client
  }

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
  call<T = unknown>(method: string, params: unknown): Promise<T> {
    return runPromise(this.callOperation<T>(method, params))
  }

  callEffect<T = unknown>(
    method: string,
    params: unknown,
  ): Effect.Effect<T, RpcFailure> {
    return Effect.suspend(() =>
      this.call === rpcPromiseMethods["call"]?.value
        ? this.callOperation<T>(method, params)
        : fromPromise(() => this.call<T>(method, params), "RpcClient.call"),
    )
  }

  private readonly callOperation = Effect.fn("RpcClient.call")(function* <
    T = unknown,
  >(
    this: RpcClient,
    method: string,
    params: unknown,
  ): Effect.fn.Return<T, RpcFailure> {
    const request: RpcRequest = {
      jsonrpc: "2.0",
      id: ++this.requestId,
      method,
      params,
    }
    const attempt = Effect.fn("RpcClient.request")(
      { self: this },
      function* (this: RpcClient): Effect.fn.Return<T, NearError> {
        debugRpc("Request", request)
        // One interruptible transport boundary owns both fetch and body consumption.
        // Aborting after headers have arrived must still cancel the response body.
        const { response, data } = yield* Effect.tryPromise({
          try: async (signal) => {
            const response = await this.transport(this.url, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...this.headers,
              },
              body: JSON.stringify(request),
              signal,
            })
            if (!response.ok) {
              const error = new NetworkError(
                `HTTP ${response.status}: ${response.statusText}`,
                response.status,
                isRetryableStatus(response.status),
              )
              try {
                await response.body?.cancel()
              } catch {
                // Cleanup failure must not hide the HTTP status or alter retry policy.
              }
              throw error
            }
            const data: unknown = await response.json()
            return { response, data }
          },
          catch: transportError,
        })
        debugRpc("Response", data)
        const envelope = yield* Schema.decodeUnknownEffect(RpcEnvelopeSchema)(
          data,
        ).pipe(
          Effect.mapError(
            () => new NetworkError("RPC response missing result field"),
          ),
        )
        if (envelope.error)
          return yield* domainEffect(() =>
            parseRpcError(envelope.error, response.status),
          )
        if (envelope.result === undefined)
          return yield* Effect.fail(
            new NetworkError("RPC response missing result field"),
          )
        // call<T> is intentionally the existing unvalidated raw-RPC escape hatch.
        // Typed methods below always decode their own complete protocol contract.
        return envelope.result as T
      },
    )
    return yield* attempt().pipe(
      Effect.retry({
        schedule: Schedule.exponential(this.retryConfig.initialDelayMs).pipe(
          Schedule.upTo({ times: this.retryConfig.maxRetries }),
        ),
        while: (error) => "retryable" in error && error.retryable === true,
      }),
    )
  })

  /**
   * Perform a generic `query` RPC call.
   *
   * @param path - `request_type` (e.g. `"view_account"`, `"view_access_key"`).
   * @param data - Raw args as base64 string or bytes.
   */
  query<T = unknown>(path: string, data: string | Uint8Array): Promise<T> {
    return runPromise(this.queryOperation<T>(path, data))
  }

  queryEffect<T = unknown>(
    path: string,
    data: string | Uint8Array,
  ): Effect.Effect<T, RpcFailure> {
    return Effect.suspend(() =>
      this.query === rpcPromiseMethods["query"]?.value
        ? this.queryOperation<T>(path, data)
        : fromPromise(() => this.query<T>(path, data), "RpcClient.query"),
    )
  }

  private readonly queryOperation = Effect.fn("RpcClient.query")(function* <
    T = unknown,
  >(
    this: RpcClient,
    path: string,
    data: string | Uint8Array,
  ): Effect.fn.Return<T, RpcFailure> {
    return yield* this.callEffect<T>("query", {
      request_type: path,
      finality: "final",
      args_base64: typeof data === "string" ? data : base64.encode(data),
    })
  })

  /**
   * Call a contract view function via RPC.
   *
   * @param contractId - Account ID of the target contract.
   * @param methodName - Name of the view method.
   * @param args - Arguments object or raw bytes; defaults to `{}`.
   * @param options - Optional {@link BlockReference} to control finality or block.
   */
  viewFunction(
    contractId: string,
    methodName: string,
    args: unknown = {},
    options?: BlockReference,
  ): Promise<ViewFunctionCallResult> {
    return runPromise(
      this.viewFunctionOperation(contractId, methodName, args, options),
    )
  }

  viewFunctionEffect(
    contractId: string,
    methodName: string,
    args: unknown = {},
    options?: BlockReference,
  ): Effect.Effect<ViewFunctionCallResult, RpcFailure> {
    return Effect.suspend(() =>
      this.viewFunction === rpcPromiseMethods["viewFunction"]?.value
        ? this.viewFunctionOperation(contractId, methodName, args, options)
        : fromPromise(
            () => this.viewFunction(contractId, methodName, args, options),
            "RpcClient.viewFunction",
          ),
    )
  }

  private readonly viewFunctionOperation = Effect.fn("RpcClient.viewFunction")(
    { self: this },
    function* (
      this: RpcClient,
      contractId: string,
      methodName: string,
      args: unknown = {},
      options?: BlockReference,
    ): Effect.fn.Return<ViewFunctionCallResult, RpcFailure> {
      const argsBytes =
        args instanceof Uint8Array
          ? args
          : new TextEncoder().encode(JSON.stringify(args))
      const argsBase64 = base64.encode(argsBytes)
      const result = yield* this.callEffect("query", {
        request_type: "call_function",
        ...(options?.blockId
          ? { block_id: options.blockId }
          : { finality: options?.finality || "final" }),
        account_id: contractId,
        method_name: methodName,
        args_base64: argsBase64,
      })
      yield* domainEffect(() =>
        // Check for errors in result (NEAR returns view function errors this way)
        parseQueryError(result, { contractId, methodName }),
      )
      return yield* decodeRpc(
        Protocol.ViewFunctionCallResultSchema,
        ViewFunctionCallResultSchema,
        result,
      )
    },
  )

  /**
   * Get basic account information via `view_account`.
   *
   * @param accountId - Account ID to query.
   * @param options - Optional {@link BlockReference} to control finality or block.
   */
  getAccount(
    accountId: string,
    options?: BlockReference,
  ): Promise<AccountView> {
    return runPromise(this.getAccountOperation(accountId, options))
  }

  getAccountEffect(
    accountId: string,
    options?: BlockReference,
  ): Effect.Effect<AccountView, RpcFailure> {
    return Effect.suspend(() =>
      this.getAccount === rpcPromiseMethods["getAccount"]?.value
        ? this.getAccountOperation(accountId, options)
        : fromPromise(
            () => this.getAccount(accountId, options),
            "RpcClient.getAccount",
          ),
    )
  }

  private readonly getAccountOperation = Effect.fn("RpcClient.getAccount")(
    { self: this },
    function* (
      this: RpcClient,
      accountId: string,
      options?: BlockReference,
    ): Effect.fn.Return<AccountView, RpcFailure> {
      const result = yield* this.callEffect("query", {
        request_type: "view_account",
        ...(options?.blockId
          ? { block_id: options.blockId }
          : { finality: options?.finality || "optimistic" }),
        account_id: accountId,
      })
      return yield* decodeRpc(
        Protocol.AccountViewSchema,
        AccountViewSchema,
        result,
      )
    },
  )

  /**
   * Get the WASM code deployed on an account via `view_code`.
   *
   * @param accountId - Account whose contract code to fetch.
   * @param options - Optional {@link BlockReference} to control finality or block.
   *
   * @returns The base64-encoded code and its base58 SHA-256 hash.
   *
   * @throws {ContractNotDeployedError} If the account has no contract deployed.
   * @throws {AccountDoesNotExistError} If the account does not exist.
   */
  viewCode(
    accountId: string,
    options?: BlockReference,
  ): Promise<ContractCodeView> {
    return runPromise(this.viewCodeOperation(accountId, options))
  }

  viewCodeEffect(
    accountId: string,
    options?: BlockReference,
  ): Effect.Effect<ContractCodeView, RpcFailure> {
    return Effect.suspend(() =>
      this.viewCode === rpcPromiseMethods["viewCode"]?.value
        ? this.viewCodeOperation(accountId, options)
        : fromPromise(
            () => this.viewCode(accountId, options),
            "RpcClient.viewCode",
          ),
    )
  }

  private readonly viewCodeOperation = Effect.fn("RpcClient.viewCode")(
    { self: this },
    function* (
      this: RpcClient,
      accountId: string,
      options?: BlockReference,
    ): Effect.fn.Return<ContractCodeView, RpcFailure> {
      const result = yield* this.callEffect("query", {
        request_type: "view_code",
        ...(options?.blockId
          ? { block_id: options.blockId }
          : { finality: options?.finality || "optimistic" }),
        account_id: accountId,
      })
      return yield* decodeRpc(
        Protocol.ContractCodeViewSchema,
        ContractCodeViewSchema,
        result,
      )
    },
  )

  /**
   * Get a published global contract's code via `view_global_contract_code`
   * (by code hash) or `view_global_contract_code_by_account_id` (by
   * publishing account). Requires nearcore >= 2.7.
   *
   * @param contract - {@link GlobalContractReference}: `{ codeHash }` or `{ accountId }`.
   * @param options - Optional {@link BlockReference} to control finality or block.
   *
   * @returns The base64-encoded code and its base58 SHA-256 hash.
   *
   * @throws {GlobalContractNotFoundError} If no code is published under the identifier.
   */
  viewGlobalContractCode(
    contract: GlobalContractReference,
    options?: BlockReference,
  ): Promise<ContractCodeView> {
    return runPromise(this.viewGlobalContractCodeOperation(contract, options))
  }

  viewGlobalContractCodeEffect(
    contract: GlobalContractReference,
    options?: BlockReference,
  ): Effect.Effect<ContractCodeView, RpcFailure> {
    return Effect.suspend(() =>
      this.viewGlobalContractCode ===
      rpcPromiseMethods["viewGlobalContractCode"]?.value
        ? this.viewGlobalContractCodeOperation(contract, options)
        : fromPromise(
            () => this.viewGlobalContractCode(contract, options),
            "RpcClient.viewGlobalContractCode",
          ),
    )
  }

  private readonly viewGlobalContractCodeOperation = Effect.fn(
    "RpcClient.viewGlobalContractCode",
  )(
    { self: this },
    function* (
      this: RpcClient,
      contract: GlobalContractReference,
      options?: BlockReference,
    ): Effect.fn.Return<ContractCodeView, RpcFailure> {
      const request =
        "accountId" in contract
          ? {
              request_type: "view_global_contract_code_by_account_id",
              account_id: contract.accountId,
            }
          : {
              request_type: "view_global_contract_code",
              code_hash: normalizeCodeHash(contract.codeHash),
            }
      const result = yield* this.callEffect("query", {
        ...request,
        ...(options?.blockId
          ? { block_id: options.blockId }
          : { finality: options?.finality || "optimistic" }),
      }).pipe(
        Effect.mapError((error) => {
          // nearcore echoes the identifier in the error payload, but its shape
          // varies across node versions — re-key with the caller-known reference
          // so the error is always complete.
          if (rpcFailureCause(error) instanceof GlobalContractNotFoundError) {
            return new GlobalContractNotFoundError(
              "accountId" in contract
                ? { accountId: contract.accountId }
                : { codeHash: normalizeCodeHash(contract.codeHash) },
            )
          }
          return error
        }),
      )
      return yield* decodeRpc(
        Protocol.ContractCodeViewSchema,
        ContractCodeViewSchema,
        result,
      )
    },
  )

  /**
   * Get an access key via `view_access_key`.
   *
   * @param accountId - Account ID that owns the key.
   * @param publicKey - Public key string (e.g. `"ed25519:..."`).
   * @param options - Optional {@link BlockReference} to control finality or block.
   */
  getAccessKey(
    accountId: string,
    publicKey: string,
    options?: BlockReference,
  ): Promise<AccessKeyView> {
    return runPromise(this.getAccessKeyOperation(accountId, publicKey, options))
  }

  getAccessKeyEffect(
    accountId: string,
    publicKey: string,
    options?: BlockReference,
  ): Effect.Effect<AccessKeyView, RpcFailure> {
    return Effect.suspend(() =>
      this.getAccessKey === rpcPromiseMethods["getAccessKey"]?.value
        ? this.getAccessKeyOperation(accountId, publicKey, options)
        : fromPromise(
            () => this.getAccessKey(accountId, publicKey, options),
            "RpcClient.getAccessKey",
          ),
    )
  }

  private readonly getAccessKeyOperation = Effect.fn("RpcClient.getAccessKey")(
    { self: this },
    function* (
      this: RpcClient,
      accountId: string,
      publicKey: string,
      options?: BlockReference,
    ): Effect.fn.Return<AccessKeyView, RpcFailure> {
      const result = yield* this.callEffect("query", {
        request_type: "view_access_key",
        ...(options?.blockId
          ? { block_id: options.blockId }
          : { finality: options?.finality || "optimistic" }),
        account_id: accountId,
        public_key: publicKey,
      })
      yield* domainEffect(() =>
        // Check for errors in result (NEAR returns access key errors this way)
        parseQueryError(result, { accountId, publicKey }),
      )
      return yield* decodeRpc(
        Protocol.AccessKeyViewSchema,
        AccessKeyViewSchema,
        result,
      )
    },
  )

  /**
   * Get all access keys for an account via `view_access_key_list`.
   *
   * @param accountId - Account ID to list keys for.
   * @param options - Optional {@link BlockReference} to control finality or block.
   */
  getAccessKeys(
    accountId: string,
    options?: BlockReference,
  ): Promise<AccessKeyListResponse> {
    return runPromise(this.getAccessKeysOperation(accountId, options))
  }

  getAccessKeysEffect(
    accountId: string,
    options?: BlockReference,
  ): Effect.Effect<AccessKeyListResponse, RpcFailure> {
    return Effect.suspend(() =>
      this.getAccessKeys === rpcPromiseMethods["getAccessKeys"]?.value
        ? this.getAccessKeysOperation(accountId, options)
        : fromPromise(
            () => this.getAccessKeys(accountId, options),
            "RpcClient.getAccessKeys",
          ),
    )
  }

  private readonly getAccessKeysOperation = Effect.fn(
    "RpcClient.getAccessKeys",
  )(
    { self: this },
    function* (
      this: RpcClient,
      accountId: string,
      options?: BlockReference,
    ): Effect.fn.Return<AccessKeyListResponse, RpcFailure> {
      const result = yield* this.callEffect("query", {
        request_type: "view_access_key_list",
        ...(options?.blockId
          ? { block_id: options.blockId }
          : { finality: options?.finality || "optimistic" }),
        account_id: accountId,
      })
      return yield* decodeRpc(
        Protocol.AccessKeyListResponseSchema,
        AccessKeyListResponseSchema,
        result,
      )
    },
  )

  /**
   * Get a gas key's per-lane nonces via `view_gas_key_nonces` (nearcore 2.13).
   *
   * A gas key funds several parallel nonce lanes (`num_nonces` slots) so it can
   * sign multiple transactions concurrently; this returns the current `u64`
   * nonce of each lane, indexed by lane, plus the block the query was answered
   * against. Throws {@link AccessKeyDoesNotExistError} if `publicKey` is not a
   * gas key on `accountId`.
   *
   * @param accountId - Account ID that owns the gas key.
   * @param publicKey - Gas key public key string (e.g. `"ed25519:..."`).
   * @param options - Optional {@link BlockReference} to control finality or block.
   */
  getGasKeyNonces(
    accountId: string,
    publicKey: string,
    options?: BlockReference,
  ): Promise<GasKeyNoncesResponse> {
    return runPromise(
      this.getGasKeyNoncesOperation(accountId, publicKey, options),
    )
  }

  getGasKeyNoncesEffect(
    accountId: string,
    publicKey: string,
    options?: BlockReference,
  ): Effect.Effect<GasKeyNoncesResponse, RpcFailure> {
    return Effect.suspend(() =>
      this.getGasKeyNonces === rpcPromiseMethods["getGasKeyNonces"]?.value
        ? this.getGasKeyNoncesOperation(accountId, publicKey, options)
        : fromPromise(
            () => this.getGasKeyNonces(accountId, publicKey, options),
            "RpcClient.getGasKeyNonces",
          ),
    )
  }

  private readonly getGasKeyNoncesOperation = Effect.fn(
    "RpcClient.getGasKeyNonces",
  )(
    { self: this },
    function* (
      this: RpcClient,
      accountId: string,
      publicKey: string,
      options?: BlockReference,
    ): Effect.fn.Return<GasKeyNoncesResponse, RpcFailure> {
      // Unlike view_access_key (whose "does not exist" arrives in `result.error`),
      // view_gas_key_nonces reports a missing gas key as a typed UNKNOWN_GAS_KEY
      // JSON-RPC error. parseRpcError already maps that to AccessKeyDoesNotExistError
      // but nearcore only echoes the public key, so we re-key it with the queried
      // account for a complete error.
      const result = yield* this.callEffect("query", {
        request_type: "view_gas_key_nonces",
        ...(options?.blockId
          ? { block_id: options.blockId }
          : { finality: options?.finality || "optimistic" }),
        account_id: accountId,
        public_key: publicKey,
      }).pipe(
        Effect.mapError((error) => {
          if (rpcFailureCause(error) instanceof AccessKeyDoesNotExistError) {
            return new AccessKeyDoesNotExistError(accountId, publicKey)
          }
          return error
        }),
      )
      return yield* decodeRpc(
        Protocol.GasKeyNoncesResponseSchema,
        GasKeyNoncesResponseSchema,
        result,
      )
    },
  )

  /**
   * Send a signed transaction via `send_tx`.
   *
   * @param signedTransaction - Borsh-serialized signed transaction bytes.
   * @param waitUntil - Execution status level to wait for (see {@link TxExecutionStatus}).
   */
  sendTransaction<
    W extends keyof FinalExecutionOutcomeMap = "EXECUTED_OPTIMISTIC",
  >(
    signedTransaction: Uint8Array,
    waitUntil?: W,
  ): Promise<FinalExecutionOutcomeMap[W]> {
    return runPromise(
      this.sendTransactionOperation(signedTransaction, waitUntil),
    )
  }

  sendTransactionEffect<
    W extends keyof FinalExecutionOutcomeMap = "EXECUTED_OPTIMISTIC",
  >(
    signedTransaction: Uint8Array,
    waitUntil?: W,
  ): Effect.Effect<FinalExecutionOutcomeMap[W], RpcFailure> {
    return Effect.suspend(() =>
      this.sendTransaction === rpcPromiseMethods["sendTransaction"]?.value
        ? this.sendTransactionOperation(signedTransaction, waitUntil)
        : fromPromise(
            () => this.sendTransaction(signedTransaction, waitUntil),
            "RpcClient.sendTransaction",
          ),
    )
  }

  private readonly sendTransactionOperation = Effect.fn(
    "RpcClient.sendTransaction",
  )({ self: this }, function* <
    W extends keyof FinalExecutionOutcomeMap = "EXECUTED_OPTIMISTIC",
  >(this: RpcClient, signedTransaction: Uint8Array, waitUntil?: W): Effect.fn.Return<
    FinalExecutionOutcomeMap[W],
    RpcFailure
  > {
    const actualWaitUntil = (waitUntil ?? "EXECUTED_OPTIMISTIC") as W
    const base64Encoded = base64.encode(signedTransaction)
    // Use send_tx with wait_until parameter instead of deprecated broadcast_tx_commit
    const result = yield* this.callEffect("send_tx", {
      signed_tx_base64: base64Encoded,
      wait_until: actualWaitUntil,
    })
    const parsed: FinalExecutionOutcome = yield* decodeRpc(
      Protocol.FinalExecutionOutcomeSchema,
      FinalExecutionOutcomeSchema,
      result,
    )
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
          yield* domainEffect(() =>
            checkOutcomeForFunctionCallError(
              parsed.transaction_outcome,
              parsed.transaction,
            ),
          )
        }
        // Check receipts_outcome for cross-contract failures
        const failedReceipt = parsed.receipts_outcome?.find(
          (receipt: ExecutionOutcomeWithId) =>
            typeof receipt.outcome.status === "object" &&
            "Failure" in receipt.outcome.status,
        )
        if (failedReceipt) {
          yield* domainEffect(() =>
            checkOutcomeForFunctionCallError(failedReceipt, parsed.transaction),
          )
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
        return yield* Effect.fail(
          new InvalidTransactionError(errorMessage, failureDetails),
        )
      }
    }
    // Safe cast: TypeScript guarantees W is a valid key, Zod validates the structure,
    // and waitUntil determines which variant we get from the RPC
    return parsed as FinalExecutionOutcomeMap[W]
  })

  /**
   * Query transaction status with receipts via `EXPERIMENTAL_tx_status`.
   *
   * @param txHash - Transaction hash.
   * @param senderAccountId - Account ID that sent the transaction.
   * @param waitUntil - Execution status level to wait for.
   */
  getTransactionStatus<
    W extends
      keyof FinalExecutionOutcomeWithReceiptsMap = "EXECUTED_OPTIMISTIC",
  >(
    txHash: string,
    senderAccountId: string,
    waitUntil?: W,
  ): Promise<FinalExecutionOutcomeWithReceiptsMap[W]> {
    return runPromise(
      this.getTransactionStatusOperation(txHash, senderAccountId, waitUntil),
    )
  }

  getTransactionStatusEffect<
    W extends
      keyof FinalExecutionOutcomeWithReceiptsMap = "EXECUTED_OPTIMISTIC",
  >(
    txHash: string,
    senderAccountId: string,
    waitUntil?: W,
  ): Effect.Effect<FinalExecutionOutcomeWithReceiptsMap[W], RpcFailure> {
    return Effect.suspend(() =>
      this.getTransactionStatus ===
      rpcPromiseMethods["getTransactionStatus"]?.value
        ? this.getTransactionStatusOperation(txHash, senderAccountId, waitUntil)
        : fromPromise(
            () => this.getTransactionStatus(txHash, senderAccountId, waitUntil),
            "RpcClient.getTransactionStatus",
          ),
    )
  }

  private readonly getTransactionStatusOperation = Effect.fn(
    "RpcClient.getTransactionStatus",
  )({ self: this }, function* <
    W extends
      keyof FinalExecutionOutcomeWithReceiptsMap = "EXECUTED_OPTIMISTIC",
  >(this: RpcClient, txHash: string, senderAccountId: string, waitUntil?: W): Effect.fn.Return<
    FinalExecutionOutcomeWithReceiptsMap[W],
    RpcFailure
  > {
    const actualWaitUntil = (waitUntil ?? "EXECUTED_OPTIMISTIC") as W
    // Call EXPERIMENTAL_tx_status with wait_until parameter
    const result = yield* this.callEffect("EXPERIMENTAL_tx_status", {
      tx_hash: txHash,
      sender_account_id: senderAccountId,
      wait_until: actualWaitUntil,
    })
    const parsed: FinalExecutionOutcomeWithReceipts = yield* decodeRpc(
      Protocol.FinalExecutionOutcomeWithReceiptsSchema,
      FinalExecutionOutcomeWithReceiptsSchema,
      result,
    )
    // Check for execution failures. EXPERIMENTAL_tx_status can return a terminal
    // Failure status even when final_execution_status is an early wait level
    // (NONE/INCLUDED/INCLUDED_FINAL), so gate on the presence of a Failure status
    // rather than the wait-level label to honor the documented throw-on-failure
    // contract. Execution fields are optional at early levels and guarded below.
    if (
      parsed.status &&
      typeof parsed.status === "object" &&
      "Failure" in parsed.status
    ) {
      // Check transaction_outcome for direct failures
      if (parsed.transaction_outcome) {
        const outcome = parsed.transaction_outcome
        yield* domainEffect(() =>
          checkOutcomeForFunctionCallError(outcome, parsed.transaction),
        )
      }
      // Check receipts_outcome for cross-contract failures
      const failedReceipt = parsed.receipts_outcome?.find(
        (receipt) =>
          typeof receipt.outcome.status === "object" &&
          "Failure" in receipt.outcome.status,
      )
      if (failedReceipt) {
        yield* domainEffect(() =>
          checkOutcomeForFunctionCallError(failedReceipt, parsed.transaction),
        )
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
      return yield* Effect.fail(
        new InvalidTransactionError(errorMessage, failureDetails),
      )
    }
    // Safe cast: TypeScript guarantees W is a valid key, Zod validates the structure,
    // and waitUntil determines which variant we get from the RPC
    return parsed as FinalExecutionOutcomeWithReceiptsMap[W]
  })

  /**
   * Map a receipt back to its originating transaction via
   * `EXPERIMENTAL_receipt_to_tx`.
   *
   * @remarks
   * This is an experimental endpoint and requires nearcore >= 2.12. It looks up
   * the transaction that produced the given receipt and returns the transaction
   * hash and sender account ID.
   *
   * @param receiptId - Receipt ID (CryptoHash, base58) to look up.
   *
   * @returns The originating transaction's hash and sender account ID.
   *
   * @throws {UnknownReceiptError} If the receipt is not known to the node.
   * @throws {NetworkError} If the network request failed.
   */
  receiptToTx(receiptId: string): Promise<ReceiptToTxResponse> {
    return runPromise(this.receiptToTxOperation(receiptId))
  }

  receiptToTxEffect(
    receiptId: string,
  ): Effect.Effect<ReceiptToTxResponse, RpcFailure> {
    return Effect.suspend(() =>
      this.receiptToTx === rpcPromiseMethods["receiptToTx"]?.value
        ? this.receiptToTxOperation(receiptId)
        : fromPromise(
            () => this.receiptToTx(receiptId),
            "RpcClient.receiptToTx",
          ),
    )
  }

  private readonly receiptToTxOperation = Effect.fn("RpcClient.receiptToTx")(
    { self: this },
    function* (
      this: RpcClient,
      receiptId: string,
    ): Effect.fn.Return<ReceiptToTxResponse, RpcFailure> {
      const result = yield* this.callEffect("EXPERIMENTAL_receipt_to_tx", {
        receipt_id: receiptId,
      })
      return yield* decodeRpc(
        Protocol.ReceiptToTxResponseSchema,
        ReceiptToTxResponseSchema,
        result,
      )
    },
  )

  /**
   * Get node status via `status`.
   */
  getStatus(): Promise<StatusResponse> {
    return runPromise(this.getStatusOperation())
  }

  getStatusEffect(): Effect.Effect<StatusResponse, RpcFailure> {
    return Effect.suspend(() =>
      this.getStatus === rpcPromiseMethods["getStatus"]?.value
        ? this.getStatusOperation()
        : fromPromise(() => this.getStatus(), "RpcClient.getStatus"),
    )
  }

  private readonly getStatusOperation = Effect.fn("RpcClient.getStatus")(
    { self: this },
    function* (this: RpcClient): Effect.fn.Return<StatusResponse, RpcFailure> {
      const result = yield* this.callEffect("status", [])
      return yield* decodeRpc(
        Protocol.StatusResponseSchema,
        StatusResponseSchema,
        result,
      )
    },
  )

  /**
   * Get block information via `block`.
   *
   * @param options - Block reference specifying which block to fetch.
   *                  Use `{ finality: "final" }` for the latest finalized block,
   *                  `{ finality: "optimistic" }` for the latest block,
   *                  or `{ blockId: <hash or height> }` for a specific block.
   *
   * @example
   * ```typescript
   * // Get latest finalized block (recommended for transactions)
   * const block = await rpc.getBlock({ finality: "final" })
   *
   * // Get latest optimistic block
   * const block = await rpc.getBlock({ finality: "optimistic" })
   *
   * // Get specific block by height
   * const block = await rpc.getBlock({ blockId: 12345 })
   *
   * // Get specific block by hash
   * const block = await rpc.getBlock({ blockId: "ABC123..." })
   * ```
   */
  getBlock(options?: BlockReference): Promise<BlockView> {
    return runPromise(this.getBlockOperation(options))
  }

  getBlockEffect(
    options?: BlockReference,
  ): Effect.Effect<BlockView, RpcFailure> {
    return Effect.suspend(() =>
      this.getBlock === rpcPromiseMethods["getBlock"]?.value
        ? this.getBlockOperation(options)
        : fromPromise(() => this.getBlock(options), "RpcClient.getBlock"),
    )
  }

  private readonly getBlockOperation = Effect.fn("RpcClient.getBlock")(
    { self: this },
    function* (
      this: RpcClient,
      options?: BlockReference,
    ): Effect.fn.Return<BlockView, RpcFailure> {
      const result = yield* this.callEffect(
        "block",
        options?.blockId
          ? { block_id: options.blockId }
          : { finality: options?.finality || "final" },
      )
      return yield* decodeRpc(Protocol.BlockViewSchema, BlockViewSchema, result)
    },
  )

  /**
   * Get gas price via `gas_price`.
   *
   * @param blockId - Optional block hash or height; `null` for latest.
   */
  getGasPrice(blockId: string | null = null): Promise<GasPriceResponse> {
    return runPromise(this.getGasPriceOperation(blockId))
  }

  getGasPriceEffect(
    blockId: string | null = null,
  ): Effect.Effect<GasPriceResponse, RpcFailure> {
    return Effect.suspend(() =>
      this.getGasPrice === rpcPromiseMethods["getGasPrice"]?.value
        ? this.getGasPriceOperation(blockId)
        : fromPromise(() => this.getGasPrice(blockId), "RpcClient.getGasPrice"),
    )
  }

  private readonly getGasPriceOperation = Effect.fn("RpcClient.getGasPrice")(
    { self: this },
    function* (
      this: RpcClient,
      blockId: string | null = null,
    ): Effect.fn.Return<GasPriceResponse, RpcFailure> {
      const result = yield* this.callEffect("gas_price", [blockId])
      return yield* decodeRpc(
        Protocol.GasPriceResponseSchema,
        GasPriceResponseSchema,
        result,
      )
    },
  )

  /**
   * Read a single page of contract state via `view_state`.
   *
   * Returns key/value entries (base64-encoded) whose keys start with `prefix`.
   * When the result has a `last_key`, more entries remain: pass it as
   * `options.afterKey` to fetch the next page, or use {@link viewStateAll} to
   * iterate every page automatically.
   *
   * @param accountId - Account whose contract state to read.
   * @param options - Optional pagination and block reference.
   * @param options.prefix - Base64 key prefix to filter by (default: all keys).
   * @param options.afterKey - Base64 continuation cursor from a prior `last_key`.
   * @param options.limit - Maximum number of entries to return.
   * @param options.includeProof - Request Merkle inclusion proofs.
   *
   * @example
   * ```typescript
   * const page = await rpc.viewState("contract.near", { limit: 100 })
   * for (const { key, value } of page.values) { ... }
   * if (page.last_key) {
   *   const next = await rpc.viewState("contract.near", { afterKey: page.last_key })
   * }
   * ```
   */
  viewState(
    accountId: string,
    options?: BlockReference & {
      prefix?: string
      afterKey?: string
      limit?: number
      includeProof?: boolean
    },
  ): Promise<ViewStateResult> {
    return runPromise(this.viewStateOperation(accountId, options))
  }

  viewStateEffect(
    accountId: string,
    options?: BlockReference & {
      prefix?: string
      afterKey?: string
      limit?: number
      includeProof?: boolean
    },
  ): Effect.Effect<ViewStateResult, RpcFailure> {
    return Effect.suspend(() =>
      this.viewState === rpcPromiseMethods["viewState"]?.value
        ? this.viewStateOperation(accountId, options)
        : fromPromise(
            () => this.viewState(accountId, options),
            "RpcClient.viewState",
          ),
    )
  }

  private readonly viewStateOperation = Effect.fn("RpcClient.viewState")(
    { self: this },
    function* (
      this: RpcClient,
      accountId: string,
      options?: BlockReference & {
        prefix?: string
        afterKey?: string
        limit?: number
        includeProof?: boolean
      },
    ): Effect.fn.Return<ViewStateResult, RpcFailure> {
      const result = yield* this.callEffect("query", {
        request_type: "view_state",
        ...(options?.blockId
          ? { block_id: options.blockId }
          : { finality: options?.finality || "optimistic" }),
        account_id: accountId,
        prefix_base64: options?.prefix ?? "",
        ...(options?.afterKey !== undefined
          ? { after_key_base64: options.afterKey }
          : {}),
        ...(options?.limit !== undefined ? { limit: options.limit } : {}),
        ...(options?.includeProof ? { include_proof: true } : {}),
      })
      yield* domainEffect(() =>
        // No access-key context: parseQueryError would otherwise misread a
        // "does not exist" error (missing account/contract) as an
        // AccessKeyDoesNotExistError. A view_state failure surfaces as a generic
        // query error instead.
        parseQueryError(result),
      )
      return yield* decodeRpc(
        Protocol.ViewStateResultSchema,
        ViewStateResultSchema,
        result,
      )
    },
  )

  /**
   * Iterate all contract state entries via `view_state`, following the
   * `last_key` cursor across pages until exhausted.
   *
   * Yields one {@link StateItem} at a time so large state can be streamed
   * without buffering it all in memory.
   *
   * @param accountId - Account whose contract state to read.
   * @param options - Optional `prefix`, per-request `limit`, and block reference.
   *
   * @example
   * ```typescript
   * for await (const { key, value } of rpc.viewStateAll("contract.near", { limit: 100 })) {
   *   // process each entry
   * }
   * ```
   */
  async *viewStateAll(
    accountId: string,
    options?: BlockReference & { prefix?: string; limit?: number },
  ): AsyncGenerator<StateItem> {
    try {
      yield* Stream.toAsyncIterable(
        this.viewStateAllOperation(accountId, options),
      )
    } catch (error) {
      throw error instanceof ExternalError ? error.cause : error
    }
  }

  viewStateAllStream(
    accountId: string,
    options?: BlockReference & { prefix?: string; limit?: number },
  ): Stream.Stream<StateItem, RpcFailure> {
    return Stream.suspend(() =>
      this.viewStateAll === rpcPromiseMethods["viewStateAll"]?.value
        ? this.viewStateAllOperation(accountId, options)
        : Stream.fromAsyncIterable(
            this.viewStateAll(accountId, options),
            (cause) =>
              new ExternalError({ operation: "RpcClient.viewStateAll", cause }),
          ),
    )
  }

  private viewStateAllOperation(
    accountId: string,
    options?: BlockReference & { prefix?: string; limit?: number },
  ): Stream.Stream<StateItem, RpcFailure> {
    return Stream.paginate<string | undefined, StateItem, RpcFailure>(
      undefined,
      (afterKey) =>
        this.viewStateEffect(accountId, {
          ...options,
          ...(afterKey !== undefined ? { afterKey } : {}),
        }).pipe(
          Effect.map(
            (page) =>
              [page.values, Option.fromUndefinedOr(page.last_key)] as const,
          ),
        ),
    )
  }

  /**
   * Get the kinds of state changes in a block via `block_effects`
   * (stabilized in nearcore 2.13; falls back to the `EXPERIMENTAL_changes_in_block`
   * alias on older nodes).
   *
   * @param options - Block reference. Defaults to the latest final block.
   */
  blockEffects(options?: BlockReference): Promise<BlockEffectsResponse> {
    return runPromise(this.blockEffectsOperation(options))
  }

  blockEffectsEffect(
    options?: BlockReference,
  ): Effect.Effect<BlockEffectsResponse, RpcFailure> {
    return Effect.suspend(() =>
      this.blockEffects === rpcPromiseMethods["blockEffects"]?.value
        ? this.blockEffectsOperation(options)
        : fromPromise(
            () => this.blockEffects(options),
            "RpcClient.blockEffects",
          ),
    )
  }

  private readonly blockEffectsOperation = Effect.fn("RpcClient.blockEffects")(
    { self: this },
    function* (
      this: RpcClient,
      options?: BlockReference,
    ): Effect.fn.Return<BlockEffectsResponse, RpcFailure> {
      const params = options?.blockId
        ? { block_id: options.blockId }
        : { finality: options?.finality || "final" }
      const result = yield* this.callWithExperimentalFallbackEffect(
        "block_effects",
        "EXPERIMENTAL_changes_in_block",
        params,
      )
      return yield* decodeRpc(
        Protocol.BlockEffectsResponseSchema,
        BlockEffectsResponseSchema,
        result,
      )
    },
  )

  /**
   * Get the network genesis configuration via `genesis_config` (stabilized in
   * nearcore 2.13; falls back to the `EXPERIMENTAL_genesis_config` alias on
   * older nodes).
   */
  genesisConfig(): Promise<GenesisConfigResponse> {
    return runPromise(this.genesisConfigOperation())
  }

  genesisConfigEffect(): Effect.Effect<GenesisConfigResponse, RpcFailure> {
    return Effect.suspend(() =>
      this.genesisConfig === rpcPromiseMethods["genesisConfig"]?.value
        ? this.genesisConfigOperation()
        : fromPromise(() => this.genesisConfig(), "RpcClient.genesisConfig"),
    )
  }

  private readonly genesisConfigOperation = Effect.fn(
    "RpcClient.genesisConfig",
  )({ self: this }, function* (this: RpcClient): Effect.fn.Return<
    GenesisConfigResponse,
    RpcFailure
  > {
    const result = yield* this.callWithExperimentalFallbackEffect(
      "genesis_config",
      "EXPERIMENTAL_genesis_config",
      [],
    )
    return yield* decodeRpc(
      Protocol.GenesisConfigResponseSchema,
      GenesisConfigResponseSchema,
      result,
    )
  })

  /**
   * Get the upcoming maintenance windows (half-open block-height ranges) for a
   * validator account via `maintenance_windows` (stabilized in nearcore 2.13;
   * falls back to the `EXPERIMENTAL_maintenance_windows` alias on older nodes).
   *
   * @param accountId - Validator account ID.
   */
  maintenanceWindows(accountId: string): Promise<MaintenanceWindowsResponse> {
    return runPromise(this.maintenanceWindowsOperation(accountId))
  }

  maintenanceWindowsEffect(
    accountId: string,
  ): Effect.Effect<MaintenanceWindowsResponse, RpcFailure> {
    return Effect.suspend(() =>
      this.maintenanceWindows === rpcPromiseMethods["maintenanceWindows"]?.value
        ? this.maintenanceWindowsOperation(accountId)
        : fromPromise(
            () => this.maintenanceWindows(accountId),
            "RpcClient.maintenanceWindows",
          ),
    )
  }

  private readonly maintenanceWindowsOperation = Effect.fn(
    "RpcClient.maintenanceWindows",
  )(
    { self: this },
    function* (
      this: RpcClient,
      accountId: string,
    ): Effect.fn.Return<MaintenanceWindowsResponse, RpcFailure> {
      const result = yield* this.callWithExperimentalFallbackEffect(
        "maintenance_windows",
        "EXPERIMENTAL_maintenance_windows",
        { account_id: accountId },
      )
      return yield* decodeRpc(
        Protocol.MaintenanceWindowsResponseSchema,
        MaintenanceWindowsResponseSchema,
        result,
      )
    },
  )

  /**
   * Call a method that was stabilized (renamed without the `EXPERIMENTAL_`
   * prefix) in a recent protocol version, retrying with the legacy
   * `EXPERIMENTAL_` alias if the node does not recognize the new name.
   * @internal
   */
  private readonly callWithExperimentalFallbackEffect = Effect.fn(
    "RpcClient.callWithExperimentalFallback",
  )({ self: this }, function* <
    T = unknown,
  >(this: RpcClient, method: string, experimentalMethod: string, params: unknown): Effect.fn.Return<
    T,
    RpcFailure
  > {
    return yield* this.callEffect<T>(method, params).pipe(
      Effect.catchIf(isMethodNotFound, () =>
        this.callEffect<T>(experimentalMethod, params),
      ),
    )
  })
}

/**
 * Normalize a code hash to its base58 string form, validating that it decodes
 * to exactly 32 bytes (matching `deployFromPublished`'s validation).
 * @internal
 */
function normalizeCodeHash(codeHash: string | Uint8Array): string {
  if (typeof codeHash === "string") {
    const decoded = base58.decode(codeHash)
    if (decoded.length !== 32) {
      throw new Error(`Code hash must be 32 bytes, got ${decoded.length} bytes`)
    }
    return codeHash
  }
  if (codeHash.length !== 32) {
    throw new Error(`Code hash must be 32 bytes, got ${codeHash.length} bytes`)
  }
  return base58.encode(codeHash)
}

/**
 * Whether an error indicates the RPC method name is not recognized by the node
 * (JSON-RPC -32601 "Method not found"), so a legacy alias should be tried.
 *
 * `parseRpcError` surfaces an unknown method as a `NetworkError` whose message
 * carries the `METHOD_NOT_FOUND` cause and whose `statusCode` holds the
 * JSON-RPC error code (-32601).
 * @internal
 */
function isMethodNotFound(failure: unknown): boolean {
  const error = rpcFailureCause(failure)
  if (error instanceof NetworkError && error.statusCode === -32601) {
    return true
  }
  const message = error instanceof Error ? error.message : String(error)
  return /method[\s_]not[\s_]found|-32601/i.test(message)
}

// Capture original Promise entrypoints before consumers subclass or decorate them.
// The Promise facade bypasses override dispatch, allowing overrides to call super
// without recursion; native composition adapts only genuinely external overrides.
const rpcPromiseMethods = Object.getOwnPropertyDescriptors(RpcClient.prototype)

export type RpcFailure = NearError | z.ZodError | ExternalError
export type RpcFetch = (
  url: string,
  init: RequestInit & { signal: AbortSignal },
) => PromiseLike<Response>

const RpcEnvelopeSchema = Schema.Struct({
  result: Schema.optional(Schema.Unknown),
  // Error details retain the historic parser's malformed-error fallback.
  error: Schema.optional(Schema.Unknown),
})

const domainEffect = <A>(operation: () => A): Effect.Effect<A, NearError> =>
  Effect.try({
    try: operation,
    catch: (error) => {
      if (error instanceof NearError) return error
      throw error
    },
  })

function transportError(error: unknown): NearError {
  if (error instanceof NearError) return error
  return new NetworkError(
    `Network request failed: ${error instanceof Error ? error.message : String(error)}`,
    undefined,
    true,
  )
}

function decodeRpc<S extends Schema.Constraint>(
  schema: S,
  compatibilitySchema: z.ZodType,
  input: unknown,
): Effect.Effect<S["Type"], z.ZodError, S["DecodingServices"]> {
  return Schema.decodeUnknownEffect(schema)(input).pipe(
    Effect.mapError((error) => {
      // Public callers historically receive a ZodError. The old decoder runs
      // only on rejection to preserve its issue paths and error shape.
      const result = compatibilitySchema.safeParse(input)
      if (!result.success) return result.error
      // A disagreement is a codec bug, not a reason to silently accept bad data.
      throw error
    }),
  )
}

function debugRpc(direction: "Request" | "Response", value: unknown): void {
  if (
    typeof process !== "undefined" &&
    process.env["NEAR_RPC_DEBUG"] === "true"
  )
    console.log(`[RPC ${direction}]`, JSON.stringify(value, null, 2))
}

function rpcFailureCause(error: unknown): unknown {
  return error instanceof ExternalError ? error.cause : error
}
