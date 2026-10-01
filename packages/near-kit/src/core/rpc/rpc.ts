/** The sole Promise boundary for the public Near.rpc API. */
import * as Stream from "effect/Stream"
import type { SchemaError } from "effect/Schema"
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

import type { RpcPrograms } from "./rpc-program.js"

export interface RpcRequest {
  jsonrpc: "2.0"
  id: string | number
  method: string
  params: unknown
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

export type RpcFailure = NearError | SchemaError | ExternalError
export type RpcFetch = (
  url: string,
  init: RequestInit & { signal: AbortSignal },
) => PromiseLike<Response>

/** The public Promise edge projects one native owner without dispatch state. */
export function rpcToPromises(programs: RpcPrograms): RpcClient {
  return {
    call: (method, params) => runPromise(programs.call(method, params)),
    query: (path, data) => runPromise(programs.query(path, data)),
    viewFunction: (contractId, methodName, args, options) =>
      runPromise(programs.viewFunction(contractId, methodName, args, options)),
    getAccount: (accountId, options) =>
      runPromise(programs.getAccount(accountId, options)),
    viewCode: (accountId, options) =>
      runPromise(programs.viewCode(accountId, options)),
    viewGlobalContractCode: (contract, options) =>
      runPromise(programs.viewGlobalContractCode(contract, options)),
    getAccessKey: (accountId, publicKey, options) =>
      runPromise(programs.getAccessKey(accountId, publicKey, options)),
    getAccessKeys: (accountId, options) =>
      runPromise(programs.getAccessKeys(accountId, options)),
    getGasKeyNonces: (accountId, publicKey, options) =>
      runPromise(programs.getGasKeyNonces(accountId, publicKey, options)),
    sendTransaction: (signedTransaction, waitUntil) =>
      runPromise(programs.sendTransaction(signedTransaction, waitUntil)),
    getTransactionStatus: (txHash, senderAccountId, waitUntil) =>
      runPromise(
        programs.getTransactionStatus(txHash, senderAccountId, waitUntil),
      ),
    receiptToTx: (receiptId) => runPromise(programs.receiptToTx(receiptId)),
    getStatus: () => runPromise(programs.getStatus()),
    getBlock: (options) => runPromise(programs.getBlock(options)),
    getGasPrice: (blockId) => runPromise(programs.getGasPrice(blockId)),
    viewState: (accountId, options) =>
      runPromise(programs.viewState(accountId, options)),
    blockEffects: (options) => runPromise(programs.blockEffects(options)),
    genesisConfig: () => runPromise(programs.genesisConfig()),
    maintenanceWindows: (accountId) =>
      runPromise(programs.maintenanceWindows(accountId)),
    async *viewStateAll(accountId, options) {
      try {
        yield* Stream.toAsyncIterable(programs.viewStateAll(accountId, options))
      } catch (error) {
        throw error instanceof ExternalError ? error.cause : error
      }
    },
  }
}

/** Adapt only the six capabilities consumed by a detached public transaction. */
export function transactionRpcFromPromises(
  client: RpcClient,
): import("../../effect/transaction.js").TransactionRpc {
  return {
    call: (method, params) =>
      fromPromise(() => client.call(method, params), "Rpc.external.call"),
    getAccessKey: (accountId, publicKey, options) =>
      fromPromise(
        () => client.getAccessKey(accountId, publicKey, options),
        "Rpc.external.getAccessKey",
      ),
    getBlock: (options) =>
      fromPromise(() => client.getBlock(options), "Rpc.external.getBlock"),
    getStatus: () =>
      fromPromise(() => client.getStatus(), "Rpc.external.getStatus"),
    sendTransaction: (bytes, waitUntil) =>
      fromPromise(
        () => client.sendTransaction(bytes, waitUntil),
        "Rpc.external.sendTransaction",
      ),
    getTransactionStatus: (hash, signerId, waitUntil) =>
      fromPromise(
        () => client.getTransactionStatus(hash, signerId, waitUntil),
        "Rpc.external.getTransactionStatus",
      ),
  }
}
