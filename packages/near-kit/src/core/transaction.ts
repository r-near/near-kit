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
import { NonceManager } from "./nonce-manager.js"
import type { RpcClient } from "./rpc/rpc.js"
import {
  type AccessKeyPermissionBorsh,
  type ClassicAction,
  type DelegateActionPayloadFormat,
  type DelegateV2Action,
  encodeSignedDelegateAction,
  encodeSignedDelegateActionV2,
  type NonDelegateActionBorsh,
  type SignedDelegateAction,
  serializeDelegateAction,
  serializeDelegateActionV2,
  serializeSignedTransaction,
  serializeSignedTransactionV1,
  serializeTransaction,
  serializeTransactionV1,
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
  // Shared nonce manager across all TransactionBuilder instances
  private static nonceManager = new NonceManager()

  private signerId: string
  private actions: Action[]
  private receiverId?: string
  private rpc: RpcClient
  private keyStore: KeyStore
  private signer?: Signer
  private keyPair?: KeyPair // KeyPair from signWith() for building transaction
  private wallet?: WalletConnection
  private defaultWaitUntil: TxExecutionStatus
  private ensureKeyStoreReady?: () => Promise<void>
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

  constructor(
    signerId: string,
    rpc: RpcClient,
    keyStore: KeyStore,
    signer?: Signer,
    defaultWaitUntil: TxExecutionStatus = "EXECUTED_OPTIMISTIC",
    wallet?: WalletConnection,
    ensureKeyStoreReady?: () => Promise<void>,
  ) {
    this.signerId = signerId
    this.actions = []
    this.rpc = rpc
    this.keyStore = keyStore
    if (ensureKeyStoreReady !== undefined) {
      this.ensureKeyStoreReady = ensureKeyStoreReady
    }
    if (signer !== undefined) {
      this.signer = signer
    }
    this.defaultWaitUntil = defaultWaitUntil
    if (wallet !== undefined) {
      this.wallet = wallet
    }
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
  private async resolveKeyPair(): Promise<KeyPair> {
    if (this.keyPair) {
      return this.keyPair
    }

    if (this.ensureKeyStoreReady) {
      await this.ensureKeyStoreReady()
    }

    const keyPair = await this.keyStore.get(this.signerId)
    if (!keyPair) {
      throw new InvalidKeyError(`No key found for account: ${this.signerId}`)
    }

    // Cache the resolved key pair to ensure keyStore.get() is only called once
    // per TransactionBuilder instance. This is critical for RotatingKeyStore
    // which returns a different key on each get() call.
    this.keyPair = keyPair

    return keyPair
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
  async delegate<F extends DelegateActionPayloadFormat = "base64">(
    options?: DelegateOptions<F>,
  ): Promise<DelegateActionResult<F>> {
    const opts = options ?? ({} as DelegateOptions<F>)
    if (this.actions.length === 0) {
      throw new NearError(
        "Delegate action requires at least one action to perform",
        "INVALID_TRANSACTION",
      )
    }

    if (this.actions.some((action) => "signedDelegate" in action)) {
      throw new NearError(
        "Delegate actions cannot contain nested signed delegate actions",
        "INVALID_TRANSACTION",
      )
    }

    const receiverId = opts.receiverId ?? this.receiverId
    if (!receiverId) {
      throw new NearError(
        "Delegate action requires a receiver. Set receiverId via the first action or provide it explicitly.",
        "INVALID_TRANSACTION",
      )
    }

    // Use wallet if available and it supports signDelegateActions
    if (this.wallet?.signDelegateActions) {
      const result = await this.wallet.signDelegateActions({
        signerId: this.signerId,
        delegateActions: [
          {
            actions: this.actions,
            receiverId,
          },
        ],
      })

      const first = result.signedDelegateActions[0]
      if (!first) {
        throw new NearError(
          "Wallet did not return a signed delegate action",
          "WALLET_ERROR",
        )
      }

      const signedDelegateAction = first.signedDelegate
      const format = (opts.payloadFormat ?? "base64") as F
      const payload = encodeSignedDelegateAction(signedDelegateAction, format)

      return {
        signedDelegateAction,
        payload,
        format,
      }
    }

    const keyPair = await this.resolveKeyPair()
    let delegatePublicKey: PublicKey
    if (opts.publicKey === undefined) {
      delegatePublicKey = keyPair.publicKey
    } else if (typeof opts.publicKey === "string") {
      delegatePublicKey = parsePublicKey(opts.publicKey)
    } else {
      delegatePublicKey = opts.publicKey
    }

    if (!publicKeysEqual(delegatePublicKey, keyPair.publicKey)) {
      throw new InvalidKeyError(
        "Delegate action public key must match the signer key. Use signWith() when you need a different key.",
      )
    }

    let nonce: bigint
    if (opts.nonce !== undefined) {
      nonce = opts.nonce
    } else {
      const accessKey = await this.rpc.getAccessKey(
        this.signerId,
        delegatePublicKey.toString(),
      )
      nonce = BigInt(accessKey.nonce) + 1n
    }

    let maxBlockHeight: bigint
    if (opts.maxBlockHeight !== undefined) {
      maxBlockHeight = opts.maxBlockHeight
    } else {
      const status = await this.rpc.getStatus()
      const offset = BigInt(opts.blockHeightOffset ?? 200)
      maxBlockHeight = BigInt(status.sync_info.latest_block_height) + offset
    }

    const delegateActions = this.actions.map(
      (action) => action as ClassicAction,
    )

    const delegateAction = new actions.DelegateAction(
      this.signerId,
      receiverId,
      delegateActions,
      nonce,
      maxBlockHeight,
      delegatePublicKey,
    )

    const hash = sha256(serializeDelegateAction(delegateAction))
    const signature = keyPair.sign(hash)
    const signedDelegateAction = actions.signedDelegate(
      delegateAction,
      signature,
    )
    const format = (opts.payloadFormat ?? "base64") as F
    const payload = encodeSignedDelegateAction(signedDelegateAction, format)

    return {
      signedDelegateAction,
      payload,
      format,
    }
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
  async delegateV2<F extends DelegateActionPayloadFormat = "base64">(
    options?: DelegateV2Options<F>,
  ): Promise<DelegateV2ActionResult<F>> {
    const opts = options ?? ({} as DelegateV2Options<F>)
    if (this.actions.length === 0) {
      throw new NearError(
        "Delegate action requires at least one action to perform",
        "INVALID_TRANSACTION",
      )
    }

    if (
      this.actions.some(
        (action) => "signedDelegate" in action || "delegateV2" in action,
      )
    ) {
      throw new NearError(
        "Delegate actions cannot contain nested delegate actions",
        "INVALID_TRANSACTION",
      )
    }

    const receiverId = opts.receiverId ?? this.receiverId
    if (!receiverId) {
      throw new NearError(
        "Delegate action requires a receiver. Set receiverId via the first action or provide it explicitly.",
        "INVALID_TRANSACTION",
      )
    }

    const keyPair = await this.resolveKeyPair()
    let delegatePublicKey: PublicKey
    if (opts.publicKey === undefined) {
      delegatePublicKey = keyPair.publicKey
    } else if (typeof opts.publicKey === "string") {
      delegatePublicKey = parsePublicKey(opts.publicKey)
    } else {
      delegatePublicKey = opts.publicKey
    }

    if (!publicKeysEqual(delegatePublicKey, keyPair.publicKey)) {
      throw new InvalidKeyError(
        "Delegate action public key must match the signer key. Use signWith() when you need a different key.",
      )
    }

    if (opts.nonceIndex !== undefined) {
      TransactionBuilder.validateNonceIndex(opts.nonceIndex)
    }

    // Resolve the underlying u64 nonce, then wrap it as a TransactionNonce
    // (GasKeyNonce when a slot index is given, plain Nonce otherwise).
    const pkString = delegatePublicKey.toString()
    let nonceValue: bigint
    if (opts.nonce !== undefined) {
      nonceValue = opts.nonce
    } else if (opts.nonceIndex !== undefined) {
      // Reserve the per-slot nonce through the shared NonceManager (keyed by
      // `pk#index`), so concurrent gas-key delegate signings on the same slot
      // get distinct nonces instead of all fetching the same chain value.
      const index = opts.nonceIndex
      nonceValue = await TransactionBuilder.nonceManager.getNextNonce(
        this.signerId,
        `${pkString}#${index}`,
        async () => this.fetchGasKeyNonce(pkString, index),
      )
    } else {
      const accessKey = await this.rpc.getAccessKey(this.signerId, pkString)
      nonceValue = BigInt(accessKey.nonce) + 1n
    }
    const txNonce: TransactionNonceBorsh =
      opts.nonceIndex !== undefined
        ? { gasKeyNonce: { nonce: nonceValue, nonceIndex: opts.nonceIndex } }
        : { nonce: { nonce: nonceValue } }

    let maxBlockHeight: bigint
    if (opts.maxBlockHeight !== undefined) {
      maxBlockHeight = opts.maxBlockHeight
    } else {
      const status = await this.rpc.getStatus()
      const offset = BigInt(opts.blockHeightOffset ?? 200)
      maxBlockHeight = BigInt(status.sync_info.latest_block_height) + offset
    }

    const delegateAction = new actions.DelegateActionV2(
      this.signerId,
      receiverId,
      this.actions as NonDelegateActionBorsh[],
      txNonce,
      maxBlockHeight,
      delegatePublicKey,
    )

    const hash = sha256(serializeDelegateActionV2(delegateAction.toBorsh()))
    const signature = keyPair.sign(hash)
    const signedDelegateAction = actions.signedDelegateV2(
      delegateAction,
      signature,
    )
    const format = (opts.payloadFormat ?? "base64") as F
    const payload = encodeSignedDelegateActionV2(signedDelegateAction, format)

    return {
      signedDelegateAction,
      payload,
      format,
    }
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
      this.signer = async (message: Uint8Array) => keyPair.sign(message)
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
  async build(): Promise<Transaction> {
    if (!this.receiverId) {
      throw new NearError(
        "No receiver ID set for transaction",
        "INVALID_TRANSACTION",
      )
    }

    // Resolve signer key pair (used for public key + nonce lookup)
    const keyPair = await this.resolveKeyPair()
    const publicKey = keyPair.publicKey

    // Use NonceManager to get next nonce (handles concurrent transactions)
    const nonce = await TransactionBuilder.nonceManager.getNextNonce(
      this.signerId,
      publicKey.toString(),
      async () => {
        const accessKey = await this.rpc.getAccessKey(
          this.signerId,
          publicKey.toString(),
        )
        return BigInt(accessKey.nonce)
      },
    )

    // Use finalized block hash - more stable across load-balanced RPC nodes
    // than getStatus() which returns the optimistic head
    const block = await this.rpc.getBlock({ finality: "final" })
    const blockHash = base58.decode(block.header.hash)

    const transaction: Transaction = {
      signerId: this.signerId,
      publicKey,
      nonce,
      receiverId: this.receiverId,
      actions: this.actions,
      blockHash,
    }

    return transaction
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
  async sign(): Promise<this> {
    if (this.cachedSignedTx) {
      // Already signed, return this
      return this
    }

    if (!this.receiverId) {
      throw new NearError(
        "No receiver ID set for transaction",
        "INVALID_TRANSACTION",
      )
    }

    // Gas-key or strict-nonce transactions use the versioned (V1) encoding.
    if (this.requiresV1()) {
      this.cachedSignedTx = await this.signV1()
      return this
    }

    // Build the transaction
    const transaction = await this.build()

    // Serialize transaction using Borsh
    const serialized = serializeTransaction(transaction)

    // NEAR protocol requires signing the SHA256 hash of the serialized transaction
    const messageHash = (await crypto.subtle.digest(
      "SHA-256",
      serialized as Uint8Array<ArrayBuffer>,
    )) as ArrayBuffer
    const messageHashArray = new Uint8Array(messageHash)

    // Compute transaction hash (base58 of SHA256)
    const txHash = base58.encode(messageHashArray)

    // Use custom signer if provided, otherwise fall back to keyStore
    const signature = this.signer
      ? await this.signer(messageHashArray)
      : (await this.resolveKeyPair()).sign(messageHashArray)

    // Cache the signed transaction
    this.cachedSignedTx = {
      signedTx: {
        transaction,
        signature,
      },
      hash: txHash,
    }

    return this
  }

  /**
   * Build and sign a versioned (V1) transaction for the gas-key / strict-nonce
   * path. Produces the cache entry consumed by {@link sign}, including the
   * pre-serialized `[0x01]`-tagged signed bytes.
   * @internal
   */
  private async signV1(): Promise<{
    signedTx: SignedTransaction
    hash: string
    serialized: Uint8Array
  }> {
    if (!this.receiverId) {
      throw new NearError(
        "No receiver ID set for transaction",
        "INVALID_TRANSACTION",
      )
    }

    const keyPair = await this.resolveKeyPair()
    const publicKey = keyPair.publicKey
    const txNonce = await this.resolveV1Nonce(publicKey)

    const block = await this.rpc.getBlock({ finality: "final" })
    const blockHash = base58.decode(block.header.hash)

    const v1: TransactionV1 = {
      signerId: this.signerId,
      publicKey,
      nonce: txNonce,
      receiverId: this.receiverId,
      blockHash,
      actions: this.actions,
      nonceMode: this.strictNonce ? { strict: {} } : { monotonic: {} },
    }

    const serializedTx = serializeTransactionV1(v1)
    const messageHash = new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        serializedTx as Uint8Array<ArrayBuffer>,
      ),
    )
    const txHash = base58.encode(messageHash)

    const signature = this.signer
      ? await this.signer(messageHash)
      : keyPair.sign(messageHash)

    // Underlying u64 nonce, regardless of the V1 nonce variant.
    const nonceValue =
      "gasKeyNonce" in txNonce ? txNonce.gasKeyNonce.nonce : txNonce.nonce.nonce

    return {
      // A V0-shaped SignedTransaction is kept for hash/field access by callers;
      // the wire bytes come from `serialized` (the V1 encoding can't round-trip
      // through the V0 SignedTransaction type).
      signedTx: {
        transaction: {
          signerId: this.signerId,
          publicKey,
          nonce: nonceValue,
          receiverId: this.receiverId,
          actions: this.actions,
          blockHash,
        },
        signature,
      },
      hash: txHash,
      serialized: serializeSignedTransactionV1(v1, signature),
    }
  }

  /**
   * Resolve the {@link TransactionNonceBorsh} for a V1 transaction.
   *
   * For a gas key the nonce comes from the chosen nonce slot (queried via
   * `EXPERIMENTAL_view_gas_key_nonces`) and is wrapped as `GasKeyNonce`; each
   * slot is tracked independently so parallel transactions on different slots
   * don't collide. For a strict-nonce ordinary key it's a plain `Nonce`.
   * @internal
   */
  private async resolveV1Nonce(
    publicKey: PublicKey,
  ): Promise<TransactionNonceBorsh> {
    const pkString = publicKey.toString()

    if (this.gasKeyNonceIndex !== undefined) {
      const index = this.gasKeyNonceIndex
      // Strict mode bypasses the monotonic cache (see below); otherwise reserve
      // the per-slot nonce through the shared manager so parallel transactions
      // on the same slot don't collide.
      if (this.strictNonce) {
        const nonce = (await this.fetchGasKeyNonce(pkString, index)) + 1n
        return { gasKeyNonce: { nonce, nonceIndex: index } }
      }
      const nonce = await TransactionBuilder.nonceManager.getNextNonce(
        this.signerId,
        `${pkString}#${index}`,
        async () => this.fetchGasKeyNonce(pkString, index),
      )
      return { gasKeyNonce: { nonce, nonceIndex: index } }
    }

    // Strict mode requires the nonce to be EXACTLY ak_nonce + 1, so it must not
    // go through the monotonic NonceManager (whose cache can be ahead of chain
    // and hand out ak_nonce + 2+). Fetch the chain nonce directly instead.
    if (this.strictNonce) {
      const accessKey = await this.rpc.getAccessKey(this.signerId, pkString)
      return { nonce: { nonce: BigInt(accessKey.nonce) + 1n } }
    }

    const nonce = await TransactionBuilder.nonceManager.getNextNonce(
      this.signerId,
      pkString,
      async () => {
        const accessKey = await this.rpc.getAccessKey(this.signerId, pkString)
        return BigInt(accessKey.nonce)
      },
    )
    return { nonce: { nonce } }
  }

  /**
   * Fetch the current on-chain nonce for a gas key's nonce slot via
   * `EXPERIMENTAL_view_gas_key_nonces`, which returns one nonce per slot.
   * @internal
   */
  private async fetchGasKeyNonce(
    publicKey: string,
    nonceIndex: number,
  ): Promise<bigint> {
    const result = await this.rpc.call<{ nonces?: unknown }>(
      "EXPERIMENTAL_view_gas_key_nonces",
      {
        finality: "optimistic",
        account_id: this.signerId,
        public_key: publicKey,
      },
    )
    const nonces = result?.nonces
    if (
      !Array.isArray(nonces) ||
      !Number.isInteger(nonceIndex) ||
      nonceIndex < 0 ||
      nonceIndex >= nonces.length
    ) {
      throw new NearError(
        `Gas key ${publicKey} on ${this.signerId} has no nonce slot ${nonceIndex}`,
        "INVALID_TRANSACTION",
      )
    }
    const raw = nonces[nonceIndex]
    // The RPC returns nonces as JSON numbers; guard against precision loss
    // before widening to bigint, and accept a string form defensively.
    if (typeof raw === "number") {
      if (!Number.isSafeInteger(raw)) {
        throw new NearError(
          `Gas key nonce slot ${nonceIndex} is not a safe integer: ${raw}`,
          "INVALID_TRANSACTION",
        )
      }
      return BigInt(raw)
    }
    if (typeof raw === "string") {
      return BigInt(raw)
    }
    throw new NearError(
      `Gas key nonce slot ${nonceIndex} has an unexpected type: ${typeof raw}`,
      "INVALID_TRANSACTION",
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
  async send(): Promise<FinalExecutionOutcomeMap["EXECUTED_OPTIMISTIC"]>
  async send<W extends keyof FinalExecutionOutcomeMap>(
    options: SendOptions<W>,
  ): Promise<FinalExecutionOutcomeMap[W]>
  async send<W extends keyof FinalExecutionOutcomeMap = "EXECUTED_OPTIMISTIC">(
    options?: SendOptions<W>,
  ): Promise<FinalExecutionOutcomeMap[W]> {
    if (!this.receiverId) {
      throw new NearError(
        "No receiver ID set for transaction",
        "INVALID_TRANSACTION",
      )
    }

    // Use wallet if available
    if (this.wallet) {
      const result = await this.wallet.signAndSendTransaction({
        signerId: this.signerId,
        receiverId: this.receiverId,
        actions: this.actions,
      })
      // Wallet doesn't support waitUntil parameter, always returns executed result
      // Cast to the expected type (this is safe because wallet always waits for execution)
      return result as FinalExecutionOutcomeMap[W]
    }

    // Determine waitUntil - use option if provided, otherwise use default
    const waitUntil = (options?.waitUntil ?? this.defaultWaitUntil) as W

    // Retry loop for InvalidNonceError
    const MAX_NONCE_RETRIES = 3
    let lastError: Error | null = null

    for (let attempt = 0; attempt < MAX_NONCE_RETRIES; attempt++) {
      try {
        // Sign if not already signed (or re-sign on retry for fresh nonce)
        if (!this.cachedSignedTx || attempt > 0) {
          // Clear cache on retry to get fresh nonce
          delete this.cachedSignedTx
          await this.sign()
        }

        if (!this.cachedSignedTx) {
          throw new NearError(
            "Failed to sign transaction",
            "TRANSACTION_SIGNING_FAILED",
          )
        }

        const { signedTx, hash, serialized } = this.cachedSignedTx

        // Serialize signed transaction using Borsh. V1 (gas-key / strict-nonce)
        // transactions carry pre-serialized wire bytes from signV1().
        const signedSerialized =
          serialized ?? serializeSignedTransaction(signedTx)

        // Send to network
        const result = await this.rpc.sendTransaction(
          signedSerialized,
          waitUntil,
        )

        // Inject minimal transaction fields if not present (for NONE/INCLUDED/INCLUDED_FINAL)
        // This ensures transaction.hash is always available
        if (!("transaction" in result) || !result.transaction) {
          ;(result as Record<string, unknown>)["transaction"] = {
            hash,
            signer_id: signedTx.transaction.signerId,
            receiver_id: this.receiverId,
            nonce: Number(signedTx.transaction.nonce),
          }
        }

        return result
      } catch (error) {
        lastError = error as Error

        // Check if it's an InvalidNonceError
        if (error instanceof InvalidNonceError) {
          // Use akNonce from the error to update cache directly
          // This avoids refetching and thundering herd on retry
          if (this.cachedSignedTx) {
            const pk =
              this.cachedSignedTx.signedTx.transaction.publicKey.toString()
            // Gas-key transactions reserve nonces under a per-slot key
            // (`pk#index`), so the retry must update that same key — not the
            // bare `pk` — or it would keep signing with the stale slot nonce.
            // Strict-nonce transactions bypass the cache entirely (they refetch
            // ak_nonce + 1 each attempt), so no cache update is needed there.
            if (!this.strictNonce) {
              const cacheKey =
                this.gasKeyNonceIndex !== undefined
                  ? `${pk}#${this.gasKeyNonceIndex}`
                  : pk
              TransactionBuilder.nonceManager.updateAndGetNext(
                this.signerId,
                cacheKey,
                BigInt(error.akNonce),
              )
            }
          }

          // If we have retries left, continue the loop to rebuild with fresh nonce
          if (attempt < MAX_NONCE_RETRIES - 1) {
            continue
          }
        }

        // Not an InvalidNonceError or out of retries - throw the error
        throw error
      }
    }

    // This should never be reached, but TypeScript needs it
    throw (
      lastError ||
      new NearError(
        "Unknown error during transaction send",
        "UNKNOWN_TRANSACTION_ERROR",
      )
    )
  }
}
