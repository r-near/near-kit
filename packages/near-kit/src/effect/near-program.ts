import { base64 } from "@scure/base"
import * as Effect from "effect/Effect"
import * as Result from "effect/Result"
import { type BlockReference } from "../core/config-schemas.js"
import { STORAGE_AMOUNT_PER_BYTE } from "../core/constants.js"
import type { RpcPrograms } from "../core/rpc/rpc-program.js"
import type {
  FinalExecutionOutcome,
  FinalExecutionOutcomeWithReceiptsMap,
} from "../core/rpc/rpc-schemas.js"
import { TransactionBuilder } from "../core/transaction.js"
import type {
  CallOptions,
  GlobalContractReference,
  KeyStore,
  SignMessageParams,
  WalletConnection,
} from "../core/types.js"
import {
  AccountDoesNotExistError,
  GlobalContractNotFoundError,
  NearError,
} from "../errors/index.js"
import { formatAmount } from "../utils/amount.js"
import { generateNonce } from "../utils/nep413.js"
import type { Amount, Gas } from "../utils/validation.js"
import { getKeyEffect } from "./keys.js"
import { fromPromise, inputEffect, ExternalError } from "./runtime.js"
import { walletService } from "./wallet.js"

export interface NearProgramDependencies {
  readonly rpc: RpcPrograms
  readonly keyStore: KeyStore
  readonly wallet: WalletConnection | undefined
  readonly defaultSignerId: string | undefined
  readonly transaction: (signerId: string) => TransactionBuilder
  // oxlint-disable-next-line effecttsgo/lazy-effect -- Kit service operations remain named Effect.fn functions, including zero-argument methods.
  readonly ready: () => Effect.Effect<void, ExternalError>
}

/** Pure service construction; operations execute in the caller's fiber. */
export const makeNearPrograms = (context: NearProgramDependencies) => {
  const getSignerId = Effect.fn("Near.getSignerId")(function* (
    signerId?: string,
  ) {
    if (signerId) return signerId
    if (context.defaultSignerId) return context.defaultSignerId

    // Get from wallet if available
    if (context.wallet) {
      const accounts = yield* walletService(context.wallet).getAccounts()
      if (accounts.length === 0) {
        return yield* Effect.fail(
          new NearError(
            "No accounts connected to wallet",
            "NO_WALLET_ACCOUNTS",
          ),
        )
      }
      // Safe to use non-null assertion after length check
      // biome-ignore lint/style/noNonNullAssertion: verified accounts[0] exists above
      return accounts[0]!.accountId
    }

    return yield* Effect.fail(
      new NearError(
        "No signer ID provided. Set signerId in options or config.",
        "MISSING_SIGNER",
      ),
    )
  })

  const view = Effect.fn("Near.view")(function* <T = unknown>(
    contractId: string,
    methodName: string,
    args: object | Uint8Array = {},
    options?: BlockReference,
  ) {
    const result = yield* context.rpc.viewFunction(
      contractId,
      methodName,
      args,
      options,
    )

    // Decode result
    const resultBuffer = new Uint8Array(result.result)
    const resultString = new TextDecoder().decode(resultBuffer)

    if (!resultString) {
      return undefined
    }

    return decodeViewResult<T>(resultString)
  })

  const call = Effect.fn("Near.call")(function* <T = FinalExecutionOutcome>(
    contractId: string,
    methodName: string,
    args: object | Uint8Array = {},
    options: CallOptions = {},
  ) {
    const signerId = yield* getSignerId(options.signerId)

    const functionCallOptions: {
      gas?: Gas
      attachedDeposit?: Amount
    } = {}
    if (options.gas !== undefined) {
      functionCallOptions.gas = options.gas
    }
    if (options.attachedDeposit !== undefined) {
      functionCallOptions.attachedDeposit = options.attachedDeposit
    }

    const sendOptions = options.waitUntil
      ? { waitUntil: options.waitUntil }
      : {}

    const builder = yield* inputEffect(
      () =>
        context
          .transaction(signerId)
          .functionCall(contractId, methodName, args, functionCallOptions),
      "Near.call.arguments",
    )
    const result = yield* builder.sendEffect(sendOptions)

    return result as T
  })

  const send = Effect.fn("Near.send")(function* (
    receiverId: string,
    amount: Amount,
  ) {
    const signerId = yield* getSignerId()

    const builder = yield* inputEffect(
      () => context.transaction(signerId).transfer(receiverId, amount),
      "Near.send.amount",
    )
    return yield* builder.sendEffect()
  })

  const signMessage = Effect.fn("Near.signMessage")(function* (
    params: SignMessageParams | Omit<SignMessageParams, "nonce">,
    options?: { signerId?: string },
  ) {
    const signerId = yield* getSignerId(options?.signerId)

    // Add nonce if not provided
    const fullParams: SignMessageParams = {
      ...params,
      nonce: "nonce" in params ? params.nonce : generateNonce(),
    }

    // Try wallet first if available
    if (context.wallet?.signMessage) {
      const signed = yield* walletService(context.wallet).signMessage!(
        fullParams,
      ).pipe(Effect.result)
      if (Result.isSuccess(signed)) return signed.success
      yield* Effect.sync(() =>
        console.warn(
          "Wallet signMessage failed, trying keystore:",
          signed.failure.cause,
        ),
      )
    }

    // Use keystore approach
    // Ensure any pending keystore initialization is complete
    yield* context.ready()

    const keyPair = yield* getKeyEffect(context.keyStore, signerId)
    if (!keyPair) {
      return yield* Effect.fail(
        new NearError(
          `No key found for account ${signerId}. Add a key using keyStore.add() or configure a wallet.`,
          "NO_KEY_FOUND",
        ),
      )
    }

    const sign = keyPair.signNep413Message?.bind(keyPair)
    if (!sign) {
      return yield* Effect.fail(
        new NearError(
          "Key pair does not support NEP-413 message signing",
          "UNSUPPORTED_OPERATION",
        ),
      )
    }

    return yield* Effect.try({
      try: () => sign(signerId, fullParams),
      catch: (cause) =>
        new ExternalError({ operation: "KeyPair.signNep413Message", cause }),
    })
  })

  const getBalance = Effect.fn("Near.getBalance")(function* (
    accountId: string,
    options?: BlockReference,
  ) {
    const account = yield* context.rpc.getAccount(accountId, options)

    const available = yield* inputEffect(
      () =>
        calculateAvailableBalance(
          account.amount,
          account.locked,
          account.storage_usage,
        ),
      "Near.account.balance",
    )

    return formatAmount(available.toString(), {
      precision: 2,
      includeSuffix: false,
    })
  })

  const getAccount = Effect.fn("Near.getAccount")(function* (
    accountId: string,
    options?: BlockReference,
  ) {
    const account = yield* context.rpc.getAccount(accountId, options)

    const available = yield* inputEffect(
      () =>
        calculateAvailableBalance(
          account.amount,
          account.locked,
          account.storage_usage,
        ),
      "Near.account.balance",
    )

    return yield* inputEffect(() => {
      const storageRequired =
        STORAGE_AMOUNT_PER_BYTE * BigInt(account.storage_usage)

      // Code hash for accounts without contracts
      const emptyCodeHash = "11111111111111111111111111111111"

      return {
        balance: formatAmount(account.amount, {
          precision: 2,
          includeSuffix: false,
        }),
        available: formatAmount(available.toString(), {
          precision: 2,
          includeSuffix: false,
        }),
        staked: formatAmount(account.locked, {
          precision: 2,
          includeSuffix: false,
        }),
        storageUsage: formatAmount(storageRequired.toString(), {
          precision: 4,
          includeSuffix: false,
        }),
        storageBytes: account.storage_usage,
        hasContract:
          account.code_hash !== emptyCodeHash ||
          account.global_contract_hash != null ||
          account.global_contract_account_id != null,
        codeHash: account.code_hash,
      }
    }, "Near.account.details")
  })

  const accountExists = Effect.fn("Near.accountExists")(function* (
    accountId: string,
    options?: BlockReference,
  ) {
    return yield* context.rpc.getAccount(accountId, options).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    )
  })

  const getAccessKey = Effect.fn("Near.getAccessKey")(function* (
    accountId: string,
    publicKey: string,
    options?: BlockReference,
  ) {
    return yield* context.rpc
      .getAccessKey(accountId, publicKey, options)
      .pipe(Effect.orElseSucceed(() => null))
  })

  const getAccessKeys = Effect.fn("Near.getAccessKeys")(function* (
    accountId: string,
    options?: BlockReference,
  ) {
    return yield* context.rpc.getAccessKeys(accountId, options)
  })

  const getContractCode = Effect.fn("Near.getContractCode")(function* (
    accountId: string,
    options?: BlockReference,
  ) {
    const view = yield* context.rpc.viewCode(accountId, options)
    return yield* inputEffect(
      () => ({ code: base64.decode(view.code_base64), hash: view.hash }),
      "Near.contract.code",
    )
  })

  const getGlobalContract = Effect.fn("Near.getGlobalContract")(function* (
    contract: GlobalContractReference,
    options?: BlockReference,
  ) {
    const view = yield* context.rpc.viewGlobalContractCode(contract, options)
    return yield* inputEffect(
      () => ({ code: base64.decode(view.code_base64), hash: view.hash }),
      "Near.contract.code",
    )
  })

  const globalContractExists = Effect.fn("Near.globalContractExists")(
    function* (contract: GlobalContractReference, options?: BlockReference) {
      return yield* context.rpc.viewGlobalContractCode(contract, options).pipe(
        Effect.as(true),
        Effect.catchIf(
          (error) =>
            error instanceof GlobalContractNotFoundError ||
            error instanceof AccountDoesNotExistError,
          () => Effect.succeed(false),
        ),
      )
    },
  )

  const getTransactionStatus = Effect.fn("Near.getTransactionStatus")(
    function* <
      W extends
        | "NONE"
        | "INCLUDED"
        | "EXECUTED_OPTIMISTIC"
        | "INCLUDED_FINAL"
        | "EXECUTED"
        | "FINAL" = "EXECUTED_OPTIMISTIC",
    >(txHash: string, senderAccountId: string, waitUntil?: W) {
      return (yield* context.rpc.getTransactionStatus(
        txHash,
        senderAccountId,
        waitUntil,
      )) as W extends keyof FinalExecutionOutcomeWithReceiptsMap
        ? FinalExecutionOutcomeWithReceiptsMap[W]
        : never
    },
  )

  const getStatus = Effect.fn("Near.getStatus")(function* () {
    return yield* context.rpc.getStatus()
  })

  const viewState = Effect.fn("Near.viewState")(function* (
    accountId: string,
    options?: BlockReference & {
      prefix?: string
      afterKey?: string
      limit?: number
      includeProof?: boolean
    },
  ) {
    return yield* context.rpc.viewState(accountId, options)
  })

  const batch = Effect.fn("Near.batch")(function* <T extends unknown[]>(
    ...promises: Array<Promise<T[number]>>
  ) {
    return (yield* Effect.forEach(
      promises,
      (promise) => fromPromise(() => promise, "batch"),
      { concurrency: "unbounded" },
    )) as T
  })
  const getConnectedAccountId = Effect.fn("Near.getConnectedAccountId")(
    function* () {
      if (context.wallet) {
        const accounts = yield* walletService(context.wallet).getAccounts()
        if (accounts[0]) return accounts[0].accountId
      }
      return context.defaultSignerId
    },
    (program) => program.pipe(Effect.orElseSucceed(() => undefined)),
  )
  return {
    getConnectedAccountId,
    view,
    call,
    send,
    signMessage,
    getBalance,
    getAccount,
    accountExists,
    getAccessKey,
    getAccessKeys,
    getContractCode,
    getGlobalContract,
    globalContractExists,
    getTransactionStatus,
    getStatus,
    viewState,
    batch,
  }
}

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
