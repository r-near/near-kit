import { walletService, type WalletService } from "../effect/wallet.js"
import type { RpcPrograms } from "./rpc/rpc-program.js"
import { rpcFromPromises } from "./rpc/rpc.js"
/**
 * Fluent API for building and sending NEAR transactions.
 *
 * Allows chaining multiple actions (transfers, function calls, account creation, etc.)
 * into a single atomic transaction. All actions either succeed together or fail together.
 *
 * The builder is created via {@link Near.transaction} with a signer account ID. This
 * account must have signing credentials available (via keyStore, privateKey, custom
 * signer, or wallet connection).
 *
 * @example
 * ```typescript
 * // Single action
 * await near.transaction('alice.near')
 *   .transfer('bob.near', '10 NEAR')
 *   .send()
 *
 * // Multiple actions (atomic)
 * await near.transaction('alice.near')
 *   .createAccount('sub.alice.near')
 *   .transfer('sub.alice.near', '5 NEAR')
 *   .addKey(newKey, { type: 'fullAccess' })
 *   .send()
 * ```
 *
 * @remarks
 * - The `signerId` (set via `Near.transaction()`) is the account that signs and pays for gas
 * - All actions execute in the order they are added
 * - Transaction is only sent when `.send()` is called
 * - Use `.build()` to get unsigned transaction
 */

import { sha256 } from "@noble/hashes/sha2.js"
import { base58 } from "@scure/base"
import * as Effect from "effect/Effect"
import * as Schedule from "effect/Schedule"
import { keyStoreService, type KeyStoreService } from "../effect/keys.js"
import {
  type NonceReservationService,
  sharedNonceReservation,
} from "../effect/nonce.js"
import {
  ExternalError,
  fromPromise,
  runPromise,
  type NearFailure,
} from "../effect/runtime.js"
import {
  InvalidKeyError,
  InvalidNonceError,
  NearError,
} from "../errors/index.js"
import { parseKey, parsePublicKey } from "../utils/key.js"
import { deriveAccountId } from "../utils/state-init.js"
import {
  type Amount,
  type Gas,
  normalizeAmount,
  normalizeGas,
  type PrivateKey,
} from "../utils/validation.js"
import * as actions from "./actions.js"
import { DEFAULT_FUNCTION_CALL_GAS } from "./constants.js"
import type { RpcClient } from "./rpc/rpc.js"
import {
  type AccessKeyPermissionBorsh,
  type ClassicAction,
  type DelegateActionPayloadFormat,
  type DelegateV2Action,
  encodeSignedDelegateAction,
  encodeSignedDelegateActionV2,
  type NonDelegateActionBorsh,
  serializeDelegateAction,
  serializeDelegateActionV2,
  serializeSignedTransaction,
  serializeSignedTransactionV1,
  serializeTransaction,
  serializeTransactionV1,
  type SignedDelegateAction,
  type TransactionNonceBorsh,
  type TransactionV1,
} from "./schema.js"
import type {
  Action,
  FinalExecutionOutcomeMap,
  GlobalContractReference,
  KeyPair,
  KeyStore,
  PublicKey,
  SendOptions,
  SignedTransaction,
  Signer,
  Transaction,
  TxExecutionStatus,
  WalletConnection,
} from "./types.js"

/**
 * User-friendly access key permission format.
 *
 * The two `gasKey*` variants add a gas key (protocol v85 / NEAR 2.13): an access
 * key with a prepaid balance for gas and `numNonces` parallel nonce slots. The
 * key is always added with a zero balance; fund it afterwards with
 * {@link TransactionBuilder.transferToGasKey}. A gas function-call key cannot
 * carry an `allowance`.
 */
export type AccessKeyPermission =
  | { type: "fullAccess" }
  | {
      type: "functionCall"
      receiverId: string
      methodNames?: string[]
      allowance?: Amount
    }
  | { type: "gasKeyFullAccess"; numNonces: number }
  | {
      type: "gasKeyFunctionCall"
      numNonces: number
      receiverId: string
      methodNames?: string[]
    }

export type TransactionError = NearFailure

/** Resolved native dependencies shared by both transaction API projections. */
export interface TransactionDependencies {
  readonly rpc: RpcPrograms
  readonly keyStore: KeyStoreService
  readonly nonces: NonceReservationService
  readonly ready?: Effect.Effect<void, NearFailure>
  readonly wallet?: WalletService
  readonly signer?: Signer
  readonly defaultWaitUntil?: TxExecutionStatus
}

type DelegateSigningOptions = {
  receiverId?: string
  /**
   * Explicit block height at which the delegate action expires.
   * If omitted, uses the current block height plus `blockHeightOffset`.
   */
  maxBlockHeight?: bigint
  /**
   * Number of blocks after the current height when the delegate action should expire.
   * Defaults to 200 blocks if neither this nor `maxBlockHeight` is provided.
   */
  blockHeightOffset?: number
  /**
   * Override nonce to use for the delegate action. If omitted, the builder fetches
   * the access key and uses (nonce + 1).
   */
  nonce?: bigint
  /**
   * Explicit public key to embed in the delegate action. Only required when the key
   * cannot be resolved from the configured key store.
   */
  publicKey?: string | PublicKey
}

type DelegateOptions<F extends DelegateActionPayloadFormat = "base64"> =
  DelegateSigningOptions & { payloadFormat?: F }

export type DelegateActionResult<
  F extends DelegateActionPayloadFormat = "base64",
> = {
  signedDelegateAction: SignedDelegateAction
  payload: F extends "bytes" ? Uint8Array : string
  format: F
}

type DelegateV2Options<F extends DelegateActionPayloadFormat = "base64"> =
  DelegateSigningOptions & {
    payloadFormat?: F
    /**
     * Gas-key nonce slot to sign against. When set, the delegate action's nonce
     * is a `GasKeyNonce { nonce, nonceIndex }` and the per-slot nonce is fetched
     * via `EXPERIMENTAL_view_gas_key_nonces` (unless `nonce` is also given).
     */
    nonceIndex?: number
  }

export type DelegateV2ActionResult<
  F extends DelegateActionPayloadFormat = "base64",
> = {
  signedDelegateAction: DelegateV2Action
  payload: F extends "bytes" ? Uint8Array : string
  format: F
}

/**
 * Compare two public keys for byte-level equality.
 * @internal
 */
function publicKeysEqual(a: PublicKey, b: PublicKey): boolean {
  if (a.keyType !== b.keyType || a.data.length !== b.data.length) {
    return false
  }

  for (let i = 0; i < a.data.length; i += 1) {
    if (a.data[i] !== b.data[i]) {
      return false
    }
  }

  return true
}

/**
 * Convert user-friendly permission format to Borsh format.
 * @internal
 */
function toAccessKeyPermissionBorsh(
  permission: AccessKeyPermission,
): AccessKeyPermissionBorsh {
  switch (permission.type) {
    case "fullAccess":
      return { fullAccess: {} }
    case "functionCall":
      return {
        functionCall: {
          receiverId: permission.receiverId,
          methodNames: permission.methodNames || [],
          allowance: permission.allowance
            ? BigInt(normalizeAmount(permission.allowance))
            : null,
        },
      }
    case "gasKeyFullAccess":
      return actions.gasKeyFullAccess(permission.numNonces)
    case "gasKeyFunctionCall":
      // Gas function-call keys must not set an allowance (rejected on-chain).
      return actions.gasKeyFunctionCall(permission.numNonces, {
        receiverId: permission.receiverId,
        methodNames: permission.methodNames || [],
        allowance: null,
      })
    default: {
      // Exhaustiveness guard: every AccessKeyPermission variant is handled
      // above. Fail fast (rather than returning undefined) if a JS caller or
      // malformed object supplies an unknown `permission.type`.
      const unknown = permission as { type?: unknown }
      throw new NearError(
        `Unknown access key permission type: ${String(unknown.type)}`,
        "INVALID_TRANSACTION",
      )
    }
  }
}

/**
 * Fluent builder for constructing and sending NEAR transactions.
 *
 * Created via {@link Near.transaction}. Supports chaining multiple actions
 * (transfers, function calls, key management, staking, delegate actions) into
 * a single atomic transaction.
 */
export class TransactionBuilder {
  private readonly nonces: NonceReservationService

  private signerId: string
  private actions: Action[]
  private receiverId?: string
  private readonly rpcPrograms: RpcPrograms
  private readonly keyStore: KeyStoreService
  private signer?: Signer
  private keyPair?: KeyPair // KeyPair from signWith() for building transaction
  private readonly wallet?: WalletService
  private defaultWaitUntil: TxExecutionStatus
  private readonly ready: Effect.Effect<void, TransactionError>
  private cachedSignedTx?: {
    signedTx: SignedTransaction
    hash: string
    /**
     * Pre-serialized signed-transaction wire bytes. Set only for V1
     * (gas-key / strict-nonce) transactions, whose custom `[0x01]`-tagged
     * encoding is not expressible via the V0 {@link SignedTransaction} shape.
     * When present, `serialize()` / `send()` use these bytes directly.
     */
    serialized?: Uint8Array
  }
  /**
   * Gas-key nonce index for this transaction. When set, the builder signs a V1
   * transaction whose nonce is a `GasKeyNonce { nonce, nonceIndex }`.
   */
  private gasKeyNonceIndex?: number
  /**
   * Opt into strict nonce mode (`nonce === ak_nonce + 1`). Forces a V1
   * transaction even for an ordinary access key.
   */
  private strictNonce = false
  /**
   * Caller-supplied nonce set via {@link nonce}. When present it is used as-is
   * and the shared {@link NonceReservation} cache is neither read nor updated.
   */
  private explicitNonce?: bigint

  constructor(signerId: string, dependencies: TransactionDependencies)
  constructor(
    signerId: string,
    rpc: RpcClient,
    keyStore: KeyStore,
    signer?: Signer,
    defaultWaitUntil?: TxExecutionStatus,
    wallet?: WalletConnection,
    ensureKeyStoreReady?: () => Promise<void>,
    ensureKeyStoreReadyEffect?: () => Effect.Effect<void, ExternalError>,
    nonces?: NonceReservationService,
  )
  constructor(
    signerId: string,
    rpcOrDependencies: RpcClient | TransactionDependencies,
    keyStore?: KeyStore,
    signer?: Signer,
    defaultWaitUntil: TxExecutionStatus = "EXECUTED_OPTIMISTIC",
    wallet?: WalletConnection,
    ensureKeyStoreReady?: () => Promise<void>,
    ensureKeyStoreReadyEffect?: () => Effect.Effect<void, ExternalError>,
    nonces: NonceReservationService = sharedNonceReservation,
  ) {
    let dependencies: TransactionDependencies
    if ("rpc" in rpcOrDependencies) {
      dependencies = rpcOrDependencies
    } else {
      if (!keyStore) throw new InvalidKeyError("A key store is required")
      dependencies = {
        rpc: rpcFromPromises(rpcOrDependencies),
        keyStore: keyStoreService(keyStore),
        nonces,
        defaultWaitUntil,
        ...(signer ? { signer } : {}),
        ...(wallet ? { wallet: walletService(wallet) } : {}),
        ready: ensureKeyStoreReadyEffect
          ? Effect.suspend(ensureKeyStoreReadyEffect)
          : ensureKeyStoreReady
            ? fromPromise(
                () => ensureKeyStoreReady.call(this),
                "TransactionBuilder.ensureKeyStoreReady",
              )
            : Effect.void,
      }
    }
    this.signerId = signerId
    this.actions = []
    this.rpcPrograms = dependencies.rpc
    this.keyStore = dependencies.keyStore
    this.nonces = dependencies.nonces
    this.ready = dependencies.ready ?? Effect.void
    this.defaultWaitUntil =
      dependencies.defaultWaitUntil ?? "EXECUTED_OPTIMISTIC"
    if (dependencies.signer) this.signer = dependencies.signer
    if (dependencies.wallet) this.wallet = dependencies.wallet
  }

  /**
   * Invalidate cached signed transaction when builder state changes
   */
  private invalidateCache(): this {
    delete this.cachedSignedTx
    return this
  }

  /**
   * Resolve the key pair for the current signer from either `signWith()` or keyStore.
   */
  private resolveKeyPairEffect(): Effect.Effect<KeyPair, TransactionError> {
    return Effect.gen({ self: this }, function* () {
      if (this.keyPair) {
        return this.keyPair
      }
      yield* this.ready
      const keyPair = yield* this.keyStore.get(this.signerId)
      if (!keyPair) {
        return yield* Effect.fail(
          new InvalidKeyError(`No key found for account: ${this.signerId}`),
        )
      }
      // Cache the resolved key pair to ensure keyStore.get() is only called once
      // per TransactionBuilder instance. This is critical for RotatingKeyStore
      // which returns a different key on each get() call.
      this.keyPair = keyPair
      return keyPair
    }).pipe(Effect.withSpan("TransactionBuilder.resolveKeyPair"))
  }

  /**
   * Add a token transfer action.
   *
   * @param receiverId - Account ID that will receive the tokens.
   * @param amount - Amount to transfer, expressed as {@link Amount} (e.g. `"10 NEAR"`).
   *
   * @returns This builder instance for chaining.
   *
   * @remarks
   * If no receiver has been set yet, this also sets the transaction `receiverId`
   * to `receiverId`.
   */
  transfer(receiverId: string, amount: Amount): this {
    const amountYocto = normalizeAmount(amount)
    this.actions.push(actions.transfer(BigInt(amountYocto)))

    if (!this.receiverId) {
      this.receiverId = receiverId
    }

    return this.invalidateCache()
  }

  /**
   * Add a function call action.
   *
   * @param contractId - Account ID of the target contract.
   * @param methodName - Name of the change method to call.
   * @param args - Arguments object or raw bytes; defaults to `{}`.
   * @param options - Optional gas and attached deposit settings.
   *
   * @returns This builder instance for chaining.
   *
   * @remarks
   * - `options.gas` accepts human-readable values such as `"30 Tgas"` or {@link Gas.Tgas}.
   * - `options.attachedDeposit` uses {@link Amount} semantics (e.g. `"1 yocto"`).
   * - If no receiver has been set yet, this also sets the transaction `receiverId`
   *   to `contractId`.
   */
  functionCall(
    contractId: string,
    methodName: string,
    args: object | Uint8Array = {},
    options: { gas?: Gas; attachedDeposit?: Amount } = {},
  ): this {
    const argsBytes =
      args instanceof Uint8Array
        ? args
        : new TextEncoder().encode(JSON.stringify(args))

    const gas = options.gas
      ? normalizeGas(options.gas)
      : DEFAULT_FUNCTION_CALL_GAS

    const deposit = options.attachedDeposit
      ? normalizeAmount(options.attachedDeposit)
      : "0"

    this.actions.push(
      actions.functionCall(methodName, argsBytes, BigInt(gas), BigInt(deposit)),
    )

    if (!this.receiverId) {
      this.receiverId = contractId
    }

    return this.invalidateCache()
  }

  /**
   * Add a create account action
   */
  createAccount(accountId: string): this {
    this.actions.push(actions.createAccount())

    if (!this.receiverId) {
      this.receiverId = accountId
    }

    return this.invalidateCache()
  }

  /**
   * Add a delete account action.
   *
   * Deletes the account that is the **receiver of this transaction** (typically set
   * by a prior action or explicitly via the first action in the chain). The remaining
   * balance is transferred to the specified beneficiary.
   *
   * @param options - Delete account options.
   * @param options.beneficiary - Account ID that will receive the remaining NEAR balance
   *                              after the account is deleted.
   *
   * @returns This builder instance for chaining.
   *
   * @example
   * ```typescript
   * // Delete "old-account.alice.near" and send remaining funds to "alice.near"
   * await near.transaction('old-account.alice.near')
   *   .deleteAccount({ beneficiary: 'alice.near' })
   *   .send()
   * ```
   *
   * @remarks
   * - The account being deleted is the transaction receiver (set via `.transaction()` or
   *   the first action).
   * - Only the account itself can delete itself (the signer must have full access to the
   *   account being deleted).
   */
  deleteAccount(options: { beneficiary: string }): this {
    this.actions.push(actions.deleteAccount(options.beneficiary))

    // The account being deleted is the receiver of the transaction
    if (!this.receiverId) {
      this.receiverId = this.signerId
    }

    return this.invalidateCache()
  }

  /**
   * Add a deploy contract action
   */
  deployContract(accountId: string, code: Uint8Array): this {
    this.actions.push(actions.deployContract(code))

    if (!this.receiverId) {
      this.receiverId = accountId
    }

    return this.invalidateCache()
  }

  /**
   * Publish a global contract that can be reused by multiple accounts.
   *
   * Global contracts are deployed once and referenced by multiple accounts,
   * saving storage costs. Two modes are available:
   *
   * - **"account" (default)** - Contract is identified by the signer's account ID. The signer
   *   can update the contract later, and all accounts using it will automatically
   *   use the updated version. Use this when you need to push updates to users.
   *
   * - **"hash"** - Contract is identified by its code hash. This creates
   *   an immutable contract that cannot be updated. Other accounts reference it by
   *   the hash. Use this when you want guaranteed immutability.
   *
   * @param code - The compiled contract code bytes (WASM)
   * @param options - Optional configuration
   * @param options.identifiedBy - How the contract is identified and referenced:
   *   - `"account"` (default): Updatable by signer, identified by signer's account ID
   *   - `"hash"`: Immutable, identified by code hash
   *
   * @example
   * ```typescript
   * // Publish updatable contract (identified by your account) - default
   * await near.transaction(accountId)
   *   .publishContract(contractCode)
   *   .send()
   *
   * // Publish immutable contract (identified by its hash)
   * await near.transaction(accountId)
   *   .publishContract(contractCode, { identifiedBy: "hash" })
   *   .send()
   * ```
   */
  publishContract(
    code: Uint8Array,
    options?: { identifiedBy?: "hash" | "account" },
  ): this {
    this.actions.push(actions.publishContract(code, options))

    if (!this.receiverId) {
      this.receiverId = this.signerId
    }

    return this.invalidateCache()
  }

  /**
   * Deploy a contract to this account from previously published code in the global registry
   *
   * @param reference - Reference to the published contract, either:
   *                    - { codeHash: Uint8Array | string } - Reference by code hash (Uint8Array or base58 string)
   *                    - { accountId: string } - Reference by the account that published it
   *
   * @example
   * ```typescript
   * // Deploy from code hash (Uint8Array)
   * await near.transaction(accountId)
   *   .deployFromPublished({ codeHash: hashBytes })
   *   .send()
   *
   * // Deploy from code hash (base58 string)
   * await near.transaction(accountId)
   *   .deployFromPublished({ codeHash: "5FzD8..." })
   *   .send()
   *
   * // Deploy from account ID
   * await near.transaction(accountId)
   *   .deployFromPublished({ accountId: "contract-publisher.near" })
   *   .send()
   * ```
   */
  deployFromPublished(reference: GlobalContractReference): this {
    this.actions.push(actions.deployFromPublished(reference))

    if (!this.receiverId) {
      this.receiverId = this.signerId
    }

    return this.invalidateCache()
  }

  /**
   * Add a StateInit action for deploying a contract with a deterministically derived account ID.
   *
   * This enables NEP-616 deterministic AccountIds where the account ID is derived from:
   * `"0s" + hex(keccak256(borsh(state_init))[12..32])`
   *
   * The transaction's receiverId will be automatically set to the derived account ID.
   *
   * @param options - StateInit configuration
   * @param options.code - Reference to the contract code (codeHash or accountId)
   * @param options.data - Optional initial storage key-value pairs
   * @param options.deposit - Amount to attach for storage costs
   *
   * @example
   * ```typescript
   * // Deploy from a published global contract by account ID
   * await near.transaction(signerAccount)
   *   .stateInit({
   *     code: { accountId: "publisher.near" },
   *     deposit: "1 NEAR",
   *   })
   *   .send()
   *
   * // Deploy from a code hash with initial storage data
   * await near.transaction(signerAccount)
   *   .stateInit({
   *     code: { codeHash: hashBytes },
   *     data: new Map([[key1, value1]]),
   *     deposit: "2 NEAR",
   *   })
   *   .send()
   * ```
   */
  stateInit(options: {
    code: { codeHash: string | Uint8Array } | { accountId: string }
    data?: Map<Uint8Array, Uint8Array>
    deposit: Amount
  }): this {
    const depositYocto = normalizeAmount(options.deposit)
    const stateInitOptions: actions.StateInitOptions = {
      code: options.code,
      deposit: BigInt(depositYocto),
    }
    if (options.data !== undefined) {
      stateInitOptions.data = options.data
    }

    this.actions.push(actions.stateInit(stateInitOptions))

    // Set receiverId to the deterministically derived account ID
    if (!this.receiverId) {
      const deriveOptions: {
        code: typeof options.code
        data?: Map<Uint8Array, Uint8Array>
      } = {
        code: options.code,
      }
      if (options.data !== undefined) {
        deriveOptions.data = options.data
      }
      this.receiverId = deriveAccountId(deriveOptions)
    }

    return this.invalidateCache()
  }

  /**
   * Add a stake action
   */
  stake(publicKey: string, amount: Amount): this {
    const amountYocto = normalizeAmount(amount)
    const pk = parsePublicKey(publicKey)
    this.actions.push(actions.stake(BigInt(amountYocto), pk))

    // The account being staked is the receiver of the transaction
    if (!this.receiverId) {
      this.receiverId = this.signerId
    }

    return this.invalidateCache()
  }

  /**
   * Add an add key action
   *
   * The key is added to the receiverId of the transaction.
   * If receiverId is not set, it defaults to signerId.
   */
  addKey(publicKey: string, permission: AccessKeyPermission): this {
    const pk = parsePublicKey(publicKey)
    const borshPermission = toAccessKeyPermissionBorsh(permission)
    this.actions.push(actions.addKey(pk, borshPermission))

    // Set receiverId if not already set
    if (!this.receiverId) {
      this.receiverId = this.signerId
    }

    return this.invalidateCache()
  }

  /**
   * Add a delete key action
   */
  deleteKey(accountId: string, publicKey: string): this {
    const pk = parsePublicKey(publicKey)
    this.actions.push(actions.deleteKey(pk))

    if (!this.receiverId) {
      this.receiverId = accountId
    }

    return this.invalidateCache()
  }

  /**
   * Fund a gas key's prepaid balance (protocol v85 / NEAR 2.13).
   *
   * The target gas key must already exist on the receiver account (add it with
   * `.addKey(pk, { type: "gasKeyFullAccess", numNonces })`). The deposit is
   * moved from the signer's account balance into the gas key's balance, where it
   * is reserved to pay for gas when that key signs transactions.
   *
   * @param publicKey - The gas key to fund (e.g. `"ed25519:..."`).
   * @param amount - Amount to add to the gas key balance ({@link Amount}).
   *
   * @remarks
   * If no receiver has been set yet, this also sets the transaction `receiverId`
   * to `signerId` (the account that owns the gas key).
   */
  transferToGasKey(publicKey: string, amount: Amount): this {
    const amountYocto = normalizeAmount(amount)
    const pk = parsePublicKey(publicKey)
    this.actions.push(actions.transferToGasKey(pk, BigInt(amountYocto)))

    if (!this.receiverId) {
      this.receiverId = this.signerId
    }

    return this.invalidateCache()
  }

  /**
   * Withdraw NEAR from a gas key's balance back to the account (protocol v85 / NEAR 2.13).
   *
   * @param publicKey - The gas key to withdraw from (e.g. `"ed25519:..."`).
   * @param amount - Amount to move from the gas key balance to the account ({@link Amount}).
   *
   * @remarks
   * If no receiver has been set yet, this also sets the transaction `receiverId`
   * to `signerId` (the account that owns the gas key).
   */
  withdrawFromGasKey(publicKey: string, amount: Amount): this {
    const amountYocto = normalizeAmount(amount)
    const pk = parsePublicKey(publicKey)
    this.actions.push(actions.withdrawFromGasKey(pk, BigInt(amountYocto)))

    if (!this.receiverId) {
      this.receiverId = this.signerId
    }

    return this.invalidateCache()
  }

  /**
   * Build and sign a delegate action from the queued actions.
   *
   * @param options - Optional overrides for receiver, nonce, and expiration
   */
  /**
   * Add a signed delegate action to this transaction (for relayers).
   */
  signedDelegateAction(signedDelegate: SignedDelegateAction): this {
    this.actions.push(signedDelegate)
    this.receiverId = signedDelegate.signedDelegate.delegateAction.senderId
    return this.invalidateCache()
  }

  /**
   * Add a V2 signed delegate action to this transaction, for relayers
   * (gas-key meta-transactions, NEAR 2.13).
   *
   * The receiver is set to the V2 delegate action's sender (the account whose
   * actions are being relayed).
   */
  signedDelegateActionV2(signedDelegate: DelegateV2Action): this {
    this.actions.push(signedDelegate)
    this.receiverId = signedDelegate.delegateV2.delegateAction.v2.senderId
    return this.invalidateCache()
  }

  /**
   * Build and sign a delegate action from the queued actions.
   *
   * @returns Structured delegate action plus an encoded payload (`base64` by default)
   */
  delegate<F extends DelegateActionPayloadFormat = "base64">(
    options?: DelegateOptions<F>,
  ): Promise<DelegateActionResult<F>> {
    return runPromise(this.delegateEffect(options))
  }

  delegateEffect<F extends DelegateActionPayloadFormat = "base64">(
    options?: DelegateOptions<F>,
  ): Effect.Effect<DelegateActionResult<F>, TransactionError> {
    return Effect.gen({ self: this }, function* () {
      const opts = options ?? {}
      const receiverId = yield* this.delegateReceiverEffect("delegate", opts)
      let signedDelegateAction: SignedDelegateAction
      if (this.wallet?.signDelegateActions) {
        const result = yield* this.wallet.signDelegateActions({
          signerId: this.signerId,
          delegateActions: [{ actions: this.actions, receiverId }],
        })
        const first = result.signedDelegateActions[0]
        if (!first)
          return yield* Effect.fail(
            new NearError(
              "Wallet did not return a signed delegate action",
              "WALLET_ERROR",
            ),
          )
        signedDelegateAction = first.signedDelegate
      } else {
        const { keyPair, publicKey } = yield* this.delegateKeyEffect(
          opts.publicKey,
        )
        const nonce = yield* this.delegateNonceEffect(publicKey, opts.nonce)
        const maxBlockHeight = yield* this.delegateExpiryEffect(opts)
        const delegateAction = new actions.DelegateAction(
          this.signerId,
          receiverId,
          this.actions.map((action) => action as ClassicAction),
          nonce,
          maxBlockHeight,
          publicKey,
        )
        const signature = yield* transactionSync(() =>
          keyPair.sign(sha256(serializeDelegateAction(delegateAction))),
        )
        signedDelegateAction = actions.signedDelegate(delegateAction, signature)
      }
      const format = (opts.payloadFormat ?? "base64") as F
      const payload = yield* transactionSync(() =>
        encodeSignedDelegateAction(signedDelegateAction, format),
      )
      return { signedDelegateAction, payload, format }
    }).pipe(Effect.withSpan("TransactionBuilder.delegate"))
  }

  /**
   * Build and sign a V2 delegate action (gas-key meta-transactions, NEAR 2.13).
   *
   * Like {@link delegate} but produces a `DelegateActionV2`, signed under the
   * DISTINCT V2 NEP-461 domain tag. Pass `nonceIndex` to sign against a gas
   * key's nonce slot (the nonce then carries that index); otherwise an ordinary
   * key nonce is used. A relayer wraps the returned payload in a transaction via
   * {@link signedDelegateActionV2}.
   *
   * @returns The structured V2 signed delegate action plus an encoded payload
   *   (`base64` by default).
   */
  delegateV2<F extends DelegateActionPayloadFormat = "base64">(
    options?: DelegateV2Options<F>,
  ): Promise<DelegateV2ActionResult<F>> {
    return runPromise(this.delegateV2Effect(options))
  }

  delegateV2Effect<F extends DelegateActionPayloadFormat = "base64">(
    options?: DelegateV2Options<F>,
  ): Effect.Effect<DelegateV2ActionResult<F>, TransactionError> {
    return Effect.gen({ self: this }, function* () {
      const opts = options ?? {}
      const receiverId = yield* this.delegateReceiverEffect("delegateV2", opts)
      const { keyPair, publicKey } = yield* this.delegateKeyEffect(
        opts.publicKey,
      )
      const nonce = yield* this.delegateNonceEffect(
        publicKey,
        opts.nonce,
        opts.nonceIndex,
      )
      const maxBlockHeight = yield* this.delegateExpiryEffect(opts)
      const delegateAction = new actions.DelegateActionV2(
        this.signerId,
        receiverId,
        this.actions as NonDelegateActionBorsh[],
        transactionNonce(nonce, opts.nonceIndex),
        maxBlockHeight,
        publicKey,
      )
      const signature = yield* transactionSync(() =>
        keyPair.sign(
          sha256(serializeDelegateActionV2(delegateAction.toBorsh())),
        ),
      )
      const signedDelegateAction = actions.signedDelegateV2(
        delegateAction,
        signature,
      )
      const format = (opts.payloadFormat ?? "base64") as F
      const payload = yield* transactionSync(() =>
        encodeSignedDelegateActionV2(signedDelegateAction, format),
      )
      return { signedDelegateAction, payload, format }
    }).pipe(Effect.withSpan("TransactionBuilder.delegateV2"))
  }

  private delegateReceiverEffect(
    version: "delegate" | "delegateV2",
    options: DelegateSigningOptions,
  ) {
    return transactionSync(() => {
      if (this.explicitNonce !== undefined)
        throw new NearError(
          version === "delegate"
            ? ".nonce() sets the outer transaction nonce and cannot be used with delegate(). Use delegate({ nonce }) for local signing; wallets choose their own delegate nonce."
            : ".nonce() sets the outer transaction nonce and cannot be used with delegateV2(). Use delegateV2({ nonce }) for local signing, with nonceIndex for a gas-key slot.",
          "INVALID_TRANSACTION",
        )
      if (this.actions.length === 0)
        throw new NearError(
          "Delegate action requires at least one action to perform",
          "INVALID_TRANSACTION",
        )
      if (
        this.actions.some(
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
      const receiverId = options.receiverId ?? this.receiverId
      if (!receiverId)
        throw new NearError(
          "Delegate action requires a receiver. Set receiverId via the first action or provide it explicitly.",
          "INVALID_TRANSACTION",
        )
      return receiverId
    })
  }

  private delegateKeyEffect(requested?: string | PublicKey) {
    return Effect.gen({ self: this }, function* () {
      const keyPair = yield* this.resolveKeyPairEffect()
      const publicKey =
        typeof requested === "string"
          ? yield* transactionSync(() => parsePublicKey(requested))
          : (requested ?? keyPair.publicKey)
      if (!publicKeysEqual(publicKey, keyPair.publicKey))
        return yield* Effect.fail(
          new InvalidKeyError(
            "Delegate action public key must match the signer key. Use signWith() when you need a different key.",
          ),
        )
      return { keyPair, publicKey }
    })
  }

  private delegateNonceEffect(
    publicKey: PublicKey,
    explicit?: bigint,
    nonceIndex?: number,
  ) {
    return Effect.gen({ self: this }, function* () {
      if (nonceIndex !== undefined)
        yield* transactionSync(() =>
          TransactionBuilder.validateNonceIndex(nonceIndex),
        )
      if (explicit !== undefined) return explicit
      const key = publicKey.toString()
      return nonceIndex === undefined
        ? (yield* this.accessKeyNonceEffect(key)) + 1n
        : yield* this.nonces.reserve(
            this.signerId,
            `${key}#${nonceIndex}`,
            this.fetchGasKeyNonceEffect(key, nonceIndex),
          )
    })
  }

  private delegateExpiryEffect(options: DelegateSigningOptions) {
    return Effect.gen({ self: this }, function* () {
      if (options.maxBlockHeight !== undefined) return options.maxBlockHeight
      const status = yield* this.rpcPrograms.getStatus()
      return yield* transactionSync(
        () =>
          BigInt(status.sync_info.latest_block_height) +
          BigInt(options.blockHeightOffset ?? 200),
      )
    })
  }

  /**
   * Override the signing function for this specific transaction.
   *
   * Use this to sign with a different signer than the one configured in the
   * Near client, while keeping the same signerId. Useful for:
   *
   * - Using a hardware wallet for a specific transaction
   * - Testing with mock signers
   * - Signing with a specific private key for the same account
   * - One-off custom signing logic
   *
   * **Important:** This overrides HOW the transaction is signed, not WHO signs it.
   * The signerId (set via `.transaction()`) remains the same. To sign as a different
   * account, use `.transaction(otherAccountId)` instead.
   *
   * @param key - Either a custom signer function or a private key string
   *              (e.g., 'ed25519:...' or 'secp256k1:...')
   *              Type-safe: TypeScript will enforce the correct format at compile time
   * @returns This builder instance for chaining
   *
   * @example
   * ```typescript
   * // Override with different hardware wallet
   * await near.transaction('alice.near')
   *   .signWith(aliceHardwareWallet)
   *   .transfer('bob.near', '5 NEAR')
   *   .send()
   *
   * // Sign with specific ed25519 private key (type-safe)
   * await near.transaction('alice.near')
   *   .signWith('ed25519:...')  // ✅ TypeScript ensures correct format
   *   .transfer('bob.near', '1 NEAR')
   *   .send()
   *
   * // Sign with specific secp256k1 private key
   * await near.transaction('alice.near')
   *   .signWith('secp256k1:...')  // ✅ TypeScript ensures correct format
   *   .transfer('bob.near', '1 NEAR')
   *   .send()
   *
   * // TypeScript will catch mistakes at compile time:
   * await near.transaction('alice.near')
   *   .signWith('alice.near')  // ❌ Type error: not a PrivateKey
   *
   * // Mock signer for testing
   * const mockSigner: Signer = async (msg) => ({
   *   keyType: KeyType.ED25519,
   *   data: new Uint8Array(64)
   * })
   *
   * await near.transaction('test.near')
   *   .signWith(mockSigner)
   *   .transfer('receiver.near', '1')
   *   .send()
   * ```
   *
   * @remarks
   * Supports both ed25519 and secp256k1 keys.
   */
  signWith(key: PrivateKey | Signer): this {
    if (typeof key === "string") {
      // Parse key and create signer
      // TypeScript ensures key is PrivateKey format, but we still validate at runtime
      const keyPair = parseKey(key)
      this.keyPair = keyPair // Store for build() to use
      delete this.signer
    } else {
      // Clear cached keyPair when using custom signer to prevent stale public key
      delete this.keyPair
      this.signer = key
    }

    return this.invalidateCache()
  }

  /**
   * Sign this transaction with a gas key (protocol v85 / NEAR 2.13).
   *
   * Gas keys carry a prepaid gas balance and allocate several independent nonce
   * slots so they can sign transactions in parallel. This selects the nonce
   * slot (`nonceIndex`) to use and switches the builder to the versioned
   * transaction (V1) encoding required to carry a gas-key nonce.
   *
   * The nonce for the chosen slot is fetched and managed independently per
   * `(account, public key, nonce index)`, so concurrent transactions on
   * different indexes of the same gas key do not collide.
   *
   * @param nonceIndex - Which gas-key nonce slot to use. Slots are 0-based, so
   *   valid values are `0` to `numNonces - 1` (the slot count the key was added
   *   with). An out-of-range slot is rejected when the nonce is fetched.
   *
   * @example
   * ```typescript
   * await near.transaction("alice.near")
   *   .signWith(gasKeyPrivateKey)
   *   .useGasKey(0)
   *   .functionCall("contract.near", "method", {})
   *   .send()
   * ```
   *
   * @remarks Combine with {@link signWith} to use the gas key's private key.
   */
  useGasKey(nonceIndex: number): this {
    TransactionBuilder.validateNonceIndex(nonceIndex)
    this.gasKeyNonceIndex = nonceIndex
    return this.invalidateCache()
  }

  /**
   * Validate a gas-key nonce index: an integer in the u16 range (`0..=65535`).
   * The slot must also be within the key's allocated slots, which is checked
   * when the nonce is fetched.
   * @internal
   */
  private static validateNonceIndex(nonceIndex: number): void {
    if (!Number.isInteger(nonceIndex) || nonceIndex < 0 || nonceIndex > 65535) {
      throw new NearError(
        `Gas key nonceIndex must be an integer in 0..=65535, got ${nonceIndex}`,
        "INVALID_TRANSACTION",
      )
    }
  }

  /**
   * Opt into strict nonce mode (protocol v85 / NEAR 2.13).
   *
   * In strict mode the transaction nonce must be exactly `ak_nonce + 1`,
   * enforcing sequential ordering, instead of the default monotonic rule (any
   * nonce strictly greater than the access key nonce). This switches the builder
   * to the versioned transaction (V1) encoding.
   *
   * @param strict - Whether to enable strict mode (defaults to `true`).
   */
  strictNonceMode(strict = true): this {
    this.strictNonce = strict
    return this.invalidateCache()
  }

  /**
   * Sign this transaction at an explicit, caller-chosen nonce.
   *
   * By default the builder allocates nonces itself through a shared in-process
   * cache, which is right for most applications. Callers that coordinate nonces
   * externally — a Redis- or database-backed allocator shared by several
   * processes, a relayer that must record the nonce before an asynchronous
   * (e.g. MPC) signature is produced, or a replay of a previously planned
   * transaction — can pin the nonce instead. The value is used exactly as
   * given, for both ordinary keys and gas keys (combined with
   * {@link useGasKey}, it becomes the nonce of that slot), and the shared cache
   * is neither consulted nor updated.
   *
   * Because the caller owns the nonce, {@link send} does not rebuild the
   * transaction with a fresh nonce on `InvalidNonceError`; the error is thrown
   * so the caller's allocator can decide what to do.
   *
   * Not supported with a wallet (the wallet chooses the nonce): {@link send}
   * throws before prompting. With {@link useGasKey}, the slot is still checked
   * to exist before signing.
   *
   * Applies only to the outer transaction. {@link delegate} and
   * {@link delegateV2} reject this setting; use their `{ nonce }` options for
   * local delegate signing instead. A relayer can still use this method with
   * {@link signedDelegateAction} or {@link signedDelegateActionV2} to set its
   * own transaction nonce independently of the signed delegate's nonce.
   *
   * @param nonce - The transaction nonce: a positive integer that fits in a u64.
   *
   * @example
   * ```typescript
   * const nonce = await myAllocator.next("relayer.near", publicKey)
   * await near.transaction("relayer.near")
   *   .nonce(nonce)
   *   .transfer("bob.near", "1 NEAR")
   *   .send()
   * ```
   */
  nonce(nonce: bigint | number): this {
    const value =
      typeof nonce === "bigint"
        ? nonce
        : TransactionBuilder.toNonceBigInt(nonce)
    if (value <= 0n || value > 0xffff_ffff_ffff_ffffn) {
      throw new NearError(
        `Transaction nonce must be a positive integer that fits in a u64, got ${nonce}`,
        "INVALID_TRANSACTION",
      )
    }
    this.explicitNonce = value
    return this.invalidateCache()
  }

  /** @internal */
  private static toNonceBigInt(nonce: number): bigint {
    if (!Number.isSafeInteger(nonce)) {
      throw new NearError(
        `Transaction nonce must be a safe integer or a bigint, got ${nonce}`,
        "INVALID_TRANSACTION",
      )
    }
    return BigInt(nonce)
  }

  /**
   * Whether this transaction must be encoded as a versioned (V1) transaction.
   * V1 is required to carry a gas-key nonce or to request strict nonce mode;
   * an ordinary transaction stays V0 (tag-less) for backward compatibility.
   * @internal
   */
  private requiresV1(): boolean {
    return this.gasKeyNonceIndex !== undefined || this.strictNonce
  }

  /**
   * Build the unsigned transaction
   */
  build(): Promise<Transaction> {
    return runPromise(this.buildEffect())
  }

  buildEffect(): Effect.Effect<Transaction, TransactionError> {
    return this.prepareTransactionEffect(false).pipe(
      Effect.map(({ transaction }) => transaction),
    )
  }

  private prepareTransactionEffect(versioned: boolean) {
    return Effect.gen({ self: this }, function* () {
      if (!this.receiverId)
        return yield* Effect.fail(
          new NearError(
            "No receiver ID set for transaction",
            "INVALID_TRANSACTION",
          ),
        )
      const keyPair = yield* this.resolveKeyPairEffect()
      const publicKey = keyPair.publicKey
      const nonceIndex = versioned ? this.gasKeyNonceIndex : undefined
      const nonce = yield* this.transactionNonceEffect(
        publicKey,
        nonceIndex,
        versioned && this.strictNonce,
      )
      // Finalized hashes remain stable across load-balanced RPC nodes.
      const block = yield* this.rpcPrograms.getBlock({ finality: "final" })
      const blockHash = yield* transactionSync(() =>
        base58.decode(block.header.hash),
      )
      const transaction: Transaction = {
        signerId: this.signerId,
        publicKey,
        nonce,
        receiverId: this.receiverId,
        actions: this.actions,
        blockHash,
      }
      const v1: TransactionV1 | undefined = versioned
        ? {
            ...transaction,
            nonce: transactionNonce(nonce, nonceIndex),
            nonceMode: this.strictNonce ? { strict: {} } : { monotonic: {} },
          }
        : undefined
      return { transaction, keyPair, v1 }
    }).pipe(Effect.withSpan("TransactionBuilder.build"))
  }

  /**
   * Sign the transaction without sending it.
   *
   * This creates a signed transaction that can be:
   * - Inspected via `getHash()`
   * - Serialized via `serialize()`
   * - Sent later via `send()`
   *
   * The signed transaction is cached internally. If you modify the transaction
   * (add actions, change signer, etc.), the cache is automatically invalidated.
   *
   * @returns This builder instance (now in a signed state)
   *
   * @example
   * ```typescript
   * // Sign and inspect hash
   * const tx = await near.transaction('alice.near')
   *   .transfer('bob.near', '1 NEAR')
   *   .sign()
   *
   * console.log('Transaction hash:', tx.getHash())
   *
   * // Serialize for offline use
   * const bytes = tx.serialize()
   *
   * // Send when ready
   * const result = await tx.send({ waitUntil: 'FINAL' })
   * ```
   */
  sign(): Promise<this> {
    return runPromise(this.signEffect())
  }

  signEffect(): Effect.Effect<this, TransactionError> {
    return Effect.gen({ self: this }, function* () {
      if (this.cachedSignedTx) return this
      const { transaction, keyPair, v1 } = yield* this.prepareTransactionEffect(
        this.requiresV1(),
      )
      const serialized = yield* transactionSync(() =>
        v1 ? serializeTransactionV1(v1) : serializeTransaction(transaction),
      )
      const messageHash = sha256(serialized)
      const signer = this.signer
      const signature = signer
        ? yield* fromPromise(
            () => signer.call(this, messageHash),
            "TransactionBuilder.signer",
          )
        : yield* transactionSync(() => keyPair.sign(messageHash))
      this.cachedSignedTx = {
        signedTx: { transaction, signature },
        hash: base58.encode(messageHash),
        ...(v1
          ? {
              serialized: yield* transactionSync(() =>
                serializeSignedTransactionV1(v1, signature),
              ),
            }
          : {}),
      }
      return this
    }).pipe(Effect.withSpan("TransactionBuilder.sign"))
  }

  private accessKeyNonceEffect(publicKey: string) {
    return this.rpcPrograms
      .getAccessKey(this.signerId, publicKey)
      .pipe(Effect.flatMap((key) => transactionSync(() => BigInt(key.nonce))))
  }

  private transactionNonceEffect(
    publicKey: PublicKey,
    nonceIndex: number | undefined,
    strict: boolean,
  ) {
    return Effect.gen({ self: this }, function* () {
      const key = publicKey.toString()
      if (this.explicitNonce !== undefined) {
        // Validate existence only: a caller-owned nonce never reads chain values
        // or changes shared reservation state, even for a gas-key slot.
        if (nonceIndex !== undefined)
          yield* this.fetchGasKeySlotsEffect(key, nonceIndex)
        return this.explicitNonce
      }
      const lookup =
        nonceIndex === undefined
          ? this.accessKeyNonceEffect(key)
          : this.fetchGasKeyNonceEffect(key, nonceIndex)
      // Strict mode must use ak_nonce + 1, never an ahead-of-chain reservation.
      return strict
        ? (yield* lookup) + 1n
        : yield* this.nonces.reserve(
            this.signerId,
            nonceIndex === undefined ? key : `${key}#${nonceIndex}`,
            lookup,
          )
    })
  }

  /**
   * Fetch a gas key's per-slot nonces via `EXPERIMENTAL_view_gas_key_nonces`
   * and confirm `nonceIndex` is one of its slots. Only the slot count is
   * checked here; the slot values are left as returned by the RPC.
   * @internal
   */
  private fetchGasKeySlotsEffect(
    publicKey: string,
    nonceIndex: number,
  ): Effect.Effect<unknown[], TransactionError> {
    return Effect.gen({ self: this }, function* () {
      const result = yield* this.rpcPrograms.call<{
        nonces?: unknown
      }>("EXPERIMENTAL_view_gas_key_nonces", {
        finality: "optimistic",
        account_id: this.signerId,
        public_key: publicKey,
      })
      const nonces = result?.nonces
      if (
        !Array.isArray(nonces) ||
        !Number.isInteger(nonceIndex) ||
        nonceIndex < 0 ||
        nonceIndex >= nonces.length
      ) {
        return yield* Effect.fail(
          new NearError(
            `Gas key ${publicKey} on ${this.signerId} has no nonce slot ${nonceIndex}`,
            "INVALID_TRANSACTION",
          ),
        )
      }
      return nonces
    }).pipe(Effect.withSpan("TransactionBuilder.fetchGasKeySlots"))
  }

  /**
   * Fetch the current on-chain nonce for a gas key's nonce slot via
   * `EXPERIMENTAL_view_gas_key_nonces`, which returns one nonce per slot.
   * @internal
   */
  private fetchGasKeyNonceEffect(
    publicKey: string,
    nonceIndex: number,
  ): Effect.Effect<bigint, TransactionError> {
    return Effect.gen({ self: this }, function* () {
      const nonces = yield* this.fetchGasKeySlotsEffect(publicKey, nonceIndex)
      const raw = nonces[nonceIndex]
      // The RPC returns nonces as JSON numbers; guard against precision loss
      // before widening to bigint, and accept a string form defensively.
      if (typeof raw === "number") {
        if (!Number.isSafeInteger(raw)) {
          return yield* Effect.fail(
            new NearError(
              `Gas key nonce slot ${nonceIndex} is not a safe integer: ${raw}`,
              "INVALID_TRANSACTION",
            ),
          )
        }
        return yield* transactionSync(() => BigInt(raw))
      }
      if (typeof raw === "string") {
        return yield* transactionSync(() => BigInt(raw))
      }
      return yield* Effect.fail(
        new NearError(
          `Gas key nonce slot ${nonceIndex} has an unexpected type: ${typeof raw}`,
          "INVALID_TRANSACTION",
        ),
      )
    }).pipe(Effect.withSpan("TransactionBuilder.fetchGasKeyNonce"))
  }

  /**
   * Get the transaction hash (only available after signing).
   *
   * @returns The base58-encoded transaction hash, or null if not yet signed
   *
   * @example
   * ```typescript
   * const tx = await near.transaction('alice.near')
   *   .transfer('bob.near', '1 NEAR')
   *   .sign()
   *
   * console.log(tx.getHash()) // "8ZQ7..."
   * ```
   */
  getHash(): string | null {
    return this.cachedSignedTx?.hash ?? null
  }

  /**
   * Serialize the signed transaction to bytes.
   *
   * This is useful for:
   * - Storing signed transactions for later broadcast
   * - Sending transactions through external tools
   * - Multi-sig workflows
   *
   * @returns Borsh-serialized signed transaction bytes
   * @throws {NearError} If transaction has not been signed yet
   *
   * @example
   * ```typescript
   * const tx = await near.transaction('alice.near')
   *   .transfer('bob.near', '1 NEAR')
   *   .sign()
   *
   * const bytes = tx.serialize()
   * fs.writeFileSync('transaction.bin', bytes)
   * ```
   */
  serialize(): Uint8Array {
    if (!this.cachedSignedTx) {
      throw new NearError(
        "Transaction must be signed before serializing. Call .sign() first.",
        "INVALID_STATE",
      )
    }
    // V1 (gas-key / strict-nonce) transactions carry pre-serialized wire bytes.
    return (
      this.cachedSignedTx.serialized ??
      serializeSignedTransaction(this.cachedSignedTx.signedTx)
    )
  }

  /**
   * Sign and send the transaction
   *
   * If the transaction has already been signed (via `.sign()`), it will use the
   * cached signed transaction. Otherwise, it will sign the transaction automatically.
   *
   * The response will always include `transaction.hash` for tracking, even when
   * using `waitUntil: "NONE"` which normally doesn't return transaction details.
   *
   * @param options - Optional configuration for sending the transaction
   * @param options.waitUntil - Controls when the RPC returns after submitting the transaction
   * @returns Promise resolving to the final execution outcome
   *
   * @example
   * ```typescript
   * // Use default wait until
   * await near.transaction(account).transfer(receiver, "1 NEAR").send()
   *
   * // Wait for full finality
   * await near.transaction(account)
   *   .transfer(receiver, "1 NEAR")
   *   .send({ waitUntil: "FINAL" })
   *
   * // Fire and forget with NONE - hash still available
   * const result = await near.transaction(account)
   *   .transfer(receiver, "1 NEAR")
   *   .send({ waitUntil: "NONE" })
   * console.log(result.transaction.hash) // Always available!
   * ```
   */
  send(): Promise<FinalExecutionOutcomeMap["EXECUTED_OPTIMISTIC"]>
  send<W extends keyof FinalExecutionOutcomeMap>(
    options: SendOptions<W>,
  ): Promise<FinalExecutionOutcomeMap[W]>
  send<W extends keyof FinalExecutionOutcomeMap = "EXECUTED_OPTIMISTIC">(
    options?: SendOptions<W>,
  ): Promise<FinalExecutionOutcomeMap[W]> {
    return runPromise(this.sendEffect(options))
  }

  sendEffect<W extends keyof FinalExecutionOutcomeMap = "EXECUTED_OPTIMISTIC">(
    options?: SendOptions<W>,
  ): Effect.Effect<FinalExecutionOutcomeMap[W], TransactionError> {
    return Effect.gen({ self: this }, function* () {
      if (!this.receiverId) {
        return yield* Effect.fail(
          new NearError(
            "No receiver ID set for transaction",
            "INVALID_TRANSACTION",
          ),
        )
      }
      const waitUntil = (options?.waitUntil ?? this.defaultWaitUntil) as W
      const wallet = this.wallet
      const receiverId = this.receiverId
      if (wallet) {
        // A wallet chooses its own nonce: its submission interface carries only
        // the signer, receiver and actions. Refuse before prompting rather than
        // letting the transaction execute at a nonce the caller didn't allocate.
        if (this.explicitNonce !== undefined) {
          return yield* Effect.fail(
            new NearError(
              "An explicit nonce cannot be used with a wallet: the wallet chooses the transaction nonce",
              "INVALID_TRANSACTION",
            ),
          )
        }
        const result = yield* wallet.signAndSendTransaction({
          signerId: this.signerId,
          receiverId,
          actions: this.actions,
        })
        // Inclusion finality and optimistic execution are independent milestones.
        const reached: Record<TxExecutionStatus, readonly TxExecutionStatus[]> =
          {
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
        const failed =
          typeof result.status === "object" && "Failure" in result.status
        if (
          !failed &&
          reached[result.final_execution_status]?.includes(waitUntil)
        ) {
          return result as FinalExecutionOutcomeMap[W]
        }
        if (!result.transaction?.hash) {
          return yield* Effect.fail(
            new NearError(
              "Wallet did not return a transaction hash for status lookup",
              "INVALID_TRANSACTION",
            ),
          )
        }
        const transaction = result.transaction
        // Reconcile the submitted hash; never prompt for another signature on error.
        // RPC status parsing also provides the usual typed execution errors.
        return (yield* this.rpcPrograms.getTransactionStatus(
          transaction.hash,
          transaction.signer_id,
          waitUntil,
        )) as FinalExecutionOutcomeMap[W]
      }

      let attempt = 0
      const submit = Effect.gen({ self: this }, function* () {
        if (!this.cachedSignedTx || attempt > 0) {
          delete this.cachedSignedTx
          yield* this.signEffect()
        }
        attempt++
        if (!this.cachedSignedTx) {
          return yield* Effect.fail(
            new NearError(
              "Failed to sign transaction",
              "TRANSACTION_SIGNING_FAILED",
            ),
          )
        }
        const { signedTx, hash, serialized } = this.cachedSignedTx
        const signedSerialized =
          serialized ??
          (yield* transactionSync(() => serializeSignedTransaction(signedTx)))
        const result = yield* this.rpcPrograms.sendTransaction(
          signedSerialized,
          waitUntil,
        )
        if (!("transaction" in result) || !result.transaction) {
          ;(result as Record<string, unknown>)["transaction"] = {
            hash,
            signer_id: signedTx.transaction.signerId,
            receiver_id: this.receiverId,
            nonce: Number(signedTx.transaction.nonce),
          }
        }
        return result
      }).pipe(
        Effect.tapError((failure) =>
          Effect.gen({ self: this }, function* () {
            const error =
              failure instanceof ExternalError ? failure.cause : failure
            if (
              error instanceof InvalidNonceError &&
              this.explicitNonce === undefined &&
              this.cachedSignedTx &&
              !this.strictNonce
            ) {
              const pk =
                this.cachedSignedTx.signedTx.transaction.publicKey.toString()
              const cacheKey =
                this.gasKeyNonceIndex !== undefined
                  ? `${pk}#${this.gasKeyNonceIndex}`
                  : pk
              yield* this.nonces.updateAndGetNext(
                this.signerId,
                cacheKey,
                yield* transactionSync(() => BigInt(error.akNonce)),
              )
            }
          }),
        ),
      )
      // InvalidNonce proves the transaction was rejected before execution.
      // No transport, wallet or arbitrary signer failure is safe to replay.
      return yield* submit.pipe(
        Effect.retry({
          schedule: Schedule.recurs(2),
          while: (failure) => {
            const error =
              failure instanceof ExternalError ? failure.cause : failure
            return (
              error instanceof InvalidNonceError &&
              this.explicitNonce === undefined
            )
          },
        }),
      )
    }).pipe(Effect.withSpan("TransactionBuilder.send"))
  }
}

/** Classify failures from synchronous protocol/key extension boundaries. */
function transactionSync<A>(
  operation: () => A,
): Effect.Effect<A, NearError | ExternalError> {
  return Effect.try({
    try: operation,
    catch: (cause) =>
      cause instanceof NearError
        ? cause
        : new ExternalError({
            operation: "TransactionBuilder.encoding",
            cause,
          }),
  })
}

function transactionNonce(
  nonce: bigint,
  nonceIndex?: number,
): TransactionNonceBorsh {
  return nonceIndex === undefined
    ? { nonce: { nonce } }
    : { gasKeyNonce: { nonce, nonceIndex } }
}
