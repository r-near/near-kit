import { base58, base64 } from "@scure/base"
import {
  AccessKeyDoesNotExistError,
  ExternalCallRefusedError,
  ExternalCallTimeoutError,
  GlobalContractNotFoundError,
  InvalidTransactionError,
  NearError,
  NetworkError,
  TimeoutError,
} from "../../errors/index.js"
import {
  createStateInit,
  type StateInitOptions,
} from "../../utils/state-init.js"
import type { BlockReference, RpcRetryConfigInput } from "../config-schemas.js"
import {
  EXTERNAL_CALL_METHOD_NAME,
  type ExternalCall,
  encodeExternalCall,
  externalCallHash,
} from "../external-call.js"
import type {
  AccessKeyListResponse,
  AccessKeyView,
  AccountView,
  BlockEffectsResponse,
  BlockView,
  ContractCodeView,
  ExecutionOutcomeWithId,
  ExternalCallOutcome,
  ExternalCallOutcomeMap,
  ExternalCallOutcomeWithReceipts,
  ExternalCallOutcomeWithReceiptsMap,
  FinalExecutionOutcome,
  FinalExecutionOutcomeMap,
  FinalExecutionOutcomeWithReceipts,
  FinalExecutionOutcomeWithReceiptsMap,
  GasKeyNoncesResponse,
  GasPriceResponse,
  GenesisConfigResponse,
  GlobalContractReference,
  MaintenanceWindowsResponse,
  ProtocolConfigResponse,
  ReceiptToTxResponse,
  StateItem,
  StatusResponse,
  ViewFunctionCallResult,
  ViewStateResult,
} from "../types.js"
import {
  checkOutcomeForFunctionCallError,
  checkOutcomesForReservedMethodName,
  checkTransactionForUniversalAccountTransfer,
  extractErrorMessage,
  isRetryableStatus,
  parseQueryError,
  parseRpcError,
  type RpcErrorResponse,
} from "./rpc-error-handler.js"
import {
  AccessKeyListResponseSchema,
  AccessKeyViewSchema,
  AccountViewSchema,
  BlockEffectsResponseSchema,
  BlockViewSchema,
  ContractCodeViewSchema,
  ExternalCallOutcomeSchema,
  ExternalCallOutcomeWithReceiptsSchema,
  FinalExecutionOutcomeSchema,
  FinalExecutionOutcomeWithReceiptsSchema,
  GasKeyNoncesResponseSchema,
  GasPriceResponseSchema,
  GenesisConfigResponseSchema,
  MaintenanceWindowsResponseSchema,
  ProtocolConfigResponseSchema,
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

/**
 * The state init a view call runs with (nearcore 2.15): unless the account
 * already has its state, the call runs as if this were installed.
 *
 * - A deterministic (`0s`) account's NEP-616 state init, as {@link StateInitOptions}.
 * - `{ universal }`: the raw bytes of a universal (`0u`) account's `UniversalStateInit`.
 */
export type ViewStateInit = StateInitOptions | { universal: Uint8Array }

/**
 * Options of a view function call.
 */
export type ViewFunctionOptions = BlockReference & {
  /** Run the call as if this state init were installed. Requires nearcore >= 2.15. */
  stateInit?: ViewStateInit
}

/**
 * Encode a {@link ViewStateInit} as the `state_init` field of a
 * `call_function` query.
 * @internal
 */
export function encodeViewStateInit(stateInit: ViewStateInit): unknown {
  if ("universal" in stateInit) {
    return { universal: base64.encode(stateInit.universal) }
  }
  const { code, data } = createStateInit(stateInit)
  const entries = [...data.entries()]
    .map(([key, value]) => [key, value] as const)
    .sort(([a], [b]) => compareBytes(a, b))
  return {
    deterministic: {
      code:
        code.type === "accountId"
          ? { account_id: code.accountId }
          : { hash: base58.encode(code.hash) },
      data: Object.fromEntries(
        entries.map(([key, value]) => [
          base64.encode(key),
          base64.encode(value),
        ]),
      ),
    },
  }
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const length = Math.min(a.length, b.length)
  for (let i = 0; i < length; i++) {
    const diff = (a[i] as number) - (b[i] as number)
    if (diff !== 0) return diff
  }
  return a.length - b.length
}

/**
 * Throw a typed error if an external call's outcome failed.
 *
 * A failed transaction outcome means the copy was refused (nothing ran or was
 * charged): {@link ExternalCallRefusedError}. A failure in a later receipt
 * means the contract accepted and paid for the call but one of its promises
 * failed; that is reported as for a signed transaction.
 * @internal
 */
function checkExternalCallOutcome(
  parsed: ExternalCallOutcome,
  contractId: string,
): void {
  const status = parsed.status
  if (!status || typeof status !== "object" || !("Failure" in status)) return

  const txOutcome = parsed.transaction_outcome
  const txStatus = txOutcome?.outcome.status
  if (txOutcome && typeof txStatus === "object" && "Failure" in txStatus) {
    throw new ExternalCallRefusedError(
      parsed.transaction?.contract_id ?? contractId,
      txStatus.Failure,
      txOutcome.outcome.logs,
      { uniqueId: txOutcome.id, blockHash: txOutcome.block_hash },
    )
  }

  const receipts = parsed.receipts_outcome ?? []
  checkTransactionForUniversalAccountTransfer(status.Failure, receipts)
  checkOutcomesForReservedMethodName(receipts)
  const failedReceipt = receipts.find(
    (receipt) =>
      typeof receipt.outcome.status === "object" &&
      "Failure" in receipt.outcome.status,
  )
  if (failedReceipt) {
    checkOutcomeForFunctionCallError(failedReceipt, undefined)
    const failure = (failedReceipt.outcome.status as { Failure: unknown })
      .Failure
    throw new InvalidTransactionError(
      extractErrorMessage(failure as Record<string, unknown>),
      failure,
    )
  }
  throw new InvalidTransactionError(
    extractErrorMessage(status.Failure as Record<string, unknown>),
    status.Failure,
  )
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
   * @param options.retry - `false` sends the request once, whatever the error.
   *
   * @returns Parsed JSON result typed as `T`.
   *
   * @throws {NetworkError} On HTTP failures, network issues, or malformed responses.
   * @throws {InvalidTransactionError} For transaction failures detected by {@link parseRpcError}.
   * @throws {NearError} For other RPC-level errors.
   */
  async call<T = unknown>(
    method: string,
    params: unknown,
    options?: { retry?: boolean },
  ): Promise<T> {
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
          // nearcore sends some JSON-RPC errors with a non-2xx status, such as
          // TIMEOUT_ERROR with 408.
          const body = await response
            .clone()
            .json()
            .catch(() => undefined)
          const rpcError = (body as { error?: unknown } | undefined)?.error
          if (
            rpcError !== null &&
            typeof rpcError === "object" &&
            "name" in rpcError
          ) {
            parseRpcError(rpcError as RpcErrorResponse, response.status)
          }
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
        const isRetryable =
          options?.retry !== false &&
          "retryable" in lastError &&
          lastError.retryable
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

    // This should never be reached, but TypeScript needs it
    throw lastError || new NetworkError("Unknown error during RPC call")
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
   * @param options - Optional {@link BlockReference} to control finality or
   * block, and a `stateInit` to run the call with (nearcore >= 2.15).
   *
   * @throws {ExternalCallRefusedError} If `methodName` is `__external_call`
   * and the contract refuses the call.
   */
  async viewFunction(
    contractId: string,
    methodName: string,
    args: unknown = {},
    options?: ViewFunctionOptions,
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
      ...(options?.stateInit
        ? { state_init: encodeViewStateInit(options.stateInit) }
        : {}),
    }).catch((error) => {
      if (
        error instanceof ExternalCallRefusedError &&
        error.contractId === "unknown"
      ) {
        const context: { blockHeight?: number; blockHash?: string } = {}
        if (error.blockHeight !== undefined) {
          context.blockHeight = error.blockHeight
        }
        if (error.blockHash !== undefined) context.blockHash = error.blockHash
        throw new ExternalCallRefusedError(
          contractId,
          error.details,
          error.logs,
          context,
        )
      }
      throw error
    })

    // Check for errors in result (NEAR returns view function errors this way)
    parseQueryError(result, { contractId, methodName })

    return ViewFunctionCallResultSchema.parse(result)
  }

  /**
   * Run an external call as the chunk producer's dry run would, without
   * saving anything: a view call of `__external_call` with the payload as its
   * input (nearcore >= 2.15).
   *
   * @param contractId - The contract the call goes to.
   * @param payload - The call's payload.
   * @param options - Block reference (default: optimistic, the state a chunk
   * producer runs the call on), and the state init the call carries.
   *
   * @returns The run's return value and logs if the contract accepts the call.
   *
   * @throws {ExternalCallRefusedError} If the contract refuses the call; it
   * carries the reason and the run's logs.
   */
  async viewExternalCall(
    call: ExternalCall,
    options?: BlockReference,
  ): Promise<ViewFunctionCallResult> {
    return this.viewFunction(
      call.contractId,
      EXTERNAL_CALL_METHOD_NAME,
      call.payload,
      {
        ...(options?.blockId
          ? { blockId: options.blockId }
          : { finality: options?.finality ?? "optimistic" }),
        ...(call.stateInit ? { stateInit: { universal: call.stateInit } } : {}),
      },
    )
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
  async viewCode(
    accountId: string,
    options?: BlockReference,
  ): Promise<ContractCodeView> {
    const result = await this.call("query", {
      request_type: "view_code",
      ...(options?.blockId
        ? { block_id: options.blockId }
        : { finality: options?.finality || "optimistic" }),
      account_id: accountId,
    })

    return ContractCodeViewSchema.parse(result)
  }

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
  async viewGlobalContractCode(
    contract: GlobalContractReference,
    options?: BlockReference,
  ): Promise<ContractCodeView> {
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

    const result = await this.call("query", {
      ...request,
      ...(options?.blockId
        ? { block_id: options.blockId }
        : { finality: options?.finality || "optimistic" }),
    }).catch((error) => {
      // nearcore echoes the identifier in the error payload, but its shape
      // varies across node versions — re-key with the caller-known reference
      // so the error is always complete.
      if (error instanceof GlobalContractNotFoundError) {
        throw new GlobalContractNotFoundError(
          "accountId" in contract
            ? { accountId: contract.accountId }
            : { codeHash: normalizeCodeHash(contract.codeHash) },
        )
      }
      throw error
    })

    return ContractCodeViewSchema.parse(result)
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
   * Get all access keys for an account via `view_access_key_list`.
   *
   * @param accountId - Account ID to list keys for.
   * @param options - Optional {@link BlockReference} to control finality or block.
   */
  async getAccessKeys(
    accountId: string,
    options?: BlockReference,
  ): Promise<AccessKeyListResponse> {
    const result = await this.call("query", {
      request_type: "view_access_key_list",
      ...(options?.blockId
        ? { block_id: options.blockId }
        : { finality: options?.finality || "optimistic" }),
      account_id: accountId,
    })

    return AccessKeyListResponseSchema.parse(result)
  }

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
  async getGasKeyNonces(
    accountId: string,
    publicKey: string,
    options?: BlockReference,
  ): Promise<GasKeyNoncesResponse> {
    // Unlike view_access_key (whose "does not exist" arrives in `result.error`),
    // view_gas_key_nonces reports a missing gas key as a typed UNKNOWN_GAS_KEY
    // JSON-RPC error. parseRpcError already maps that to AccessKeyDoesNotExistError
    // but nearcore only echoes the public key, so we re-key it with the queried
    // account for a complete error.
    const result = await this.call("query", {
      request_type: "view_gas_key_nonces",
      ...(options?.blockId
        ? { block_id: options.blockId }
        : { finality: options?.finality || "optimistic" }),
      account_id: accountId,
      public_key: publicKey,
    }).catch((error) => {
      if (error instanceof AccessKeyDoesNotExistError) {
        throw new AccessKeyDoesNotExistError(accountId, publicKey)
      }
      throw error
    })

    return GasKeyNoncesResponseSchema.parse(result)
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
        // A banned transfer to a universal account is reported over any other
        // failure (including contract panics in other receipts): it is the
        // protocol-level reason the transaction can't succeed.
        checkTransactionForUniversalAccountTransfer(parsed.status.Failure, [
          parsed.transaction_outcome,
          ...(parsed.receipts_outcome ?? []),
        ])
        checkOutcomesForReservedMethodName(parsed.receipts_outcome ?? [])

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
   * Send an external contract call (NEP-667) via `send_tx` with
   * `external_call_base64` (nearcore >= 2.15).
   *
   * At `INCLUDED` and above the node waits for a copy of the call to land
   * and returns its outcome, whose `transaction_outcome.id` is the copy's
   * unique id. At `NONE` it returns no outcome: the unique id depends on the
   * height the copy lands at.
   *
   * @param call - The call, or its borsh encoding.
   * @param waitUntil - Execution status level to wait for.
   *
   * @throws {ContractNotDeployedError} If the account has no contract or does not exist.
   * @throws {ExternalCallRefusedError} If the copy was refused at execution.
   * @throws {ExternalCallTimeoutError} If no copy was found before the node
   * timed out: for example the producer's dry run refused the call, or the
   * node does not track the contract's shard.
   * @throws {NetworkError} If the request failed. The call is never resent:
   * it may have landed.
   */
  async sendExternalCall<
    W extends keyof ExternalCallOutcomeMap = "EXECUTED_OPTIMISTIC",
  >(call: ExternalCall, waitUntil?: W): Promise<ExternalCallOutcomeMap[W]> {
    const actualWaitUntil = (waitUntil ?? "EXECUTED_OPTIMISTIC") as W
    const encoded = encodeExternalCall(call)

    const sentAtHeight =
      actualWaitUntil === "NONE"
        ? undefined
        : (await this.getBlock({ finality: "final" })).header.height

    const result = await this.call(
      "send_tx",
      {
        external_call_base64: base64.encode(encoded),
        wait_until: actualWaitUntil,
      },
      { retry: false },
    ).catch((error) => {
      if (error instanceof TimeoutError && sentAtHeight !== undefined) {
        throw new ExternalCallTimeoutError(
          call.contractId,
          externalCallHash(call),
          sentAtHeight,
          pendingUniqueId(error.data),
        )
      }
      throw error
    })

    const parsed = ExternalCallOutcomeSchema.parse(result)
    checkExternalCallOutcome(parsed, call.contractId)
    return parsed as ExternalCallOutcomeMap[W]
  }

  /**
   * Query a copy of an external call by its unique id via
   * `EXPERIMENTAL_tx_status`, with its receipts (nearcore >= 2.15).
   *
   * @param uniqueId - The copy's unique id (see `externalCallUniqueId`).
   * @param contractId - The contract the call went to.
   * @param waitUntil - Execution status level to wait for.
   *
   * @throws {UnknownTransactionError} With `waitUntil: "NONE"`, if the node
   * has no copy with this id.
   * @throws {ExternalCallRefusedError} If the copy was refused at execution.
   */
  async getExternalCallStatus<
    W extends keyof ExternalCallOutcomeWithReceiptsMap = "EXECUTED_OPTIMISTIC",
  >(
    uniqueId: string,
    contractId: string,
    waitUntil?: W,
  ): Promise<ExternalCallOutcomeWithReceiptsMap[W]> {
    const result = await this.call("EXPERIMENTAL_tx_status", {
      tx_hash: uniqueId,
      sender_account_id: contractId,
      wait_until: waitUntil ?? "EXECUTED_OPTIMISTIC",
    })
    if (transactionKind(result) === "signed") {
      throw new NearError(
        `${uniqueId} is a signed transaction, not an external call: use getTransactionStatus`,
        "NOT_AN_EXTERNAL_CALL",
      )
    }
    const parsed: ExternalCallOutcomeWithReceipts =
      ExternalCallOutcomeWithReceiptsSchema.parse(result)
    checkExternalCallOutcome(parsed, contractId)
    return parsed as ExternalCallOutcomeWithReceiptsMap[W]
  }

  /**
   * Get the protocol config via `EXPERIMENTAL_protocol_config`, including
   * the external call limits of nearcore 2.15
   * (`runtime_config.external_calls_config` and
   * `runtime_config.wasm_config.limit_config.max_gas_burnt_external`).
   *
   * @param options - Block reference. Defaults to the latest final block.
   */
  async getProtocolConfig(
    options?: BlockReference,
  ): Promise<ProtocolConfigResponse> {
    const result = await this.call(
      "EXPERIMENTAL_protocol_config",
      options?.blockId
        ? { block_id: options.blockId }
        : { finality: options?.finality || "final" },
    )
    return ProtocolConfigResponseSchema.parse(result)
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

    if (transactionKind(result) === "external_call") {
      throw new NearError(
        `${txHash} is an external call, not a signed transaction: use getExternalCallStatus`,
        "NOT_A_SIGNED_TRANSACTION",
      )
    }

    const parsed: FinalExecutionOutcomeWithReceipts =
      FinalExecutionOutcomeWithReceiptsSchema.parse(result)

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
      // A banned transfer to a universal account is reported over any other
      // failure (including contract panics in other receipts): it is the
      // protocol-level reason the transaction can't succeed.
      checkTransactionForUniversalAccountTransfer(parsed.status.Failure, [
        parsed.transaction_outcome,
        ...(parsed.receipts_outcome ?? []),
      ])
      checkOutcomesForReservedMethodName(parsed.receipts_outcome ?? [])

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

    // Safe cast: TypeScript guarantees W is a valid key, Zod validates the structure,
    // and waitUntil determines which variant we get from the RPC
    return parsed as FinalExecutionOutcomeWithReceiptsMap[W]
  }

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
  async receiptToTx(receiptId: string): Promise<ReceiptToTxResponse> {
    const result = await this.call("EXPERIMENTAL_receipt_to_tx", {
      receipt_id: receiptId,
    })

    return ReceiptToTxResponseSchema.parse(result)
  }

  /**
   * Get node status via `status`.
   */
  async getStatus(): Promise<StatusResponse> {
    const result = await this.call("status", [])
    return StatusResponseSchema.parse(result)
  }

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
  async getBlock(options?: BlockReference): Promise<BlockView> {
    const result = await this.call("block", {
      ...(options?.blockId
        ? { block_id: options.blockId }
        : { finality: options?.finality || "final" }),
    })

    return BlockViewSchema.parse(result)
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
  async viewState(
    accountId: string,
    options?: BlockReference & {
      prefix?: string
      afterKey?: string
      limit?: number
      includeProof?: boolean
    },
  ): Promise<ViewStateResult> {
    const result = await this.call("query", {
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

    // No access-key context: parseQueryError would otherwise misread a
    // "does not exist" error (missing account/contract) as an
    // AccessKeyDoesNotExistError. A view_state failure surfaces as a generic
    // query error instead.
    parseQueryError(result)

    return ViewStateResultSchema.parse(result)
  }

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
    let afterKey: string | undefined
    do {
      const page = await this.viewState(accountId, {
        ...options,
        ...(afterKey !== undefined ? { afterKey } : {}),
      })
      yield* page.values
      afterKey = page.last_key
    } while (afterKey !== undefined)
  }

  /**
   * Get the kinds of state changes in a block via `block_effects`
   * (stabilized in nearcore 2.13; falls back to the `EXPERIMENTAL_changes_in_block`
   * alias on older nodes).
   *
   * @param options - Block reference. Defaults to the latest final block.
   */
  async blockEffects(options?: BlockReference): Promise<BlockEffectsResponse> {
    const params = options?.blockId
      ? { block_id: options.blockId }
      : { finality: options?.finality || "final" }

    const result = await this.callWithExperimentalFallback(
      "block_effects",
      "EXPERIMENTAL_changes_in_block",
      params,
    )
    return BlockEffectsResponseSchema.parse(result)
  }

  /**
   * Get the network genesis configuration via `genesis_config` (stabilized in
   * nearcore 2.13; falls back to the `EXPERIMENTAL_genesis_config` alias on
   * older nodes).
   */
  async genesisConfig(): Promise<GenesisConfigResponse> {
    const result = await this.callWithExperimentalFallback(
      "genesis_config",
      "EXPERIMENTAL_genesis_config",
      [],
    )
    return GenesisConfigResponseSchema.parse(result)
  }

  /**
   * Get the upcoming maintenance windows (half-open block-height ranges) for a
   * validator account via `maintenance_windows` (stabilized in nearcore 2.13;
   * falls back to the `EXPERIMENTAL_maintenance_windows` alias on older nodes).
   *
   * @param accountId - Validator account ID.
   */
  async maintenanceWindows(
    accountId: string,
  ): Promise<MaintenanceWindowsResponse> {
    const result = await this.callWithExperimentalFallback(
      "maintenance_windows",
      "EXPERIMENTAL_maintenance_windows",
      { account_id: accountId },
    )
    return MaintenanceWindowsResponseSchema.parse(result)
  }

  /**
   * Call a method that was stabilized (renamed without the `EXPERIMENTAL_`
   * prefix) in a recent protocol version, retrying with the legacy
   * `EXPERIMENTAL_` alias if the node does not recognize the new name.
   * @internal
   */
  private async callWithExperimentalFallback<T = unknown>(
    method: string,
    experimentalMethod: string,
    params: unknown,
  ): Promise<T> {
    try {
      return await this.call<T>(method, params)
    } catch (error) {
      if (isMethodNotFound(error)) {
        return await this.call<T>(experimentalMethod, params)
      }
      throw error
    }
  }
}

/**
 * The `kind` of the transaction view in a tx status result: `"signed"` for a
 * view without `kind` (older nodes), `undefined` without a transaction.
 * @internal
 */
/**
 * The unique id in a `TIMEOUT_ERROR` whose cause is `PENDING`: the node saw a
 * copy land, short of the wait level asked for.
 */
function pendingUniqueId(info: unknown): string | undefined {
  if (typeof info !== "object" || info === null) return undefined
  const { cause, status } = info as { cause?: unknown; status?: unknown }
  if (cause !== "PENDING" || typeof status !== "object" || status === null) {
    return undefined
  }
  const { transaction_outcome, transaction } = status as {
    transaction_outcome?: { id?: unknown }
    transaction?: { transaction_id?: unknown }
  }
  const id = transaction_outcome?.id ?? transaction?.transaction_id
  return typeof id === "string" ? id : undefined
}

function transactionKind(result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined
  const transaction = (result as { transaction?: unknown }).transaction
  if (!transaction || typeof transaction !== "object") return undefined
  const kind = (transaction as { kind?: unknown }).kind
  return typeof kind === "string" ? kind : "signed"
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
function isMethodNotFound(error: unknown): boolean {
  if (error instanceof NetworkError && error.statusCode === -32601) {
    return true
  }
  const message = error instanceof Error ? error.message : String(error)
  return /method[\s_]not[\s_]found|-32601/i.test(message)
}
