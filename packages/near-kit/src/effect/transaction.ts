/** Immutable transaction intent and the single Effect execution pipeline. */
import { sha256 } from "@noble/hashes/sha2.js"
import { base58 } from "@scure/base"
import * as Effect from "effect/Effect"
import * as actions from "../core/actions.js"
import {
  type ClassicAction,
  type DelegateActionPayloadFormat,
  type DelegateV2Action,
  encodeSignedDelegateAction,
  encodeSignedDelegateActionV2,
  type NonDelegateActionBorsh,
  serializeDelegateAction,
  serializeDelegateActionV2,
  serializeTransaction,
  serializeTransactionV1,
  SignatureSchema,
  signatureToZorsh,
  type SignedDelegateAction,
  type TransactionNonceBorsh,
  type TransactionV1,
} from "../core/schema.js"
import type {
  Action,
  FinalExecutionOutcomeMap,
  KeyPair,
  PublicKey,
  SendOptions,
  Signature,
  Transaction as UnsignedTransaction,
  TxExecutionStatus,
} from "../core/types.js"
import { DEFAULT_FUNCTION_CALL_GAS } from "../core/constants.js"
import {
  normalizeAmount,
  normalizeGas,
  type Gas,
  type Amount,
} from "../utils/validation.js"
import type { RpcPrograms } from "../core/rpc/rpc-program.js"
import {
  InvalidKeyError,
  FunctionCallError,
  InvalidTransactionError,
  NearError,
} from "../errors/index.js"
import { parsePublicKey } from "../utils/key.js"
import type { KeyStoreService } from "./keys.js"
import type { NonceReservationService } from "./nonce.js"
import { ExternalError, inputEffect, type NearFailure } from "./runtime.js"
import type { WalletService } from "./wallet.js"

export type TransactionError = NearFailure
/** Resolve any application services before supplying a signer; its work stays in the caller's fiber. */
export type TransactionSigner = (
  digest: Uint8Array,
) => Effect.Effect<Signature, NearFailure>
export type TransactionRpc = Pick<
  RpcPrograms,
  | "call"
  | "getAccessKey"
  | "getBlock"
  | "getStatus"
  | "sendTransaction"
  | "getTransactionStatus"
>
export interface TransactionDependencies {
  readonly rpc: TransactionRpc
  readonly keyStore: KeyStoreService
  readonly nonces: NonceReservationService
  readonly ready?: Effect.Effect<void, NearFailure>
  readonly wallet?: WalletService
  readonly signer?: TransactionSigner
  readonly defaultWaitUntil?: TxExecutionStatus
}

/** Data describing one transaction. External action graphs are copied when acquired. */
export interface TransactionPlan {
  readonly signerId: string
  readonly receiverId?: string
  readonly actions: readonly Action[]
  readonly nonce?: bigint
  readonly nonceIndex?: number
  readonly strictNonce?: boolean
  readonly keyPair?: KeyPair
  readonly signer?: TransactionSigner
}

/** Owned unsigned data in the exact wire version selected by the plan. */
export type UnsignedTransactionValue =
  | { readonly version: 0; readonly transaction: UnsignedTransaction }
  | { readonly version: 1; readonly transaction: TransactionV1 }

/** Only copied wire bytes leave a signed commitment. No live action or key objects are retained. */
export interface SignedTransactionValue {
  readonly hash: string
  readonly signerId: string
  readonly receiverId: string
  readonly publicKey: string
  readonly nonce: bigint
  readonly nonceIndex?: number
  readonly serialize: () => Uint8Array
}

const originalCause = (failure: unknown) =>
  failure instanceof ExternalError ? failure.cause : failure

/** Status absence cannot establish that submitted bytes never executed. */
const transactionOutcomeUnknown = (
  cause: unknown,
  details: Record<string, unknown>,
) =>
  Object.assign(
    new NearError(
      "Transaction submission outcome is unknown; check its status before creating a new transaction",
      "TRANSACTION_OUTCOME_UNKNOWN",
      { ...details, cause },
    ),
    { retryable: false as const },
  )

/** Delegate nonce and expiry belong to these options, not the outer transaction plan.
 * A plan nonce is rejected; plan strictNonce and nonceIndex do not select delegate policy. */
export type DelegateSigningOptions = {
  receiverId?: string
  /** Explicit expiry; otherwise current height plus blockHeightOffset (default 200). */
  maxBlockHeight?: bigint
  blockHeightOffset?: number
  nonce?: bigint
  publicKey?: string | PublicKey
}
export type DelegateOptions<F extends DelegateActionPayloadFormat = "base64"> =
  DelegateSigningOptions & { payloadFormat?: F }
export type DelegateV2Options<
  F extends DelegateActionPayloadFormat = "base64",
> = DelegateOptions<F> & {
  /** Delegate gas-key slot, independent of the outer transaction plan's nonceIndex. */
  nonceIndex?: number
}
export type DelegateActionResult<
  F extends DelegateActionPayloadFormat = "base64",
> = {
  signedDelegateAction: SignedDelegateAction
  payload: F extends "bytes" ? Uint8Array : string
  format: F
}
export type DelegateV2ActionResult<
  F extends DelegateActionPayloadFormat = "base64",
> = {
  signedDelegateAction: DelegateV2Action
  payload: F extends "bytes" ? Uint8Array : string
  format: F
}

/** The shared human-readable function-call input boundary. */
export function functionCallAction(
  method: string,
  args: object | Uint8Array = {},
  options: { gas?: Gas; attachedDeposit?: Amount } = {},
) {
  return actions.functionCall(
    method,
    args instanceof Uint8Array
      ? args
      : new TextEncoder().encode(JSON.stringify(args)),
    BigInt(options.gas ? normalizeGas(options.gas) : DEFAULT_FUNCTION_CALL_GAS),
    BigInt(
      options.attachedDeposit ? normalizeAmount(options.attachedDeposit) : "0",
    ),
  )
}

/** Actions are Borsh data: structuredClone preserves their bigint, Map and byte values. */
export const make = (plan: TransactionPlan): TransactionPlan => {
  if (plan.nonceIndex !== undefined) validateNonceIndex(plan.nonceIndex)
  return {
    ...plan,
    actions: structuredClone([...plan.actions]),
    ...(plan.nonce !== undefined ? { nonce: validateNonce(plan.nonce) } : {}),
  }
}

export function validateNonce(nonce: bigint | number): bigint {
  if (
    typeof nonce !== "bigint" &&
    (typeof nonce !== "number" || !Number.isSafeInteger(nonce))
  )
    throw new NearError(
      `Transaction nonce must be a safe integer or a bigint, got ${nonce}`,
      "INVALID_TRANSACTION",
    )
  const value = BigInt(nonce)
  if (value <= 0n || value > 0xffff_ffff_ffff_ffffn)
    throw new NearError(
      `Transaction nonce must be a positive integer that fits in a u64, got ${nonce}`,
      "INVALID_TRANSACTION",
    )
  return value
}

export const transactionInput = <A>(operation: () => A) =>
  inputEffect(operation, "Transaction.encoding")

export const resolveKey = Effect.fn("Transaction.resolveKey")(function* (
  plan: TransactionPlan,
  dependencies: TransactionDependencies,
) {
  if (plan.keyPair) return plan.keyPair
  yield* dependencies.ready ?? Effect.void
  const key = yield* dependencies.keyStore.get(plan.signerId)
  if (!key)
    return yield* Effect.fail(
      new InvalidKeyError(`No key found for account: ${plan.signerId}`),
    )
  return key
})

export function validateNonceIndex(index: number): void {
  if (!Number.isInteger(index) || index < 0 || index > 65535)
    throw new NearError(
      `Gas key nonceIndex must be an integer in 0..=65535, got ${index}`,
      "INVALID_TRANSACTION",
    )
}

const gasKeySlots = Effect.fn("Transaction.gasKeySlots")(function* (
  plan: TransactionPlan,
  dependencies: TransactionDependencies,
  publicKey: string,
  nonceIndex: number,
) {
  const result = yield* dependencies.rpc.call<{ nonces?: unknown }>(
    "EXPERIMENTAL_view_gas_key_nonces",
    {
      finality: "optimistic",
      account_id: plan.signerId,
      public_key: publicKey,
    },
  )
  const nonces = result?.nonces
  if (
    !Array.isArray(nonces) ||
    !Number.isInteger(nonceIndex) ||
    nonceIndex < 0 ||
    nonceIndex >= nonces.length
  )
    return yield* Effect.fail(
      new NearError(
        `Gas key ${publicKey} on ${plan.signerId} has no nonce slot ${nonceIndex}`,
        "INVALID_TRANSACTION",
      ),
    )
  return nonces
})
const chainNonce = Effect.fn("Transaction.chainNonce")(function* (
  plan: TransactionPlan,
  dependencies: TransactionDependencies,
  publicKey: string,
  nonceIndex?: number,
) {
  if (nonceIndex === undefined) {
    const key = yield* dependencies.rpc.getAccessKey(plan.signerId, publicKey)
    return yield* transactionInput(() => BigInt(key.nonce))
  }
  const slots = yield* gasKeySlots(plan, dependencies, publicKey, nonceIndex)
  const raw: unknown = slots[nonceIndex]
  if (typeof raw === "number" && !Number.isSafeInteger(raw))
    return yield* Effect.fail(
      new NearError(
        `Gas key nonce slot ${nonceIndex} is not a safe integer: ${raw}`,
        "INVALID_TRANSACTION",
      ),
    )
  if (typeof raw === "number" || typeof raw === "string")
    return yield* transactionInput(() => BigInt(raw))
  return yield* Effect.fail(
    new NearError(
      `Gas key nonce slot ${nonceIndex} has an unexpected type: ${typeof raw}`,
      "INVALID_TRANSACTION",
    ),
  )
})
const nonceKey = (publicKey: string, index?: number) =>
  index === undefined ? publicKey : `${publicKey}#${index}`
const nonceValue = (nonce: bigint, index?: number): TransactionNonceBorsh =>
  index === undefined
    ? { nonce: { nonce } }
    : { gasKeyNonce: { nonce, nonceIndex: index } }

const prepare = Effect.fn("Transaction.prepare")(function* (
  plan: TransactionPlan,
  dependencies: TransactionDependencies,
  key: Effect.Effect<KeyPair, NearFailure>,
  versioned: boolean,
) {
  if (!plan.receiverId)
    return yield* Effect.fail(
      new NearError(
        "No receiver ID set for transaction",
        "INVALID_TRANSACTION",
      ),
    )
  const keyPair = yield* key
  // PublicKey can be supplied by a structural key provider. Own its bytes before any further await.
  const publicKey = yield* transactionInput(() =>
    parsePublicKey(keyPair.publicKey.toString()),
  )
  const index = versioned ? plan.nonceIndex : undefined
  const publicKeyString = publicKey.toString()
  let nonce: bigint
  if (plan.nonce !== undefined) {
    if (index !== undefined)
      yield* gasKeySlots(plan, dependencies, publicKeyString, index)
    nonce = plan.nonce
  } else {
    const lookup = chainNonce(plan, dependencies, publicKeyString, index)
    nonce =
      versioned && plan.strictNonce
        ? (yield* lookup) + 1n
        : yield* dependencies.nonces.reserve(
            plan.signerId,
            nonceKey(publicKeyString, index),
            lookup,
          )
  }
  const block = yield* dependencies.rpc.getBlock({ finality: "final" })
  const transaction: UnsignedTransaction = {
    signerId: plan.signerId,
    publicKey,
    nonce,
    receiverId: plan.receiverId,
    actions: [...plan.actions],
    blockHash: yield* transactionInput(() => base58.decode(block.header.hash)),
  }
  return transaction
})

/** Compatibility projection for the public Promise builder's historical unsigned V0 API. */
export const legacyBuild = Effect.fn("Transaction.legacyBuild")(function* (
  input: TransactionPlan,
  dependencies: TransactionDependencies,
  key?: Effect.Effect<KeyPair, NearFailure>,
) {
  const plan = yield* transactionInput(() => make(input))
  return yield* prepare(
    plan,
    dependencies,
    key ?? resolveKey(plan, dependencies),
    false,
  )
})

const unsignedValue = (
  plan: TransactionPlan,
  transaction: UnsignedTransaction,
): UnsignedTransactionValue =>
  plan.nonceIndex !== undefined || plan.strictNonce
    ? {
        version: 1,
        transaction: {
          ...transaction,
          nonce: nonceValue(transaction.nonce, plan.nonceIndex),
          nonceMode: plan.strictNonce ? { strict: {} } : { monotonic: {} },
        },
      }
    : { version: 0, transaction }

/** Build owned unsigned data with the same nonce domain and wire version as signing. */
export const build = Effect.fn("Transaction.build")(function* (
  input: TransactionPlan,
  dependencies: TransactionDependencies,
) {
  const plan = yield* transactionInput(() => make(input))
  const transaction = yield* prepare(
    plan,
    dependencies,
    resolveKey(plan, dependencies),
    true,
  )
  return unsignedValue(plan, transaction)
})

const signOwned = Effect.fn("Transaction.sign")(function* (
  plan: TransactionPlan,
  dependencies: TransactionDependencies,
  key?: Effect.Effect<KeyPair, NearFailure>,
): Effect.fn.Return<SignedTransactionValue, NearFailure> {
  if (!plan.receiverId)
    return yield* Effect.fail(
      new NearError(
        "No receiver ID set for transaction",
        "INVALID_TRANSACTION",
      ),
    )
  const signer = plan.signer ?? (plan.keyPair ? undefined : dependencies.signer)
  const keyPair = yield* key ?? resolveKey(plan, dependencies)
  const signDigest =
    signer ??
    (yield* transactionInput(() => {
      const signKey = keyPair.sign.bind(keyPair)
      return (digest: Uint8Array) => transactionInput(() => signKey(digest))
    }))
  const transaction = yield* prepare(
    plan,
    dependencies,
    Effect.succeed(keyPair),
    true,
  )
  const unsigned = unsignedValue(plan, transaction)
  const bytes = yield* transactionInput(() =>
    unsigned.version === 1
      ? serializeTransactionV1(unsigned.transaction)
      : serializeTransaction(unsigned.transaction),
  )
  const digest = sha256(bytes)
  const hash = base58.encode(digest)
  const signature = yield* signDigest(digest.slice())
  // Never reserialize a live transaction after asynchronous signing. Both wire versions
  // are precisely the captured unsigned commitment followed by the signature encoding.
  const wire = yield* transactionInput(() => {
    const encodedSignature = SignatureSchema.serialize(
      signatureToZorsh(signature),
    )
    const signed = new Uint8Array(bytes.length + encodedSignature.length)
    signed.set(bytes)
    signed.set(encodedSignature, bytes.length)
    return signed
  })
  return Object.freeze({
    hash,
    signerId: transaction.signerId,
    receiverId: transaction.receiverId,
    publicKey: transaction.publicKey.toString(),
    nonce: transaction.nonce,
    ...(plan.nonceIndex !== undefined ? { nonceIndex: plan.nonceIndex } : {}),
    serialize: () => wire.slice(),
  }) satisfies SignedTransactionValue
})

export const sign = Effect.fn("Transaction.acquireSign")(function* (
  input: TransactionPlan,
  dependencies: TransactionDependencies,
  key?: Effect.Effect<KeyPair, NearFailure>,
) {
  const plan = yield* transactionInput(() => make(input))
  return yield* signOwned(plan, dependencies, key)
})

const withTransaction = <W extends keyof FinalExecutionOutcomeMap>(
  signed: SignedTransactionValue,
  result: FinalExecutionOutcomeMap[W],
): FinalExecutionOutcomeMap[W] => {
  return (
    "transaction" in result && result.transaction
      ? result
      : {
          ...result,
          transaction: {
            hash: signed.hash,
            signer_id: signed.signerId,
            receiver_id: signed.receiverId,
            nonce: Number(signed.nonce),
          },
        }
  ) as FinalExecutionOutcomeMap[W]
}

const reconcile = Effect.fn("Transaction.reconcile")(function* <
  W extends keyof FinalExecutionOutcomeMap,
>(
  signed: SignedTransactionValue,
  dependencies: TransactionDependencies,
  waitUntil: W,
  failure: unknown,
) {
  return yield* dependencies.rpc
    .getTransactionStatus(signed.hash, signed.signerId, waitUntil)
    .pipe(
      Effect.filterOrFail(
        (result) =>
          !result.transaction ||
          (result.transaction.hash === signed.hash &&
            result.transaction.signer_id === signed.signerId &&
            result.transaction.receiver_id === signed.receiverId &&
            result.transaction.nonce === Number(signed.nonce)),
        () =>
          new NearError(
            "RPC status returned a different transaction",
            "TRANSACTION_STATUS_MISMATCH",
          ),
      ),
      Effect.map((result) => withTransaction<W>(signed, result)),
      Effect.mapError((lookupFailure) =>
        transactionOutcomeUnknown(originalCause(failure), {
          hash: signed.hash,
          sender: signed.signerId,
          lookupCause: originalCause(lookupFailure),
        }),
      ),
    )
})

export const broadcast = Effect.fn("Transaction.broadcast")(function* <
  W extends keyof FinalExecutionOutcomeMap = "EXECUTED_OPTIMISTIC",
>(
  signed: SignedTransactionValue,
  dependencies: TransactionDependencies,
  options?: SendOptions<W>,
): Effect.fn.Return<FinalExecutionOutcomeMap[W], NearFailure> {
  const waitUntil = (options?.waitUntil ??
    dependencies.defaultWaitUntil ??
    "EXECUTED_OPTIMISTIC") as W
  const bytes = yield* transactionInput(() => signed.serialize())
  const result = yield* dependencies.rpc.sendTransaction(bytes, waitUntil).pipe(
    Effect.catch((failure) =>
      Effect.gen(function* () {
        const error = originalCause(failure)
        // Preserve nonretryable execution failures; uncertain validation errors must not
        // encourage a caller to create a new transaction after possible acceptance.
        if (
          error instanceof FunctionCallError ||
          (error instanceof InvalidTransactionError &&
            error.retryable === false)
        )
          return yield* Effect.fail(failure)
        return yield* reconcile(signed, dependencies, waitUntil, failure)
      }),
    ),
  )
  return withTransaction(signed, result)
})

const reached: Record<TxExecutionStatus, readonly TxExecutionStatus[]> = {
  NONE: ["NONE"],
  INCLUDED: ["NONE", "INCLUDED"],
  INCLUDED_FINAL: ["NONE", "INCLUDED", "INCLUDED_FINAL"],
  EXECUTED_OPTIMISTIC: ["NONE", "INCLUDED", "EXECUTED_OPTIMISTIC"],
  EXECUTED: [
    "NONE",
    "INCLUDED",
    "INCLUDED_FINAL",
    "EXECUTED_OPTIMISTIC",
    "EXECUTED",
  ],
  FINAL: [
    "NONE",
    "INCLUDED",
    "INCLUDED_FINAL",
    "EXECUTED_OPTIMISTIC",
    "EXECUTED",
    "FINAL",
  ],
}

/** Shared submission owner. The supplied signing Effect lets the Promise edge retain
 * completed commitments even when a later transport result is ambiguous. */
export const submit = Effect.fn("Transaction.submit")(function* <
  W extends keyof FinalExecutionOutcomeMap = "EXECUTED_OPTIMISTIC",
>(
  plan: TransactionPlan,
  dependencies: TransactionDependencies,
  signing: Effect.Effect<SignedTransactionValue, NearFailure>,
  cached?: SignedTransactionValue,
  options?: SendOptions<W>,
): Effect.fn.Return<FinalExecutionOutcomeMap[W], NearFailure> {
  if (!plan.receiverId)
    return yield* Effect.fail(
      new NearError(
        "No receiver ID set for transaction",
        "INVALID_TRANSACTION",
      ),
    )
  const waitUntil = (options?.waitUntil ??
    dependencies.defaultWaitUntil ??
    "EXECUTED_OPTIMISTIC") as W
  const wallet = dependencies.wallet
  if (wallet) {
    if (plan.nonce !== undefined)
      return yield* Effect.fail(
        new NearError(
          "An explicit nonce cannot be used with a wallet: the wallet chooses the transaction nonce",
          "INVALID_TRANSACTION",
        ),
      )
    const result = yield* wallet.signAndSendTransaction({
      signerId: plan.signerId,
      receiverId: plan.receiverId,
      actions: [...plan.actions],
    })
    const failed =
      typeof result.status === "object" && "Failure" in result.status
    if (!failed && reached[result.final_execution_status]?.includes(waitUntil))
      return result as FinalExecutionOutcomeMap[W]
    if (!result.transaction?.hash)
      return yield* Effect.fail(
        new NearError(
          "Wallet did not return a transaction hash for status lookup",
          "INVALID_TRANSACTION",
        ),
      )
    return (yield* dependencies.rpc.getTransactionStatus(
      result.transaction.hash,
      result.transaction.signer_id,
      waitUntil,
    )) as FinalExecutionOutcomeMap[W]
  }
  // A correlated rejection can be a hidden browser/proxy replay of accepted bytes.
  // Sign once; even the first observable InvalidNonce must reconcile this hash.
  const signed = cached ?? (yield* signing)
  return yield* broadcast(signed, dependencies, { waitUntil })
})

export const send = Effect.fn("Transaction.send")(function* <
  W extends keyof FinalExecutionOutcomeMap = "EXECUTED_OPTIMISTIC",
>(
  input: TransactionPlan,
  dependencies: TransactionDependencies,
  options?: SendOptions<W>,
): Effect.fn.Return<FinalExecutionOutcomeMap[W], NearFailure> {
  const plan = yield* transactionInput(() => make(input))
  return yield* submit(
    plan,
    dependencies,
    signOwned(plan, dependencies),
    undefined,
    options,
  )
})

const delegateReceiver = (
  plan: TransactionPlan,
  version: "delegate" | "delegateV2",
  options: DelegateSigningOptions,
) =>
  transactionInput(() => {
    if (plan.nonce !== undefined)
      throw new NearError(
        version === "delegate"
          ? ".nonce() sets the outer transaction nonce and cannot be used with delegate(). Use delegate({ nonce }) for local signing; wallets choose their own delegate nonce."
          : ".nonce() sets the outer transaction nonce and cannot be used with delegateV2(). Use delegateV2({ nonce }) for local signing, with nonceIndex for a gas-key slot.",
        "INVALID_TRANSACTION",
      )
    if (!plan.actions.length)
      throw new NearError(
        "Delegate action requires at least one action to perform",
        "INVALID_TRANSACTION",
      )
    if (
      plan.actions.some(
        (action) =>
          "signedDelegate" in action ||
          (version === "delegateV2" && "delegateV2" in action),
      )
    )
      throw new NearError(
        version === "delegate"
          ? "Delegate actions cannot contain nested signed delegate actions"
          : "Delegate actions cannot contain nested delegate actions",
        "INVALID_TRANSACTION",
      )
    const receiver = options.receiverId ?? plan.receiverId
    if (!receiver)
      throw new NearError(
        "Delegate action requires a receiver. Set receiverId via the first action or provide it explicitly.",
        "INVALID_TRANSACTION",
      )
    return receiver
  })
const delegateKey = Effect.fn("Transaction.delegateKey")(function* (
  key: Effect.Effect<KeyPair, NearFailure>,
  requested?: string | PublicKey,
) {
  const keyPair = yield* key
  const ownPublicKey = yield* transactionInput(() =>
    keyPair.publicKey.toString(),
  )
  const publicKey = yield* transactionInput(() =>
    parsePublicKey(
      typeof requested === "string"
        ? requested
        : requested
          ? requested.toString()
          : ownPublicKey,
    ),
  )
  if (publicKey.toString() !== ownPublicKey)
    return yield* Effect.fail(
      new InvalidKeyError(
        "Delegate action public key must match the signer key. Use signWith() when you need a different key.",
      ),
    )
  const signKey = yield* transactionInput(() => keyPair.sign.bind(keyPair))
  return { signKey, publicKey }
})
const delegateNonce = Effect.fn("Transaction.delegateNonce")(function* (
  plan: TransactionPlan,
  dependencies: TransactionDependencies,
  publicKey: PublicKey,
  explicit?: bigint,
  index?: number,
) {
  if (index !== undefined)
    yield* transactionInput(() => validateNonceIndex(index))
  if (explicit !== undefined) return explicit
  const key = publicKey.toString()
  const lookup = chainNonce(plan, dependencies, key, index)
  return index === undefined
    ? (yield* lookup) + 1n
    : yield* dependencies.nonces.reserve(
        plan.signerId,
        nonceKey(key, index),
        lookup,
      )
})
const delegateExpiry = Effect.fn("Transaction.delegateExpiry")(function* (
  dependencies: TransactionDependencies,
  options: DelegateSigningOptions,
) {
  if (options.maxBlockHeight !== undefined) return options.maxBlockHeight
  const status = yield* dependencies.rpc.getStatus()
  return yield* transactionInput(
    () =>
      BigInt(status.sync_info.latest_block_height) +
      BigInt(options.blockHeightOffset ?? 200),
  )
})

export const delegate = Effect.fn("Transaction.delegate")(function* <
  F extends DelegateActionPayloadFormat = "base64",
>(
  input: TransactionPlan,
  dependencies: TransactionDependencies,
  options?: DelegateOptions<F>,
  key?: Effect.Effect<KeyPair, NearFailure>,
): Effect.fn.Return<DelegateActionResult<F>, NearFailure> {
  const plan = yield* transactionInput(() => make(input))
  const opts = { ...options }
  const requestedKey = opts.publicKey
  if (requestedKey !== undefined)
    opts.publicKey = yield* transactionInput(() =>
      typeof requestedKey === "string" ? requestedKey : requestedKey.toString(),
    )
  const receiverId = yield* delegateReceiver(plan, "delegate", opts)
  let signedDelegateAction: SignedDelegateAction
  if (dependencies.wallet?.signDelegateActions) {
    const result = yield* dependencies.wallet.signDelegateActions({
      signerId: plan.signerId,
      delegateActions: [{ actions: [...plan.actions], receiverId }],
    })
    const first = result.signedDelegateActions[0]
    if (!first)
      return yield* Effect.fail(
        new NearError(
          "Wallet did not return a signed delegate action",
          "WALLET_ERROR",
        ),
      )
    signedDelegateAction = structuredClone(first.signedDelegate)
  } else {
    const { signKey, publicKey } = yield* delegateKey(
      key ?? resolveKey(plan, dependencies),
      opts.publicKey,
    )
    const nonce = yield* delegateNonce(
      plan,
      dependencies,
      publicKey,
      opts.nonce,
    )
    const maxBlockHeight = yield* delegateExpiry(dependencies, opts)
    const action = new actions.DelegateAction(
      plan.signerId,
      receiverId,
      plan.actions.map((action) => action as ClassicAction),
      nonce,
      maxBlockHeight,
      publicKey,
    )
    const signature = yield* transactionInput(() =>
      signKey(sha256(serializeDelegateAction(action))),
    )
    signedDelegateAction = actions.signedDelegate(action, signature)
  }
  const format = (opts.payloadFormat ?? "base64") as F
  const payload = yield* transactionInput(() =>
    encodeSignedDelegateAction(signedDelegateAction, format),
  )
  return { signedDelegateAction, payload, format }
})

export const delegateV2 = Effect.fn("Transaction.delegateV2")(function* <
  F extends DelegateActionPayloadFormat = "base64",
>(
  input: TransactionPlan,
  dependencies: TransactionDependencies,
  options?: DelegateV2Options<F>,
  key?: Effect.Effect<KeyPair, NearFailure>,
): Effect.fn.Return<DelegateV2ActionResult<F>, NearFailure> {
  const plan = yield* transactionInput(() => make(input))
  const opts = { ...options }
  const requestedKey = opts.publicKey
  if (requestedKey !== undefined)
    opts.publicKey = yield* transactionInput(() =>
      typeof requestedKey === "string" ? requestedKey : requestedKey.toString(),
    )
  const receiverId = yield* delegateReceiver(plan, "delegateV2", opts)
  const { signKey, publicKey } = yield* delegateKey(
    key ?? resolveKey(plan, dependencies),
    opts.publicKey,
  )
  const nonce = yield* delegateNonce(
    plan,
    dependencies,
    publicKey,
    opts.nonce,
    opts.nonceIndex,
  )
  const maxBlockHeight = yield* delegateExpiry(dependencies, opts)
  const action = new actions.DelegateActionV2(
    plan.signerId,
    receiverId,
    plan.actions as NonDelegateActionBorsh[],
    nonceValue(nonce, opts.nonceIndex),
    maxBlockHeight,
    publicKey,
  )
  const signature = yield* transactionInput(() =>
    signKey(sha256(serializeDelegateActionV2(action.toBorsh()))),
  )
  const signedDelegateAction = actions.signedDelegateV2(action, signature)
  const format = (opts.payloadFormat ?? "base64") as F
  const payload = yield* transactionInput(() =>
    encodeSignedDelegateActionV2(signedDelegateAction, format),
  )
  return { signedDelegateAction, payload, format }
})

/** One dependency binding for native applications; terminal operations consume data directly. */
export const transactions = (dependencies: TransactionDependencies) => ({
  build: (plan: TransactionPlan) => build(plan, dependencies),
  sign: (plan: TransactionPlan) => sign(plan, dependencies),
  send: <W extends keyof FinalExecutionOutcomeMap = "EXECUTED_OPTIMISTIC">(
    plan: TransactionPlan,
    options?: SendOptions<W>,
  ) => send(plan, dependencies, options),
  broadcast: <W extends keyof FinalExecutionOutcomeMap = "EXECUTED_OPTIMISTIC">(
    signed: SignedTransactionValue,
    options?: SendOptions<W>,
  ) => broadcast(signed, dependencies, options),
  delegate: <F extends DelegateActionPayloadFormat = "base64">(
    plan: TransactionPlan,
    options?: DelegateOptions<F>,
  ) => delegate(plan, dependencies, options),
  delegateV2: <F extends DelegateActionPayloadFormat = "base64">(
    plan: TransactionPlan,
    options?: DelegateV2Options<F>,
  ) => delegateV2(plan, dependencies, options),
})
