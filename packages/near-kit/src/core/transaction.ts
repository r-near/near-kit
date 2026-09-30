import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Program from "../effect/transaction.js"
import type {
  DelegateActionResult,
  DelegateV2ActionResult,
  DelegateOptions,
  DelegateV2Options,
  TransactionDependencies,
  TransactionPlan,
  SignedTransactionValue,
} from "../effect/transaction.js"
export type {
  DelegateActionResult,
  DelegateV2ActionResult,
  TransactionDependencies,
  TransactionError,
} from "../effect/transaction.js"
import { walletService } from "../effect/wallet.js"
import { keyStoreService } from "../effect/keys.js"
import { getSharedNonceReservation } from "../effect/nonce.js"
import { fromPromise, runPromise, runSync } from "../effect/runtime.js"
import { InvalidKeyError, NearError } from "../errors/index.js"
import { parseKey, parsePublicKey } from "../utils/key.js"
import { deriveAccountId } from "../utils/state-init.js"
import {
  type Amount,
  type Gas,
  normalizeAmount,
  type PrivateKey,
} from "../utils/validation.js"
import * as actions from "./actions.js"
import { transactionRpcFromPromises, type RpcClient } from "./rpc/rpc.js"
import type {
  AccessKeyPermissionBorsh,
  DelegateActionPayloadFormat,
  DelegateV2Action,
  SignedDelegateAction,
} from "./schema.js"
import type {
  Action,
  FinalExecutionOutcomeMap,
  GlobalContractReference,
  KeyPair,
  KeyStore,
  SendOptions,
  Signer,
  Transaction,
  TxExecutionStatus,
  WalletConnection,
} from "./types.js"

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

type LegacyTransactionArguments = [
  rpc: RpcClient,
  keyStore: KeyStore,
  signer?: Signer,
  defaultWaitUntil?: TxExecutionStatus,
  wallet?: WalletConnection,
  ensureKeyStoreReady?: () => Promise<void>,
]

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

interface SigningAcquisition {
  readonly plan: TransactionPlan
  readonly key: Effect.Effect<KeyPair, Program.TransactionError>
  readonly effect: Effect.Effect<
    SignedTransactionValue,
    Program.TransactionError
  >
}

/**
 * Fluent builder for constructing and sending NEAR transactions.
 *
 * Created via {@link Near.transaction}. Supports chaining multiple actions
 * (transfers, function calls, key management, staking, delegate actions) into
 * a single atomic transaction.
 */

export class TransactionBuilder {
  private plan: TransactionPlan
  private readonly dependencies: TransactionDependencies
  private selectedKey?: KeyPair
  private keyIdentity = {}
  private signed?: SignedTransactionValue
  private signing?: SigningAcquisition

  constructor(signerId: string, dependencies: TransactionDependencies)
  constructor(signerId: string, ...legacy: LegacyTransactionArguments)
  constructor(
    signerId: string,
    ...args: [TransactionDependencies] | LegacyTransactionArguments
  ) {
    let dependencies: TransactionDependencies
    if (args.length === 1) dependencies = args[0]
    else {
      const [
        rpc,
        keyStore,
        signer,
        defaultWaitUntil = "EXECUTED_OPTIMISTIC",
        wallet,
        ensureKeyStoreReady,
      ] = args
      if (!keyStore) throw new InvalidKeyError("A key store is required")
      dependencies = {
        rpc: transactionRpcFromPromises(rpc),
        keyStore: keyStoreService(keyStore),
        nonces: runSync(getSharedNonceReservation),
        defaultWaitUntil,
        ...(signer
          ? {
              signer: (digest) =>
                fromPromise(
                  () => signer.call(this, digest),
                  "TransactionBuilder.signer",
                ),
            }
          : {}),
        ...(wallet ? { wallet: walletService(wallet) } : {}),
        ready: ensureKeyStoreReady
          ? fromPromise(
              () => ensureKeyStoreReady.call(this),
              "TransactionBuilder.ensureKeyStoreReady",
            )
          : Effect.void,
      }
    }
    this.dependencies = dependencies
    this.plan = { signerId, actions: [] }
  }

  /**
   * Invalidate cached signed transaction when builder state changes
   */
  private edit(update: Partial<TransactionPlan>): this {
    this.plan = { ...this.plan, ...update }
    delete this.signed
    delete this.signing
    return this
  }

  private append(
    action: Action,
    receiverId: string | undefined = this.plan.receiverId,
  ): this {
    return this.edit({
      actions: [...this.plan.actions, structuredClone(action)],
      ...(receiverId ? { receiverId } : {}),
    })
  }

  /** Capture one plan and signing authority. Completion may populate only that plan's cache. */
  private execution() {
    const plan = this.plan
    const identity = this.keyIdentity
    let selected = this.selectedKey
    const key = Effect.suspend(() =>
      selected
        ? Effect.succeed(selected)
        : Program.resolveKey(plan, this.dependencies).pipe(
            Effect.tap((resolved) =>
              Effect.sync(() => {
                selected = resolved
                if (this.keyIdentity === identity) this.selectedKey = resolved
              }),
            ),
          ),
    )
    return { plan, key }
  }

  private signingFor(
    plan: TransactionPlan,
    key: ReturnType<typeof Program.resolveKey>,
  ) {
    if (this.signed && this.plan === plan)
      return { plan, key, effect: Effect.succeed(this.signed) }
    if (this.signing?.plan === plan) return this.signing
    // Allocate the native memo atomically at this synchronous public boundary.
    // Concurrent terminals share acquisition; edits and failures release only their own entry.
    const ownedKey = runSync(
      Effect.cached(
        key.pipe(
          Effect.onExit((exit) =>
            Effect.sync(() => {
              if (Exit.isFailure(exit) && this.signing === entry)
                delete this.signing
            }),
          ),
        ),
      ),
    )
    const entry: SigningAcquisition = {
      plan,
      key: ownedKey,
      effect: runSync(
        Effect.cached(
          Program.sign(plan, this.dependencies, ownedKey).pipe(
            Effect.onExit((exit) =>
              Effect.sync(() => {
                if (this.signing !== entry) return
                delete this.signing
                if (Exit.isSuccess(exit) && this.plan === plan)
                  this.signed = exit.value
              }),
            ),
          ),
        ),
      ),
    }
    this.signing = entry
    return entry
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
    return this.append(
      actions.transfer(BigInt(normalizeAmount(amount))),
      this.plan.receiverId ?? receiverId,
    )
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
    return this.append(
      Program.functionCallAction(methodName, args, options),
      this.plan.receiverId ?? contractId,
    )
  }

  /**
   * Add a create account action
   */
  createAccount(accountId: string): this {
    return this.append(
      actions.createAccount(),
      this.plan.receiverId ?? accountId,
    )
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
    return this.append(
      actions.deleteAccount(options.beneficiary),
      this.plan.receiverId ?? this.plan.signerId,
    )
  }

  /**
   * Add a deploy contract action
   */
  deployContract(accountId: string, code: Uint8Array): this {
    return this.append(
      actions.deployContract(code),
      this.plan.receiverId ?? accountId,
    )
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
    return this.append(
      actions.publishContract(code, options),
      this.plan.receiverId ?? this.plan.signerId,
    )
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
    return this.append(
      actions.deployFromPublished(reference),
      this.plan.receiverId ?? this.plan.signerId,
    )
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
    return this.append(
      actions.stateInit({
        ...options,
        deposit: BigInt(normalizeAmount(options.deposit)),
      }),
      this.plan.receiverId ?? deriveAccountId(options),
    )
  }

  /**
   * Add a stake action
   */
  stake(publicKey: string, amount: Amount): this {
    return this.append(
      actions.stake(BigInt(normalizeAmount(amount)), parsePublicKey(publicKey)),
      this.plan.receiverId ?? this.plan.signerId,
    )
  }

  /**
   * Add an add key action
   *
   * The key is added to the receiverId of the transaction.
   * If receiverId is not set, it defaults to signerId.
   */
  addKey(publicKey: string, permission: AccessKeyPermission): this {
    return this.append(
      actions.addKey(
        parsePublicKey(publicKey),
        toAccessKeyPermissionBorsh(permission),
      ),
      this.plan.receiverId ?? this.plan.signerId,
    )
  }

  /**
   * Add a delete key action
   */
  deleteKey(accountId: string, publicKey: string): this {
    return this.append(
      actions.deleteKey(parsePublicKey(publicKey)),
      this.plan.receiverId ?? accountId,
    )
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
    return this.append(
      actions.transferToGasKey(
        parsePublicKey(publicKey),
        BigInt(normalizeAmount(amount)),
      ),
      this.plan.receiverId ?? this.plan.signerId,
    )
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
    return this.append(
      actions.withdrawFromGasKey(
        parsePublicKey(publicKey),
        BigInt(normalizeAmount(amount)),
      ),
      this.plan.receiverId ?? this.plan.signerId,
    )
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
    return this.append(
      signedDelegate,
      signedDelegate.signedDelegate.delegateAction.senderId,
    )
  }

  /**
   * Add a V2 signed delegate action to this transaction, for relayers
   * (gas-key meta-transactions, NEAR 2.13).
   *
   * The receiver is set to the V2 delegate action's sender (the account whose
   * actions are being relayed).
   */
  signedDelegateActionV2(signedDelegate: DelegateV2Action): this {
    return this.append(
      signedDelegate,
      signedDelegate.delegateV2.delegateAction.v2.senderId,
    )
  }

  /**
   * Build and sign a delegate action from the queued actions.
   *
   * @returns Structured delegate action plus an encoded payload (`base64` by default)
   */
  delegate<F extends DelegateActionPayloadFormat = "base64">(
    options?: DelegateOptions<F>,
  ): Promise<DelegateActionResult<F>> {
    return runPromise(
      Effect.suspend(() => {
        const { plan, key } = this.execution()
        return Program.delegate(plan, this.dependencies, options, key)
      }),
    )
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
    return runPromise(
      Effect.suspend(() => {
        const { plan, key } = this.execution()
        return Program.delegateV2(plan, this.dependencies, options, key)
      }),
    )
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
    const { keyPair: _key, signer: _signer, ...plan } = this.plan
    this.plan =
      typeof key === "string"
        ? { ...plan, keyPair: parseKey(key) }
        : {
            ...plan,
            signer: (digest) =>
              fromPromise(
                () => key.call(this, digest),
                "TransactionBuilder.signer",
              ),
          }
    this.keyIdentity = {}
    delete this.selectedKey
    delete this.signed
    delete this.signing
    return this
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
    Program.validateNonceIndex(nonceIndex)
    return this.edit({ nonceIndex })
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
    return this.edit({ strictNonce: strict })
  }

  /**
   * Sign this transaction at an explicit, caller-chosen nonce.
   *
   * By default the builder allocates nonces itself through a shared in-process
   * reservation service, which is right for most applications. Callers that coordinate nonces
   * externally — a Redis- or database-backed allocator shared by several
   * processes, a relayer that must record the nonce before an asynchronous
   * (e.g. MPC) signature is produced, or a replay of a previously planned
   * transaction — can pin the nonce instead. The value is used exactly as
   * given, for both ordinary keys and gas keys (combined with
   * {@link useGasKey}, it becomes the nonce of that slot), and the shared reservation service
   * is neither consulted nor updated.
   *
   * The nonce stays fixed across sends. Submission failures reconcile the signed
   * hash; they never authorize an automatic fresh-nonce signature. Unknown status
   * raises TRANSACTION_OUTCOME_UNKNOWN so the caller can inspect the original hash.
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
    return this.edit({ nonce: Program.validateNonce(nonce) })
  }

  /**
   * Build the unsigned transaction
   */
  build(): Promise<Transaction> {
    return runPromise(
      Effect.suspend(() => {
        const { plan, key } = this.execution()
        return Program.legacyBuild(plan, this.dependencies, key)
      }),
    )
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
    return runPromise(
      Effect.suspend(() => {
        if (this.signed) return Effect.succeed(this)
        const { plan, key } = this.execution()
        return this.signingFor(plan, key).effect.pipe(Effect.as(this))
      }),
    )
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
    return this.signed?.hash ?? null
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
    if (!this.signed)
      throw new NearError(
        "Transaction must be signed before serializing. Call .sign() first.",
        "INVALID_STATE",
      )
    return this.signed.serialize()
  }

  /**
   * Sign and send the transaction
   *
   * If the transaction has already been signed (via `.sign()`), it will use the
   * cached signed transaction. Otherwise, it will sign the transaction automatically.
   *
   * Ambiguous submissions are reconciled by their exact hash. If status is unknown,
   * throws TRANSACTION_OUTCOME_UNKNOWN with the hash and original cause; it never
   * automatically signs a fresh nonce, even after a matching nonce rejection.
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
    return runPromise(
      Effect.suspend(() => {
        const { plan, key } = this.execution()
        const acquisition = this.dependencies.wallet
          ? { key, effect: Program.sign(plan, this.dependencies, key) }
          : this.signingFor(plan, key)
        return Program.submit(
          plan,
          this.dependencies,
          acquisition.effect,
          this.signed,
          options,
          acquisition.key,
        )
      }),
    )
  }
}
