import { fromSync } from "../../effect/runtime.js"
import { base58, base64 } from "@scure/base"
import * as Config from "effect/Config"
import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Ref from "effect/Ref"
import * as Schedule from "effect/Schedule"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as Protocol from "../../effect/protocol-schemas.js"
import {
  AccessKeyDoesNotExistError,
  GlobalContractNotFoundError,
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
  parseExecutionError,
  isRetryableStatus,
  parseQueryError,
  parseRpcError,
} from "./rpc-error-handler.js"

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
  const debug = yield* rpcDebug
  return programsWithState(config, transport, requestIds, debug)
})

/** Synchronous construction only at the synchronous public Near constructor boundary. */
export const makeRpcProgramsUnsafe = (
  config: RpcProgramConfig,
  transport: RpcTransportService,
): RpcPrograms =>
  programsWithState(
    config,
    transport,
    Ref.makeUnsafe(0),
    Effect.runSync(rpcDebug),
  )

interface RpcState {
  readonly config: RpcProgramConfig
  readonly transport: RpcTransportService
  readonly requestIds: Ref.Ref<number>
  readonly retryConfig: RpcRetryConfig
  readonly debug: boolean
}

function programsWithState(
  config: RpcProgramConfig,
  transport: RpcTransportService,
  requestIds: Ref.Ref<number>,
  debug: boolean,
): RpcPrograms {
  const state: RpcState = {
    config,
    transport,
    requestIds,
    debug,
    retryConfig: {
      maxRetries: config.retry?.maxRetries ?? 4,
      initialDelayMs: config.retry?.initialDelayMs ?? 1000,
    },
  }
  return {
    call: (...args) => call(state, ...args),
    query: (...args) => query(state, ...args),
    viewFunction: (...args) => viewFunction(state, ...args),
    getAccount: (...args) => getAccount(state, ...args),
    viewCode: (...args) => viewCode(state, ...args),
    viewGlobalContractCode: (...args) => viewGlobalContractCode(state, ...args),
    getAccessKey: (...args) => getAccessKey(state, ...args),
    getAccessKeys: (...args) => getAccessKeys(state, ...args),
    getGasKeyNonces: (...args) => getGasKeyNonces(state, ...args),
    sendTransaction: (...args) => sendTransaction(state, ...args),
    getTransactionStatus: (...args) => getTransactionStatus(state, ...args),
    receiptToTx: (...args) => receiptToTx(state, ...args),
    getStatus: (...args) => getStatus(state, ...args),
    getBlock: (...args) => getBlock(state, ...args),
    getGasPrice: (...args) => getGasPrice(state, ...args),
    viewState: (...args) => viewState(state, ...args),
    blockEffects: (...args) => blockEffects(state, ...args),
    genesisConfig: (...args) => genesisConfig(state, ...args),
    maintenanceWindows: (...args) => maintenanceWindows(state, ...args),
    viewStateAll: (...args) => viewStateAll(state, ...args),
  }
}

const requestRpc = Effect.fn("Rpc.request")(function* <T = unknown>(
  state: RpcState,
  request: RpcRequest,
): Effect.fn.Return<T, RpcFailure> {
  if (state.debug) yield* debugRpc("Request", request)
  // One interruptible transport boundary owns both fetch and body consumption.
  // Aborting after headers have arrived must still cancel the response body.
  const { status, data } = yield* state.transport.execute(
    state.config.url,
    state.config.headers || {},
    request,
  )
  if (state.debug) yield* debugRpc("Response", data)
  const envelope = yield* Schema.decodeUnknownEffect(RpcEnvelopeSchema)(
    data,
  ).pipe(
    Effect.mapError(
      () => new NetworkError("RPC response missing result field"),
    ),
  )
  if (envelope.error)
    return yield* Effect.fail(parseRpcError(envelope.error, status))
  if (envelope.result === undefined)
    return yield* Effect.fail(
      new NetworkError("RPC response missing result field"),
    )
  // call<T> is intentionally the existing unvalidated raw-RPC escape hatch.
  // Typed methods below always decode their own complete protocol contract.
  return envelope.result as T
})

const call = Effect.fn("Rpc.call")(function* <T = unknown>(
  state: RpcState,
  method: string,
  params: unknown,
): Effect.fn.Return<T, RpcFailure> {
  const request: RpcRequest = {
    jsonrpc: "2.0",
    id: yield* Ref.updateAndGet(state.requestIds, (id) => id + 1),
    method,
    params,
  }

  return yield* requestRpc<T>(state, request).pipe(
    Effect.retry({
      schedule: Schedule.exponential(state.retryConfig.initialDelayMs).pipe(
        Schedule.upTo({ times: state.retryConfig.maxRetries }),
      ),
      while: (error) => "retryable" in error && error.retryable === true,
    }),
  )
})

const query = Effect.fn("Rpc.query")(function* <T = unknown>(
  state: RpcState,
  path: string,
  data: string | Uint8Array,
): Effect.fn.Return<T, RpcFailure> {
  return yield* call<T>(state, "query", {
    request_type: path,
    finality: "final",
    args_base64:
      typeof data === "string"
        ? data
        : yield* fromSync(() => base64.encode(data), "Rpc.query.encoding"),
  })
})

const viewFunction = Effect.fn("Rpc.viewFunction")(function* (
  state: RpcState,
  contractId: string,
  methodName: string,
  args: unknown = {},
  options?: BlockReference,
): Effect.fn.Return<ViewFunctionCallResult, RpcFailure> {
  const argsBase64 = yield* fromSync(
    () =>
      base64.encode(
        args instanceof Uint8Array
          ? args
          : new TextEncoder().encode(JSON.stringify(args)),
      ),
    "Rpc.viewFunction.arguments",
  )
  const result = yield* call(state, "query", {
    request_type: "call_function",
    ...blockReference(options, "final"),
    account_id: contractId,
    method_name: methodName,
    args_base64: argsBase64,
  })
  const queryError = parseQueryError(result, { contractId, methodName })
  if (queryError) return yield* Effect.fail(queryError)
  return yield* Schema.decodeUnknownEffect(
    Protocol.ViewFunctionCallResultSchema,
  )(result)
})

const getAccount = Effect.fn("Rpc.getAccount")(function* (
  state: RpcState,
  accountId: string,
  options?: BlockReference,
): Effect.fn.Return<AccountView, RpcFailure> {
  const result = yield* call(state, "query", {
    request_type: "view_account",
    ...blockReference(options, "optimistic"),
    account_id: accountId,
  })
  return yield* Schema.decodeUnknownEffect(Protocol.AccountViewSchema)(result)
})

const viewCode = Effect.fn("Rpc.viewCode")(function* (
  state: RpcState,
  accountId: string,
  options?: BlockReference,
): Effect.fn.Return<ContractCodeView, RpcFailure> {
  const result = yield* call(state, "query", {
    request_type: "view_code",
    ...blockReference(options, "optimistic"),
    account_id: accountId,
  })
  return yield* Schema.decodeUnknownEffect(Protocol.ContractCodeViewSchema)(
    result,
  )
})

const viewGlobalContractCode = Effect.fn("Rpc.viewGlobalContractCode")(
  function* (
    state: RpcState,
    contract: GlobalContractReference,
    options?: BlockReference,
  ): Effect.fn.Return<ContractCodeView, RpcFailure> {
    const request = yield* fromSync(
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
    const result = yield* call(state, "query", {
      ...request,
      ...blockReference(options, "optimistic"),
    }).pipe(
      Effect.mapError((error) => {
        // nearcore echoes the identifier in the error payload, but its shape
        // varies across node versions — re-key with the caller-known reference
        // so the error is always complete.
        if (error instanceof GlobalContractNotFoundError) {
          return new GlobalContractNotFoundError(
            "accountId" in contract
              ? { accountId: contract.accountId }
              : { codeHash: normalizeCodeHash(contract.codeHash) },
          )
        }
        return error
      }),
    )
    return yield* Schema.decodeUnknownEffect(Protocol.ContractCodeViewSchema)(
      result,
    )
  },
)

const getAccessKey = Effect.fn("Rpc.getAccessKey")(function* (
  state: RpcState,
  accountId: string,
  publicKey: string,
  options?: BlockReference,
): Effect.fn.Return<AccessKeyView, RpcFailure> {
  const result = yield* call(state, "query", {
    request_type: "view_access_key",
    ...blockReference(options, "optimistic"),
    account_id: accountId,
    public_key: publicKey,
  })
  const queryError = parseQueryError(result, { accountId, publicKey })
  if (queryError) return yield* Effect.fail(queryError)
  return yield* Schema.decodeUnknownEffect(Protocol.AccessKeyViewSchema)(result)
})

const getAccessKeys = Effect.fn("Rpc.getAccessKeys")(function* (
  state: RpcState,
  accountId: string,
  options?: BlockReference,
): Effect.fn.Return<AccessKeyListResponse, RpcFailure> {
  const result = yield* call(state, "query", {
    request_type: "view_access_key_list",
    ...blockReference(options, "optimistic"),
    account_id: accountId,
  })
  return yield* Schema.decodeUnknownEffect(
    Protocol.AccessKeyListResponseSchema,
  )(result)
})

const getGasKeyNonces = Effect.fn("Rpc.getGasKeyNonces")(function* (
  state: RpcState,
  accountId: string,
  publicKey: string,
  options?: BlockReference,
): Effect.fn.Return<GasKeyNoncesResponse, RpcFailure> {
  // Unlike view_access_key (whose "does not exist" arrives in `result.error`),
  // view_gas_key_nonces reports a missing gas key as a typed UNKNOWN_GAS_KEY
  // JSON-RPC error. parseRpcError already maps that to AccessKeyDoesNotExistError
  // but nearcore only echoes the public key, so we re-key it with the queried
  // account for a complete error.
  const result = yield* call(state, "query", {
    request_type: "view_gas_key_nonces",
    ...blockReference(options, "optimistic"),
    account_id: accountId,
    public_key: publicKey,
  }).pipe(
    Effect.mapError((error) => {
      if (error instanceof AccessKeyDoesNotExistError) {
        return new AccessKeyDoesNotExistError(accountId, publicKey)
      }
      return error
    }),
  )
  return yield* Schema.decodeUnknownEffect(Protocol.GasKeyNoncesResponseSchema)(
    result,
  )
})

const sendTransaction = Effect.fn("Rpc.sendTransaction")(function* <
  W extends keyof FinalExecutionOutcomeMap = "EXECUTED_OPTIMISTIC",
>(
  state: RpcState,
  signedTransaction: Uint8Array,
  waitUntil?: W,
): Effect.fn.Return<FinalExecutionOutcomeMap[W], RpcFailure> {
  const actualWaitUntil = (waitUntil ?? "EXECUTED_OPTIMISTIC") as W
  const base64Encoded = yield* fromSync(
    () => base64.encode(signedTransaction),
    "Rpc.sendTransaction.encoding",
  )
  // Use send_tx with wait_until parameter instead of deprecated broadcast_tx_commit
  const result = yield* call(state, "send_tx", {
    signed_tx_base64: base64Encoded,
    wait_until: actualWaitUntil,
  })
  const parsed: FinalExecutionOutcome = yield* Schema.decodeUnknownEffect(
    Protocol.FinalExecutionOutcomeSchema,
  )(result)
  if (
    parsed.final_execution_status !== "NONE" &&
    parsed.final_execution_status !== "INCLUDED" &&
    parsed.final_execution_status !== "INCLUDED_FINAL"
  ) {
    const error = parseExecutionError(parsed)
    if (error) return yield* Effect.fail(error)
  }
  // Safe cast: TypeScript guarantees W is a valid key, Schema validates the structure,
  // and waitUntil determines which variant we get from the RPC
  return parsed as FinalExecutionOutcomeMap[W]
})

const getTransactionStatus = Effect.fn("Rpc.getTransactionStatus")(function* <
  W extends keyof FinalExecutionOutcomeWithReceiptsMap = "EXECUTED_OPTIMISTIC",
>(
  state: RpcState,
  txHash: string,
  senderAccountId: string,
  waitUntil?: W,
): Effect.fn.Return<FinalExecutionOutcomeWithReceiptsMap[W], RpcFailure> {
  const actualWaitUntil = (waitUntil ?? "EXECUTED_OPTIMISTIC") as W
  // Call EXPERIMENTAL_tx_status with wait_until parameter
  const result = yield* call(state, "EXPERIMENTAL_tx_status", {
    tx_hash: txHash,
    sender_account_id: senderAccountId,
    wait_until: actualWaitUntil,
  })
  const parsed: FinalExecutionOutcomeWithReceipts =
    yield* Schema.decodeUnknownEffect(
      Protocol.FinalExecutionOutcomeWithReceiptsSchema,
    )(result)
  // Status polling can include terminal failures even at an early wait level.
  const error = parseExecutionError(parsed)
  if (error) return yield* Effect.fail(error)
  // Safe cast: TypeScript guarantees W is a valid key, Schema validates the structure,
  // and waitUntil determines which variant we get from the RPC
  return parsed as FinalExecutionOutcomeWithReceiptsMap[W]
})

const receiptToTx = Effect.fn("Rpc.receiptToTx")(function* (
  state: RpcState,
  receiptId: string,
): Effect.fn.Return<ReceiptToTxResponse, RpcFailure> {
  const result = yield* call(state, "EXPERIMENTAL_receipt_to_tx", {
    receipt_id: receiptId,
  })
  return yield* Schema.decodeUnknownEffect(Protocol.ReceiptToTxResponseSchema)(
    result,
  )
})

const getStatus = Effect.fn("Rpc.getStatus")(function* (
  state: RpcState,
): Effect.fn.Return<StatusResponse, RpcFailure> {
  const result = yield* call(state, "status", [])
  return yield* Schema.decodeUnknownEffect(Protocol.StatusResponseSchema)(
    result,
  )
})

const getBlock = Effect.fn("Rpc.getBlock")(function* (
  state: RpcState,
  options?: BlockReference,
): Effect.fn.Return<BlockView, RpcFailure> {
  const result = yield* call(state, "block", blockReference(options, "final"))
  return yield* Schema.decodeUnknownEffect(Protocol.BlockViewSchema)(result)
})

const getGasPrice = Effect.fn("Rpc.getGasPrice")(function* (
  state: RpcState,
  blockId: string | null = null,
): Effect.fn.Return<GasPriceResponse, RpcFailure> {
  const result = yield* call(state, "gas_price", [blockId])
  return yield* Schema.decodeUnknownEffect(Protocol.GasPriceResponseSchema)(
    result,
  )
})

const viewState = Effect.fn("Rpc.viewState")(function* (
  state: RpcState,
  accountId: string,
  options?: BlockReference & {
    prefix?: string
    afterKey?: string
    limit?: number
    includeProof?: boolean
  },
): Effect.fn.Return<ViewStateResult, RpcFailure> {
  const result = yield* call(state, "query", {
    request_type: "view_state",
    ...blockReference(options, "optimistic"),
    account_id: accountId,
    prefix_base64: options?.prefix ?? "",
    ...(options?.afterKey !== undefined
      ? { after_key_base64: options.afterKey }
      : {}),
    ...(options?.limit !== undefined ? { limit: options.limit } : {}),
    ...(options?.includeProof ? { include_proof: true } : {}),
  })
  const queryError = parseQueryError(result)
  if (queryError) return yield* Effect.fail(queryError)
  return yield* Schema.decodeUnknownEffect(Protocol.ViewStateResultSchema)(
    result,
  )
})

const blockEffects = Effect.fn("Rpc.blockEffects")(function* (
  state: RpcState,
  options?: BlockReference,
): Effect.fn.Return<BlockEffectsResponse, RpcFailure> {
  const params = blockReference(options, "final")
  const result = yield* callWithExperimentalFallback(
    state,
    "block_effects",
    "EXPERIMENTAL_changes_in_block",
    params,
  )
  return yield* Schema.decodeUnknownEffect(Protocol.BlockEffectsResponseSchema)(
    result,
  )
})

const genesisConfig = Effect.fn("Rpc.genesisConfig")(function* (
  state: RpcState,
): Effect.fn.Return<GenesisConfigResponse, RpcFailure> {
  const result = yield* callWithExperimentalFallback(
    state,
    "genesis_config",
    "EXPERIMENTAL_genesis_config",
    [],
  )
  return yield* Schema.decodeUnknownEffect(
    Protocol.GenesisConfigResponseSchema,
  )(result)
})

const maintenanceWindows = Effect.fn("Rpc.maintenanceWindows")(function* (
  state: RpcState,
  accountId: string,
): Effect.fn.Return<MaintenanceWindowsResponse, RpcFailure> {
  const result = yield* callWithExperimentalFallback(
    state,
    "maintenance_windows",
    "EXPERIMENTAL_maintenance_windows",
    { account_id: accountId },
  )
  return yield* Schema.decodeUnknownEffect(
    Protocol.MaintenanceWindowsResponseSchema,
  )(result)
})

const callWithExperimentalFallback = Effect.fn(
  "Rpc.callWithExperimentalFallback",
)(function* <T = unknown>(
  state: RpcState,
  method: string,
  experimentalMethod: string,
  params: unknown,
): Effect.fn.Return<T, RpcFailure> {
  return yield* call<T>(state, method, params).pipe(
    Effect.catchIf(isMethodNotFound, () =>
      call<T>(state, experimentalMethod, params),
    ),
  )
})

const viewStateAll = (
  state: RpcState,
  accountId: string,
  options?: BlockReference & { prefix?: string; limit?: number },
): Stream.Stream<StateItem, RpcFailure> => {
  return Stream.paginate<string | undefined, StateItem, RpcFailure>(
    undefined,
    (afterKey) =>
      viewState(state, accountId, {
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
  const error = failure
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

export function transportError(error: unknown): NearError {
  if (error instanceof NearError) return error
  return new NetworkError(
    `Network request failed: ${error instanceof Error ? error.message : String(error)}`,
    undefined,
    true,
  )
}

/** Snapshot debug configuration once at service acquisition. */
const rpcDebug = Config.String("NEAR_RPC_DEBUG").pipe(
  Config.withDefault(""),
  Effect.map((value) => value === "true"),
  Effect.orDie,
)

const debugRpc = Effect.fn("Rpc.debug")(function* (
  direction: "Request" | "Response",
  value: unknown,
) {
  const json = yield* Effect.try({
    try: () => JSON.stringify(value, null, 2),
    catch: transportError,
  })
  yield* Console.log(`[RPC ${direction}]`, json)
})

/**
 * A single interruptible fetch boundary owns headers and body consumption.
 * Kept for the Promise API's exact URL/header/statusText compatibility and for
 * libraries avoiding an implicit dependency on an unstable HTTP stack.
 */
export const fetchTransport = (fetch: RpcFetch): RpcTransportService => ({
  execute: (...args) => executeFetch(fetch, ...args),
})

const executeFetch = Effect.fn("RpcTransport.fetch")(function* (
  fetch: RpcFetch,
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
})

function blockReference(
  options: BlockReference | undefined,
  finality: "final" | "optimistic",
) {
  return options?.blockId
    ? { block_id: options.blockId }
    : { finality: options?.finality || finality }
}
