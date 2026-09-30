/** Native operations are defined once; client construction only binds dependencies. */
import { base64 } from "@scure/base"
import * as Effect from "effect/Effect"
import * as Result from "effect/Result"
import type { BlockReference } from "../core/config-schemas.js"
import { STORAGE_AMOUNT_PER_BYTE } from "../core/constants.js"
import type { RpcPrograms } from "../core/rpc/rpc-program.js"
import type { FinalExecutionOutcome } from "../effect/protocol-schemas.js"
import type { TransactionBuilder } from "../core/transaction.js"
import type {
  CallOptions,
  GlobalContractReference,
  SignMessageParams,
} from "../core/types.js"
import {
  AccountDoesNotExistError,
  GlobalContractNotFoundError,
  NearError,
} from "../errors/index.js"
import { formatAmount } from "../utils/amount.js"
import { generateNonce } from "../utils/nep413.js"
import type { Amount } from "../utils/validation.js"
import type { KeyStoreService } from "./keys.js"
import type { WalletService } from "./wallet.js"
import {
  fromPromise,
  fromSync,
  inputEffect,
  type NearFailure,
} from "./runtime.js"

export interface NearProgramDependencies {
  readonly rpc: RpcPrograms
  readonly keyStore: KeyStoreService
  readonly wallet: WalletService | undefined
  readonly defaultSignerId: string | undefined
  readonly ready: Effect.Effect<void, NearFailure>
  readonly transaction: (signerId: string) => TransactionBuilder
}

const signerId = Effect.fn("Near.signerId")(function* (
  context: NearProgramDependencies,
  supplied?: string,
) {
  if (supplied) return supplied
  if (context.defaultSignerId) return context.defaultSignerId
  if (context.wallet) {
    const accounts = yield* context.wallet.getAccounts()
    if (accounts[0]) return accounts[0].accountId
    return yield* Effect.fail(
      new NearError("No accounts connected to wallet", "NO_WALLET_ACCOUNTS"),
    )
  }
  return yield* Effect.fail(
    new NearError(
      "No signer ID provided. Set signerId in options or config.",
      "MISSING_SIGNER",
    ),
  )
})

const view = Effect.fn("Near.view")(function* <T = unknown>(
  context: NearProgramDependencies,
  contractId: string,
  method: string,
  args: object | Uint8Array = {},
  options?: BlockReference,
) {
  const response = yield* context.rpc.viewFunction(
    contractId,
    method,
    args,
    options,
  )
  const text = new TextDecoder().decode(new Uint8Array(response.result))
  return text ? decodeViewResult<T>(text) : undefined
})

const call = Effect.fn("Near.call")(function* <T = FinalExecutionOutcome>(
  context: NearProgramDependencies,
  contractId: string,
  method: string,
  args: object | Uint8Array = {},
  options: CallOptions = {},
) {
  const id = yield* signerId(context, options.signerId)
  const builder = yield* inputEffect(
    () =>
      context.transaction(id).functionCall(contractId, method, args, {
        ...(options.gas !== undefined ? { gas: options.gas } : {}),
        ...(options.attachedDeposit !== undefined
          ? { attachedDeposit: options.attachedDeposit }
          : {}),
      }),
    "Near.call.arguments",
  )
  return (yield* builder.sendEffect(
    options.waitUntil ? { waitUntil: options.waitUntil } : {},
  )) as T
})

const send = Effect.fn("Near.send")(function* (
  context: NearProgramDependencies,
  receiverId: string,
  amount: Amount,
) {
  const id = yield* signerId(context)
  const builder = yield* inputEffect(
    () => context.transaction(id).transfer(receiverId, amount),
    "Near.send.amount",
  )
  return yield* builder.sendEffect()
})

const signMessage = Effect.fn("Near.signMessage")(function* (
  context: NearProgramDependencies,
  params: SignMessageParams | Omit<SignMessageParams, "nonce">,
  options?: { signerId?: string },
) {
  const id = yield* signerId(context, options?.signerId)
  const fullParams = {
    ...params,
    nonce: "nonce" in params ? params.nonce : generateNonce(),
  }
  if (context.wallet?.signMessage) {
    const result = yield* context.wallet
      .signMessage(fullParams)
      .pipe(Effect.result)
    if (Result.isSuccess(result)) return result.success
    yield* Effect.sync(() =>
      console.warn(
        "Wallet signMessage failed, trying keystore:",
        result.failure.cause,
      ),
    )
  }
  yield* context.ready
  const key = yield* context.keyStore.get(id)
  if (!key)
    return yield* Effect.fail(
      new NearError(
        `No key found for account ${id}. Add a key using keyStore.add() or configure a wallet.`,
        "NO_KEY_FOUND",
      ),
    )
  const sign = key.signNep413Message?.bind(key)
  if (!sign)
    return yield* Effect.fail(
      new NearError(
        "Key pair does not support NEP-413 message signing",
        "UNSUPPORTED_OPERATION",
      ),
    )
  return yield* fromSync(
    () => sign(id, fullParams),
    "KeyPair.signNep413Message",
  )
})

const getBalance = Effect.fn("Near.getBalance")(function* (
  context: NearProgramDependencies,
  accountId: string,
  options?: BlockReference,
) {
  const account = yield* context.rpc.getAccount(accountId, options)
  return yield* fromSync(
    () =>
      formatAmount(
        calculateAvailableBalance(
          account.amount,
          account.locked,
          account.storage_usage,
        ).toString(),
        { precision: 2, includeSuffix: false },
      ),
    "Near.account.balance",
  )
})

const getAccount = Effect.fn("Near.getAccount")(function* (
  context: NearProgramDependencies,
  accountId: string,
  options?: BlockReference,
) {
  const account = yield* context.rpc.getAccount(accountId, options)
  return yield* fromSync(
    () => ({
      balance: formatAmount(account.amount, {
        precision: 2,
        includeSuffix: false,
      }),
      available: formatAmount(
        calculateAvailableBalance(
          account.amount,
          account.locked,
          account.storage_usage,
        ).toString(),
        { precision: 2, includeSuffix: false },
      ),
      staked: formatAmount(account.locked, {
        precision: 2,
        includeSuffix: false,
      }),
      storageUsage: formatAmount(
        (STORAGE_AMOUNT_PER_BYTE * BigInt(account.storage_usage)).toString(),
        { precision: 4, includeSuffix: false },
      ),
      storageBytes: account.storage_usage,
      hasContract:
        account.code_hash !== "11111111111111111111111111111111" ||
        account.global_contract_hash != null ||
        account.global_contract_account_id != null,
      codeHash: account.code_hash,
    }),
    "Near.account.details",
  )
})

const accountExists = Effect.fn("Near.accountExists")(
  (
    context: NearProgramDependencies,
    accountId: string,
    options?: BlockReference,
  ) =>
    context.rpc.getAccount(accountId, options).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    ),
)
const getAccessKey = Effect.fn("Near.getAccessKey")(
  (
    context: NearProgramDependencies,
    accountId: string,
    publicKey: string,
    options?: BlockReference,
  ) =>
    context.rpc
      .getAccessKey(accountId, publicKey, options)
      .pipe(Effect.orElseSucceed(() => null)),
)
const getContractCode = Effect.fn("Near.getContractCode")(function* (
  context: NearProgramDependencies,
  accountId: string,
  options?: BlockReference,
) {
  const response = yield* context.rpc.viewCode(accountId, options)
  return yield* fromSync(
    () => ({ code: base64.decode(response.code_base64), hash: response.hash }),
    "Near.contract.code",
  )
})
const getGlobalContract = Effect.fn("Near.getGlobalContract")(function* (
  context: NearProgramDependencies,
  contract: GlobalContractReference,
  options?: BlockReference,
) {
  const response = yield* context.rpc.viewGlobalContractCode(contract, options)
  return yield* fromSync(
    () => ({ code: base64.decode(response.code_base64), hash: response.hash }),
    "Near.contract.code",
  )
})
const globalContractExists = Effect.fn("Near.globalContractExists")(
  (
    context: NearProgramDependencies,
    contract: GlobalContractReference,
    options?: BlockReference,
  ) =>
    context.rpc.viewGlobalContractCode(contract, options).pipe(
      Effect.as(true),
      Effect.catchIf(
        (error) =>
          error instanceof GlobalContractNotFoundError ||
          error instanceof AccountDoesNotExistError,
        () => Effect.succeed(false),
      ),
    ),
)
const getConnectedAccountId = Effect.fn("Near.getConnectedAccountId")(
  function* (context: NearProgramDependencies) {
    if (context.wallet) {
      const accounts = yield* context.wallet.getAccounts()
      if (accounts[0]) return accounts[0].accountId
    }
    return context.defaultSignerId
  },
  (program) => program.pipe(Effect.orElseSucceed(() => undefined)),
)

/** Existing Promise batch inputs are adapted only at their public boundary. */
export const batchPromises = <T extends unknown[]>(
  ...promises: Array<Promise<T[number]>>
) =>
  Effect.forEach(
    promises,
    (promise) => fromPromise(() => promise, "Near.batch"),
    { concurrency: "unbounded" },
  ) as Effect.Effect<T, NearFailure>

export const makeNearPrograms = (context: NearProgramDependencies) => ({
  view: <T = unknown>(
    contractId: string,
    method: string,
    args: object | Uint8Array = {},
    options?: BlockReference,
  ) => view<T>(context, contractId, method, args, options),
  call: <T = FinalExecutionOutcome>(
    contractId: string,
    method: string,
    args: object | Uint8Array = {},
    options: CallOptions = {},
  ) => call<T>(context, contractId, method, args, options),
  send: (receiverId: string, amount: Amount) =>
    send(context, receiverId, amount),
  signMessage: (
    params: SignMessageParams | Omit<SignMessageParams, "nonce">,
    options?: { signerId?: string },
  ) => signMessage(context, params, options),
  getBalance: (accountId: string, options?: BlockReference) =>
    getBalance(context, accountId, options),
  getAccount: (accountId: string, options?: BlockReference) =>
    getAccount(context, accountId, options),
  accountExists: (accountId: string, options?: BlockReference) =>
    accountExists(context, accountId, options),
  getAccessKey: (
    accountId: string,
    publicKey: string,
    options?: BlockReference,
  ) => getAccessKey(context, accountId, publicKey, options),
  getContractCode: (accountId: string, options?: BlockReference) =>
    getContractCode(context, accountId, options),
  getGlobalContract: (
    contract: GlobalContractReference,
    options?: BlockReference,
  ) => getGlobalContract(context, contract, options),
  globalContractExists: (
    contract: GlobalContractReference,
    options?: BlockReference,
  ) => globalContractExists(context, contract, options),
  getConnectedAccountId: () => getConnectedAccountId(context),
  getAccessKeys: context.rpc.getAccessKeys,
  getTransactionStatus: context.rpc.getTransactionStatus,
  getStatus: context.rpc.getStatus,
  viewState: context.rpc.viewState,
})
export type NearPrograms = ReturnType<typeof makeNearPrograms>
function calculateAvailableBalance(
  amount: string,
  locked: string,
  storageUsage: number,
): bigint {
  const amountBigInt = BigInt(amount)
  const lockedBigInt = BigInt(locked)
  const storageRequired = STORAGE_AMOUNT_PER_BYTE * BigInt(storageUsage)

  // If staked >= storage requirement, all liquid balance is available
  if (lockedBigInt >= storageRequired) {
    return amountBigInt
  }

  // Otherwise, some liquid balance is reserved for storage
  const reservedForStorage = storageRequired - lockedBigInt
  if (reservedForStorage >= amountBigInt) {
    return BigInt(0)
  }

  return amountBigInt - reservedForStorage
}

/** A contract may deliberately return either JSON or plain text. */
function decodeViewResult<T>(result: string): T {
  try {
    return JSON.parse(result) as T
  } catch {
    return result as T
  }
}
