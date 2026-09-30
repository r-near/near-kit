/** The sole Promise boundary for the public Near.rpc API. */
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import type { z } from "zod"
import { ExternalError, fromPromise, runPromise } from "../../effect/runtime.js"
import type { NearError } from "../../errors/index.js"
import type { BlockReference } from "../config-schemas.js"
import type {
  AccessKeyListResponse,
  AccessKeyView,
  AccountView,
  BlockEffectsResponse,
  BlockView,
  ContractCodeView,
  FinalExecutionOutcomeMap,
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

import { withRpcCall, type RpcPrograms } from "./rpc-program.js"

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

/** Promise-returning RPC operations exposed by Near.rpc. */
export interface RpcClient {
  call<T = unknown>(method: string, params: unknown): Promise<T>
  query<T = unknown>(path: string, data: string | Uint8Array): Promise<T>
  viewFunction(
    contractId: string,
    methodName: string,
    args?: unknown,
    options?: BlockReference,
  ): Promise<ViewFunctionCallResult>
  getAccount(accountId: string, options?: BlockReference): Promise<AccountView>
  viewCode(
    accountId: string,
    options?: BlockReference,
  ): Promise<ContractCodeView>
  viewGlobalContractCode(
    contract: GlobalContractReference,
    options?: BlockReference,
  ): Promise<ContractCodeView>
  getAccessKey(
    accountId: string,
    publicKey: string,
    options?: BlockReference,
  ): Promise<AccessKeyView>
  getAccessKeys(
    accountId: string,
    options?: BlockReference,
  ): Promise<AccessKeyListResponse>
  getGasKeyNonces(
    accountId: string,
    publicKey: string,
    options?: BlockReference,
  ): Promise<GasKeyNoncesResponse>
  sendTransaction<
    W extends keyof FinalExecutionOutcomeMap = "EXECUTED_OPTIMISTIC",
  >(
    signedTransaction: Uint8Array,
    waitUntil?: W,
  ): Promise<FinalExecutionOutcomeMap[W]>
  getTransactionStatus<
    W extends keyof FinalExecutionOutcomeWithReceiptsMap =
      "EXECUTED_OPTIMISTIC",
  >(
    txHash: string,
    senderAccountId: string,
    waitUntil?: W,
  ): Promise<FinalExecutionOutcomeWithReceiptsMap[W]>
  receiptToTx(receiptId: string): Promise<ReceiptToTxResponse>
  getStatus(): Promise<StatusResponse>
  getBlock(options?: BlockReference): Promise<BlockView>
  getGasPrice(blockId?: string | null): Promise<GasPriceResponse>
  viewState(
    accountId: string,
    options?: BlockReference & {
      prefix?: string
      afterKey?: string
      limit?: number
      includeProof?: boolean
    },
  ): Promise<ViewStateResult>
  viewStateAll(
    accountId: string,
    options?: BlockReference & { prefix?: string; limit?: number },
  ): AsyncGenerator<StateItem>
  blockEffects(options?: BlockReference): Promise<BlockEffectsResponse>
  genesisConfig(): Promise<GenesisConfigResponse>
  maintenanceWindows(accountId: string): Promise<MaintenanceWindowsResponse>
}

export type RpcFailure = NearError | z.ZodError | ExternalError
export type RpcFetch = (
  url: string,
  init: RequestInit & { signal: AbortSignal },
) => PromiseLike<Response>

// Public TransactionBuilder accepts structural Promise RPC providers. This identity
// map returns built-in programs directly instead of creating a Promise round-trip.
const nativePrograms = new WeakMap<RpcClient, RpcPrograms>()
const publicMethods = new WeakMap<RpcClient, RpcClient>()
const promiseAdapters = new WeakMap<RpcClient, RpcPrograms>()

export function rpcToPromises(underlying: RpcPrograms): RpcClient {
  let originalCall: RpcClient["call"] | undefined
  const middleware: RpcPrograms["call"] = <T = unknown>(
    method: string,
    params: unknown,
  ) =>
    Effect.suspend(() =>
      originalCall && client.call !== originalCall
        ? fromPromise(() => client.call<T>(method, params), "Rpc.call.override")
        : underlying.call<T>(method, params),
    )
  const programs = withRpcCall(underlying, middleware)
  const client: RpcClient = {
    call<T = unknown>(method: string, params: unknown): Promise<T> {
      return runPromise(underlying.call<T>(method, params))
    },
    query<T = unknown>(path: string, data: string | Uint8Array): Promise<T> {
      return runPromise(programs.query<T>(path, data))
    },
    viewFunction(
      contractId: string,
      methodName: string,
      args: unknown = {},
      options?: BlockReference,
    ): Promise<ViewFunctionCallResult> {
      return runPromise(
        programs.viewFunction(contractId, methodName, args, options),
      )
    },
    getAccount(
      accountId: string,
      options?: BlockReference,
    ): Promise<AccountView> {
      return runPromise(programs.getAccount(accountId, options))
    },
    viewCode(
      accountId: string,
      options?: BlockReference,
    ): Promise<ContractCodeView> {
      return runPromise(programs.viewCode(accountId, options))
    },
    viewGlobalContractCode(
      contract: GlobalContractReference,
      options?: BlockReference,
    ): Promise<ContractCodeView> {
      return runPromise(programs.viewGlobalContractCode(contract, options))
    },
    getAccessKey(
      accountId: string,
      publicKey: string,
      options?: BlockReference,
    ): Promise<AccessKeyView> {
      return runPromise(programs.getAccessKey(accountId, publicKey, options))
    },
    getAccessKeys(
      accountId: string,
      options?: BlockReference,
    ): Promise<AccessKeyListResponse> {
      return runPromise(programs.getAccessKeys(accountId, options))
    },
    getGasKeyNonces(
      accountId: string,
      publicKey: string,
      options?: BlockReference,
    ): Promise<GasKeyNoncesResponse> {
      return runPromise(programs.getGasKeyNonces(accountId, publicKey, options))
    },
    sendTransaction<
      W extends keyof FinalExecutionOutcomeMap = "EXECUTED_OPTIMISTIC",
    >(
      signedTransaction: Uint8Array,
      waitUntil?: W,
    ): Promise<FinalExecutionOutcomeMap[W]> {
      return runPromise(
        programs.sendTransaction<W>(signedTransaction, waitUntil),
      )
    },
    getTransactionStatus<
      W extends keyof FinalExecutionOutcomeWithReceiptsMap =
        "EXECUTED_OPTIMISTIC",
    >(
      txHash: string,
      senderAccountId: string,
      waitUntil?: W,
    ): Promise<FinalExecutionOutcomeWithReceiptsMap[W]> {
      return runPromise(
        programs.getTransactionStatus<W>(txHash, senderAccountId, waitUntil),
      )
    },
    receiptToTx(receiptId: string): Promise<ReceiptToTxResponse> {
      return runPromise(programs.receiptToTx(receiptId))
    },
    getStatus(): Promise<StatusResponse> {
      return runPromise(programs.getStatus())
    },
    getBlock(options?: BlockReference): Promise<BlockView> {
      return runPromise(programs.getBlock(options))
    },
    getGasPrice(blockId: string | null = null): Promise<GasPriceResponse> {
      return runPromise(programs.getGasPrice(blockId))
    },
    viewState(
      accountId: string,
      options?: BlockReference & {
        prefix?: string
        afterKey?: string
        limit?: number
        includeProof?: boolean
      },
    ): Promise<ViewStateResult> {
      return runPromise(programs.viewState(accountId, options))
    },
    async *viewStateAll(
      accountId: string,
      options?: BlockReference & { prefix?: string; limit?: number },
    ): AsyncGenerator<StateItem> {
      try {
        yield* Stream.toAsyncIterable(programs.viewStateAll(accountId, options))
      } catch (error) {
        throw error instanceof ExternalError ? error.cause : error
      }
    },
    blockEffects(options?: BlockReference): Promise<BlockEffectsResponse> {
      return runPromise(programs.blockEffects(options))
    },
    genesisConfig(): Promise<GenesisConfigResponse> {
      return runPromise(programs.genesisConfig())
    },
    maintenanceWindows(accountId: string): Promise<MaintenanceWindowsResponse> {
      return runPromise(programs.maintenanceWindows(accountId))
    },
  }
  // oxlint-disable-next-line typescript/unbound-method -- Store identity for middleware detection, never invoke this unbound reference.
  originalCall = client.call
  nativePrograms.set(client, programs)
  publicMethods.set(client, { ...client })
  return client
}

/** Adapt a caller-supplied Promise provider only at the public extension boundary. */
export function rpcFromPromises(client: RpcClient): RpcPrograms {
  const existing = promiseAdapters.get(client)
  if (existing) return existing
  const native = nativePrograms.get(client)
  const original = publicMethods.get(client)
  const programs = {
    call: Effect.fn("Rpc.external.call")(function* <T = unknown>(
      method: string,
      params: unknown,
    ): Effect.fn.Return<T, RpcFailure> {
      if (native && client.call === original?.call)
        return yield* native.call<T>(method, params)

      return yield* fromPromise(
        () => client.call<T>(method, params),
        "Rpc.call",
      )
    }),
    query: Effect.fn("Rpc.external.query")(function* <T = unknown>(
      path: string,
      data: string | Uint8Array,
    ): Effect.fn.Return<T, RpcFailure> {
      if (native && client.query === original?.query)
        return yield* native.query<T>(path, data)

      return yield* fromPromise(() => client.query<T>(path, data), "Rpc.query")
    }),
    viewFunction: Effect.fn("Rpc.external.viewFunction")(function* (
      contractId: string,
      methodName: string,
      args: unknown = {},
      options?: BlockReference,
    ): Effect.fn.Return<ViewFunctionCallResult, RpcFailure> {
      if (native && client.viewFunction === original?.viewFunction)
        return yield* native.viewFunction(contractId, methodName, args, options)

      return yield* fromPromise(
        () => client.viewFunction(contractId, methodName, args, options),
        "Rpc.viewFunction",
      )
    }),
    getAccount: Effect.fn("Rpc.external.getAccount")(function* (
      accountId: string,
      options?: BlockReference,
    ): Effect.fn.Return<AccountView, RpcFailure> {
      if (native && client.getAccount === original?.getAccount)
        return yield* native.getAccount(accountId, options)

      return yield* fromPromise(
        () => client.getAccount(accountId, options),
        "Rpc.getAccount",
      )
    }),
    viewCode: Effect.fn("Rpc.external.viewCode")(function* (
      accountId: string,
      options?: BlockReference,
    ): Effect.fn.Return<ContractCodeView, RpcFailure> {
      if (native && client.viewCode === original?.viewCode)
        return yield* native.viewCode(accountId, options)

      return yield* fromPromise(
        () => client.viewCode(accountId, options),
        "Rpc.viewCode",
      )
    }),
    viewGlobalContractCode: Effect.fn("Rpc.external.viewGlobalContractCode")(
      function* (
        contract: GlobalContractReference,
        options?: BlockReference,
      ): Effect.fn.Return<ContractCodeView, RpcFailure> {
        if (
          native &&
          client.viewGlobalContractCode === original?.viewGlobalContractCode
        )
          return yield* native.viewGlobalContractCode(contract, options)

        return yield* fromPromise(
          () => client.viewGlobalContractCode(contract, options),
          "Rpc.viewGlobalContractCode",
        )
      },
    ),
    getAccessKey: Effect.fn("Rpc.external.getAccessKey")(function* (
      accountId: string,
      publicKey: string,
      options?: BlockReference,
    ): Effect.fn.Return<AccessKeyView, RpcFailure> {
      if (native && client.getAccessKey === original?.getAccessKey)
        return yield* native.getAccessKey(accountId, publicKey, options)

      return yield* fromPromise(
        () => client.getAccessKey(accountId, publicKey, options),
        "Rpc.getAccessKey",
      )
    }),
    getAccessKeys: Effect.fn("Rpc.external.getAccessKeys")(function* (
      accountId: string,
      options?: BlockReference,
    ): Effect.fn.Return<AccessKeyListResponse, RpcFailure> {
      if (native && client.getAccessKeys === original?.getAccessKeys)
        return yield* native.getAccessKeys(accountId, options)

      return yield* fromPromise(
        () => client.getAccessKeys(accountId, options),
        "Rpc.getAccessKeys",
      )
    }),
    getGasKeyNonces: Effect.fn("Rpc.external.getGasKeyNonces")(function* (
      accountId: string,
      publicKey: string,
      options?: BlockReference,
    ): Effect.fn.Return<GasKeyNoncesResponse, RpcFailure> {
      if (native && client.getGasKeyNonces === original?.getGasKeyNonces)
        return yield* native.getGasKeyNonces(accountId, publicKey, options)

      return yield* fromPromise(
        () => client.getGasKeyNonces(accountId, publicKey, options),
        "Rpc.getGasKeyNonces",
      )
    }),
    sendTransaction: Effect.fn("Rpc.external.sendTransaction")(function* <
      W extends keyof FinalExecutionOutcomeMap = "EXECUTED_OPTIMISTIC",
    >(
      signedTransaction: Uint8Array,
      waitUntil?: W,
    ): Effect.fn.Return<FinalExecutionOutcomeMap[W], RpcFailure> {
      if (native && client.sendTransaction === original?.sendTransaction)
        return yield* native.sendTransaction<W>(signedTransaction, waitUntil)

      return yield* fromPromise(
        () => client.sendTransaction<W>(signedTransaction, waitUntil),
        "Rpc.sendTransaction",
      )
    }),
    getTransactionStatus: Effect.fn("Rpc.external.getTransactionStatus")(
      function* <
        W extends keyof FinalExecutionOutcomeWithReceiptsMap =
          "EXECUTED_OPTIMISTIC",
      >(
        txHash: string,
        senderAccountId: string,
        waitUntil?: W,
      ): Effect.fn.Return<FinalExecutionOutcomeWithReceiptsMap[W], RpcFailure> {
        if (
          native &&
          client.getTransactionStatus === original?.getTransactionStatus
        )
          return yield* native.getTransactionStatus<W>(
            txHash,
            senderAccountId,
            waitUntil,
          )

        return yield* fromPromise(
          () =>
            client.getTransactionStatus<W>(txHash, senderAccountId, waitUntil),
          "Rpc.getTransactionStatus",
        )
      },
    ),
    receiptToTx: Effect.fn("Rpc.external.receiptToTx")(function* (
      receiptId: string,
    ): Effect.fn.Return<ReceiptToTxResponse, RpcFailure> {
      if (native && client.receiptToTx === original?.receiptToTx)
        return yield* native.receiptToTx(receiptId)

      return yield* fromPromise(
        () => client.receiptToTx(receiptId),
        "Rpc.receiptToTx",
      )
    }),
    getStatus: Effect.fn("Rpc.external.getStatus")(
      function* (): Effect.fn.Return<StatusResponse, RpcFailure> {
        if (native && client.getStatus === original?.getStatus)
          return yield* native.getStatus()

        return yield* fromPromise(() => client.getStatus(), "Rpc.getStatus")
      },
    ),
    getBlock: Effect.fn("Rpc.external.getBlock")(function* (
      options?: BlockReference,
    ): Effect.fn.Return<BlockView, RpcFailure> {
      if (native && client.getBlock === original?.getBlock)
        return yield* native.getBlock(options)

      return yield* fromPromise(() => client.getBlock(options), "Rpc.getBlock")
    }),
    getGasPrice: Effect.fn("Rpc.external.getGasPrice")(function* (
      blockId: string | null = null,
    ): Effect.fn.Return<GasPriceResponse, RpcFailure> {
      if (native && client.getGasPrice === original?.getGasPrice)
        return yield* native.getGasPrice(blockId)

      return yield* fromPromise(
        () => client.getGasPrice(blockId),
        "Rpc.getGasPrice",
      )
    }),
    viewState: Effect.fn("Rpc.external.viewState")(function* (
      accountId: string,
      options?: BlockReference & {
        prefix?: string
        afterKey?: string
        limit?: number
        includeProof?: boolean
      },
    ): Effect.fn.Return<ViewStateResult, RpcFailure> {
      if (native && client.viewState === original?.viewState)
        return yield* native.viewState(accountId, options)

      return yield* fromPromise(
        () => client.viewState(accountId, options),
        "Rpc.viewState",
      )
    }),
    viewStateAll: (
      accountId: string,
      options?: BlockReference & { prefix?: string; limit?: number },
    ) =>
      Stream.unwrap(
        Effect.try({
          try: () =>
            Stream.fromAsyncIterable(
              client.viewStateAll(accountId, options),
              (cause) =>
                new ExternalError({ operation: "Rpc.viewStateAll", cause }),
            ),
          catch: (cause) =>
            new ExternalError({ operation: "Rpc.viewStateAll", cause }),
        }),
      ),
    blockEffects: Effect.fn("Rpc.external.blockEffects")(function* (
      options?: BlockReference,
    ): Effect.fn.Return<BlockEffectsResponse, RpcFailure> {
      if (native && client.blockEffects === original?.blockEffects)
        return yield* native.blockEffects(options)

      return yield* fromPromise(
        () => client.blockEffects(options),
        "Rpc.blockEffects",
      )
    }),
    genesisConfig: Effect.fn("Rpc.external.genesisConfig")(
      function* (): Effect.fn.Return<GenesisConfigResponse, RpcFailure> {
        if (native && client.genesisConfig === original?.genesisConfig)
          return yield* native.genesisConfig()

        return yield* fromPromise(
          () => client.genesisConfig(),
          "Rpc.genesisConfig",
        )
      },
    ),
    maintenanceWindows: Effect.fn("Rpc.external.maintenanceWindows")(function* (
      accountId: string,
    ): Effect.fn.Return<MaintenanceWindowsResponse, RpcFailure> {
      if (native && client.maintenanceWindows === original?.maintenanceWindows)
        return yield* native.maintenanceWindows(accountId)

      return yield* fromPromise(
        () => client.maintenanceWindows(accountId),
        "Rpc.maintenanceWindows",
      )
    }),
  }
  promiseAdapters.set(client, programs)
  return programs
}
