import { inputEffect } from "../../effect/runtime.js"
import { base58, base64 } from "@scure/base"
import * as Config from "effect/Config"
import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Ref from "effect/Ref"
import * as Schedule from "effect/Schedule"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import type { z } from "zod"
import * as Protocol from "../../effect/protocol-schemas.js"
import { ExternalError } from "../../effect/runtime.js"
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
import type { RpcFailure, RpcFetch, RpcRequest, RpcRetryConfig } from "./rpc.js"
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

/** Configuration and state are owned by the native service, not a Promise adapter. */
export interface RpcProgramConfig {
  readonly url: string
  readonly headers?: Record<string, string>
  readonly retry?: RpcRetryConfigInput
}

export interface RpcTransportService {
  readonly execute: (
    url: string,
    headers: Record<string, string>,
    request: RpcRequest,
  ) => Effect.Effect<
    { readonly status: number; readonly data: unknown },
    NearError
  >
}

export interface RpcPrograms {
  readonly call: <T = unknown>(
    method: string,
    params: unknown,
  ) => Effect.Effect<T, RpcFailure>
  readonly query: <T = unknown>(
    path: string,
    data: string | Uint8Array,
  ) => Effect.Effect<T, RpcFailure>
  readonly viewFunction: (
    contractId: string,
    methodName: string,
    args?: unknown,
    options?: BlockReference,
  ) => Effect.Effect<ViewFunctionCallResult, RpcFailure>
  readonly getAccount: (
    accountId: string,
    options?: BlockReference,
  ) => Effect.Effect<AccountView, RpcFailure>
  readonly viewCode: (
    accountId: string,
    options?: BlockReference,
  ) => Effect.Effect<ContractCodeView, RpcFailure>
  readonly viewGlobalContractCode: (
    contract: GlobalContractReference,
    options?: BlockReference,
  ) => Effect.Effect<ContractCodeView, RpcFailure>
  readonly getAccessKey: (
    accountId: string,
    publicKey: string,
    options?: BlockReference,
  ) => Effect.Effect<AccessKeyView, RpcFailure>
  readonly getAccessKeys: (
    accountId: string,
    options?: BlockReference,
  ) => Effect.Effect<AccessKeyListResponse, RpcFailure>
  readonly getGasKeyNonces: (
    accountId: string,
    publicKey: string,
    options?: BlockReference,
  ) => Effect.Effect<GasKeyNoncesResponse, RpcFailure>
  readonly sendTransaction: <
    W extends keyof FinalExecutionOutcomeMap = "EXECUTED_OPTIMISTIC",
  >(
    signedTransaction: Uint8Array,
    waitUntil?: W,
  ) => Effect.Effect<FinalExecutionOutcomeMap[W], RpcFailure>
  readonly getTransactionStatus: <
    W extends keyof FinalExecutionOutcomeWithReceiptsMap =
      "EXECUTED_OPTIMISTIC",
  >(
    txHash: string,
    senderAccountId: string,
    waitUntil?: W,
  ) => Effect.Effect<FinalExecutionOutcomeWithReceiptsMap[W], RpcFailure>
  readonly receiptToTx: (
    receiptId: string,
  ) => Effect.Effect<ReceiptToTxResponse, RpcFailure>
  // oxlint-disable-next-line effecttsgo/lazy-effect -- Uniform service methods follow the required Kit service convention.
  readonly getStatus: () => Effect.Effect<StatusResponse, RpcFailure>
  readonly getBlock: (
    options?: BlockReference,
  ) => Effect.Effect<BlockView, RpcFailure>
  readonly getGasPrice: (
    blockId?: string | null,
  ) => Effect.Effect<GasPriceResponse, RpcFailure>
  readonly viewState: (
    accountId: string,
    options?: BlockReference & {
      prefix?: string
      afterKey?: string
      limit?: number
      includeProof?: boolean
    },
  ) => Effect.Effect<ViewStateResult, RpcFailure>
  readonly blockEffects: (
    options?: BlockReference,
  ) => Effect.Effect<BlockEffectsResponse, RpcFailure>
  // oxlint-disable-next-line effecttsgo/lazy-effect -- Uniform service methods follow the required Kit service convention.
  readonly genesisConfig: () => Effect.Effect<GenesisConfigResponse, RpcFailure>
  readonly maintenanceWindows: (
    accountId: string,
  ) => Effect.Effect<MaintenanceWindowsResponse, RpcFailure>
  readonly viewStateAll: (
    accountId: string,
    options?: BlockReference & { prefix?: string; limit?: number },
  ) => Stream.Stream<StateItem, RpcFailure>
}

export const makeRpcPrograms = Effect.fn("Rpc.make")(function* (
  config: RpcProgramConfig,
  transport: RpcTransportService,
) {
  const requestIds = yield* Ref.make(0)
  return programsWithState(config, transport, requestIds)
})

/** Synchronous construction only at the synchronous public Near constructor boundary. */
export const makeRpcProgramsUnsafe = (
  config: RpcProgramConfig,
  transport: RpcTransportService,
): RpcPrograms => programsWithState(config, transport, Ref.makeUnsafe(0))

const programFactories = new WeakMap<
  RpcPrograms,
  (call: RpcPrograms["call"]) => RpcPrograms
>()

/** Derive native middleware without replacing request-id ownership. */
export const withRpcCall = (
  programs: RpcPrograms,
  call: RpcPrograms["call"],
): RpcPrograms =>
  programFactories.get(programs)?.(call) ?? { ...programs, call }

/** Preserve construction metadata when exposing one native service under a tag. */
export const aliasRpcPrograms = <A extends RpcPrograms>(
  alias: A,
  original: RpcPrograms,
): A => {
  const factory = programFactories.get(original)
  if (factory) programFactories.set(alias, factory)
  return alias
}

function programsWithState(
  config: RpcProgramConfig,
  transport: RpcTransportService,
  requestIds: Ref.Ref<number>,
  callOverride?: RpcPrograms["call"],
): RpcPrograms {
  const retryConfig: RpcRetryConfig = {
    maxRetries: config.retry?.maxRetries ?? 4,
    initialDelayMs: config.retry?.initialDelayMs ?? 1000,
  }
  const rawCall = Effect.fn("Rpc.call")(function* <T = unknown>(
    method: string,
    params: unknown,
  ): Effect.fn.Return<T, RpcFailure> {
    const request: RpcRequest = {
      jsonrpc: "2.0",
      id: yield* Ref.updateAndGet(requestIds, (id) => id + 1),
      method,
      params,
    }
    const attempt = Effect.fn("Rpc.request")(function* (): Effect.fn.Return<
      T,
      RpcFailure
    > {
      yield* debugRpc("Request", request)
      // One interruptible transport boundary owns both fetch and body consumption.
      // Aborting after headers have arrived must still cancel the response body.
      const { status, data } = yield* transport.execute(
        config.url,
        config.headers || {},
        request,
      )
      yield* debugRpc("Response", data)
      const envelope = yield* Schema.decodeUnknownEffect(RpcEnvelopeSchema)(
        data,
      ).pipe(
        Effect.mapError(
          () => new NetworkError("RPC response missing result field"),
        ),
      )
      if (envelope.error)
        return yield* domainEffect(() => parseRpcError(envelope.error, status))
      if (envelope.result === undefined)
        return yield* Effect.fail(
          new NetworkError("RPC response missing result field"),
        )
      // call<T> is intentionally the existing unvalidated raw-RPC escape hatch.
      // Typed methods below always decode their own complete protocol contract.
      return envelope.result as T
    })
    return yield* attempt().pipe(
      Effect.retry({
        schedule: Schedule.exponential(retryConfig.initialDelayMs).pipe(
          Schedule.upTo({ times: retryConfig.maxRetries }),
        ),
        while: (error) => "retryable" in error && error.retryable === true,
      }),
    )
  })

  const call = callOverride ?? rawCall

  const query = Effect.fn("Rpc.query")(function* <T = unknown>(
    path: string,
    data: string | Uint8Array,
  ): Effect.fn.Return<T, RpcFailure> {
    return yield* call<T>("query", {
      request_type: path,
      finality: "final",
      args_base64:
        typeof data === "string"
          ? data
          : yield* inputEffect(() => base64.encode(data), "Rpc.query.encoding"),
    })
  })

  const viewFunction = Effect.fn("Rpc.viewFunction")(function* (
    contractId: string,
    methodName: string,
    args: unknown = {},
    options?: BlockReference,
  ): Effect.fn.Return<ViewFunctionCallResult, RpcFailure> {
    const argsBase64 = yield* inputEffect(
      () =>
        base64.encode(
          args instanceof Uint8Array
            ? args
            : new TextEncoder().encode(JSON.stringify(args)),
        ),
      "Rpc.viewFunction.arguments",
    )
    const result = yield* call("query", {
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
  })

  const getAccount = Effect.fn("Rpc.getAccount")(function* (
    accountId: string,
    options?: BlockReference,
  ): Effect.fn.Return<AccountView, RpcFailure> {
    const result = yield* call("query", {
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
  })

  const viewCode = Effect.fn("Rpc.viewCode")(function* (
    accountId: string,
    options?: BlockReference,
  ): Effect.fn.Return<ContractCodeView, RpcFailure> {
    const result = yield* call("query", {
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
  })

  const viewGlobalContractCode = Effect.fn("Rpc.viewGlobalContractCode")(
    function* (
      contract: GlobalContractReference,
      options?: BlockReference,
    ): Effect.fn.Return<ContractCodeView, RpcFailure> {
      const request = yield* inputEffect(
        () =>
          "accountId" in contract
            ? {
                request_type: "view_global_contract_code_by_account_id",
                account_id: contract.accountId,
              }
            : {
                request_type: "view_global_contract_code",
                code_hash: normalizeCodeHash(contract.codeHash),
              },
        "Rpc.globalContract.reference",
      )
      const result = yield* call("query", {
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

  const getAccessKey = Effect.fn("Rpc.getAccessKey")(function* (
    accountId: string,
    publicKey: string,
    options?: BlockReference,
  ): Effect.fn.Return<AccessKeyView, RpcFailure> {
    const result = yield* call("query", {
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
  })

  const getAccessKeys = Effect.fn("Rpc.getAccessKeys")(function* (
    accountId: string,
    options?: BlockReference,
  ): Effect.fn.Return<AccessKeyListResponse, RpcFailure> {
    const result = yield* call("query", {
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
  })

  const getGasKeyNonces = Effect.fn("Rpc.getGasKeyNonces")(function* (
    accountId: string,
    publicKey: string,
    options?: BlockReference,
  ): Effect.fn.Return<GasKeyNoncesResponse, RpcFailure> {
    // Unlike view_access_key (whose "does not exist" arrives in `result.error`),
    // view_gas_key_nonces reports a missing gas key as a typed UNKNOWN_GAS_KEY
    // JSON-RPC error. parseRpcError already maps that to AccessKeyDoesNotExistError
    // but nearcore only echoes the public key, so we re-key it with the queried
    // account for a complete error.
    const result = yield* call("query", {
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
  })

  const sendTransaction = Effect.fn("Rpc.sendTransaction")(function* <
    W extends keyof FinalExecutionOutcomeMap = "EXECUTED_OPTIMISTIC",
  >(
    signedTransaction: Uint8Array,
    waitUntil?: W,
  ): Effect.fn.Return<FinalExecutionOutcomeMap[W], RpcFailure> {
    const actualWaitUntil = (waitUntil ?? "EXECUTED_OPTIMISTIC") as W
    const base64Encoded = yield* inputEffect(
      () => base64.encode(signedTransaction),
      "Rpc.sendTransaction.encoding",
    )
    // Use send_tx with wait_until parameter instead of deprecated broadcast_tx_commit
    const result = yield* call("send_tx", {
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

  const getTransactionStatus = Effect.fn("Rpc.getTransactionStatus")(function* <
    W extends keyof FinalExecutionOutcomeWithReceiptsMap =
      "EXECUTED_OPTIMISTIC",
  >(
    txHash: string,
    senderAccountId: string,
    waitUntil?: W,
  ): Effect.fn.Return<FinalExecutionOutcomeWithReceiptsMap[W], RpcFailure> {
    const actualWaitUntil = (waitUntil ?? "EXECUTED_OPTIMISTIC") as W
    // Call EXPERIMENTAL_tx_status with wait_until parameter
    const result = yield* call("EXPERIMENTAL_tx_status", {
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

  const receiptToTx = Effect.fn("Rpc.receiptToTx")(function* (
    receiptId: string,
  ): Effect.fn.Return<ReceiptToTxResponse, RpcFailure> {
    const result = yield* call("EXPERIMENTAL_receipt_to_tx", {
      receipt_id: receiptId,
    })
    return yield* decodeRpc(
      Protocol.ReceiptToTxResponseSchema,
      ReceiptToTxResponseSchema,
      result,
    )
  })

  const getStatus = Effect.fn("Rpc.getStatus")(function* (): Effect.fn.Return<
    StatusResponse,
    RpcFailure
  > {
    const result = yield* call("status", [])
    return yield* decodeRpc(
      Protocol.StatusResponseSchema,
      StatusResponseSchema,
      result,
    )
  })

  const getBlock = Effect.fn("Rpc.getBlock")(function* (
    options?: BlockReference,
  ): Effect.fn.Return<BlockView, RpcFailure> {
    const result = yield* call(
      "block",
      options?.blockId
        ? { block_id: options.blockId }
        : { finality: options?.finality || "final" },
    )
    return yield* decodeRpc(Protocol.BlockViewSchema, BlockViewSchema, result)
  })

  const getGasPrice = Effect.fn("Rpc.getGasPrice")(function* (
    blockId: string | null = null,
  ): Effect.fn.Return<GasPriceResponse, RpcFailure> {
    const result = yield* call("gas_price", [blockId])
    return yield* decodeRpc(
      Protocol.GasPriceResponseSchema,
      GasPriceResponseSchema,
      result,
    )
  })

  const viewState = Effect.fn("Rpc.viewState")(function* (
    accountId: string,
    options?: BlockReference & {
      prefix?: string
      afterKey?: string
      limit?: number
      includeProof?: boolean
    },
  ): Effect.fn.Return<ViewStateResult, RpcFailure> {
    const result = yield* call("query", {
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
  })

  const blockEffects = Effect.fn("Rpc.blockEffects")(function* (
    options?: BlockReference,
  ): Effect.fn.Return<BlockEffectsResponse, RpcFailure> {
    const params = options?.blockId
      ? { block_id: options.blockId }
      : { finality: options?.finality || "final" }
    const result = yield* callWithExperimentalFallback(
      "block_effects",
      "EXPERIMENTAL_changes_in_block",
      params,
    )
    return yield* decodeRpc(
      Protocol.BlockEffectsResponseSchema,
      BlockEffectsResponseSchema,
      result,
    )
  })

  const genesisConfig = Effect.fn("Rpc.genesisConfig")(
    function* (): Effect.fn.Return<GenesisConfigResponse, RpcFailure> {
      const result = yield* callWithExperimentalFallback(
        "genesis_config",
        "EXPERIMENTAL_genesis_config",
        [],
      )
      return yield* decodeRpc(
        Protocol.GenesisConfigResponseSchema,
        GenesisConfigResponseSchema,
        result,
      )
    },
  )

  const maintenanceWindows = Effect.fn("Rpc.maintenanceWindows")(function* (
    accountId: string,
  ): Effect.fn.Return<MaintenanceWindowsResponse, RpcFailure> {
    const result = yield* callWithExperimentalFallback(
      "maintenance_windows",
      "EXPERIMENTAL_maintenance_windows",
      { account_id: accountId },
    )
    return yield* decodeRpc(
      Protocol.MaintenanceWindowsResponseSchema,
      MaintenanceWindowsResponseSchema,
      result,
    )
  })

  const callWithExperimentalFallback = Effect.fn(
    "Rpc.callWithExperimentalFallback",
  )(function* <T = unknown>(
    method: string,
    experimentalMethod: string,
    params: unknown,
  ): Effect.fn.Return<T, RpcFailure> {
    return yield* call<T>(method, params).pipe(
      Effect.catchIf(isMethodNotFound, () =>
        call<T>(experimentalMethod, params),
      ),
    )
  })

  const viewStateAll = (
    accountId: string,
    options?: BlockReference & { prefix?: string; limit?: number },
  ): Stream.Stream<StateItem, RpcFailure> => {
    return Stream.paginate<string | undefined, StateItem, RpcFailure>(
      undefined,
      (afterKey) =>
        viewState(accountId, {
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
  const programs: RpcPrograms = {
    call,
    query,
    viewFunction,
    getAccount,
    viewCode,
    viewGlobalContractCode,
    getAccessKey,
    getAccessKeys,
    getGasKeyNonces,
    sendTransaction,
    getTransactionStatus,
    receiptToTx,
    getStatus,
    getBlock,
    getGasPrice,
    viewState,
    blockEffects,
    genesisConfig,
    maintenanceWindows,
    viewStateAll,
  }
  programFactories.set(programs, (call) =>
    programsWithState(config, transport, requestIds, call),
  )
  return programs
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

export function transportError(error: unknown): NearError {
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

const debugRpc = Effect.fn("Rpc.debug")(function* (
  direction: "Request" | "Response",
  value: unknown,
) {
  const enabled = yield* Config.String("NEAR_RPC_DEBUG").pipe(
    Config.withDefault(""),
    Effect.orDie,
  )
  if (enabled === "true") {
    const json = yield* Effect.try({
      try: () => JSON.stringify(value, null, 2),
      catch: transportError,
    })
    yield* Console.log(`[RPC ${direction}]`, json)
  }
})

function rpcFailureCause(error: unknown): unknown {
  return error instanceof ExternalError ? error.cause : error
}

/**
 * A single interruptible fetch boundary owns headers and body consumption.
 * Kept for the Promise API's exact URL/header/statusText compatibility and for
 * libraries avoiding an implicit dependency on an unstable HTTP stack.
 */
export const fetchTransport = (fetch: RpcFetch): RpcTransportService => ({
  execute: Effect.fn("RpcTransport.fetch")(function* (
    url: string,
    headers: Record<string, string>,
    request: RpcRequest,
  ) {
    return yield* Effect.tryPromise({
      try: async (signal) => {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headers },
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
            /* Preserve the primary HTTP failure. */
          }
          throw error
        }
        const data: unknown = await response.json()
        return { status: response.status, data }
      },
      catch: transportError,
    })
  }),
})
