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
  encodeSignedDelegateAction,
  type SignedDelegateAction,
  serializeDelegateAction,
  serializeSignedTransaction,
  serializeTransaction,
} from "./schema.js"
import type {
  Action,
  FinalExecutionOutcomeMap,
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
 * User-friendly access key permission format
 */
export type AccessKeyPermission =
  | { type: "fullAccess" }
  | {
      type: "functionCall"
      receiverId: string
      methodNames?: string[]
      allowance?: Amount
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

// JSON replacer for BigInt serialization: converts to number if safe, otherwise string
export function bigintReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") {
    const maxSafe = BigInt(Number.MAX_SAFE_INTEGER)
    return value <= maxSafe && value >= -maxSafe
      ? Number(value)
      : value.toString()
  }
  return value
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
  if (permission.type === "fullAccess") {
    return { fullAccess: {} }
  } else {
    return {
      functionCall: {
        receiverId: permission.receiverId,
        methodNames: permission.methodNames || [],
        allowance: permission.allowance
          ? BigInt(normalizeAmount(permission.allowance))
          : null,
      },
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
  }

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
        : new TextEncoder().encode(JSON.stringify(args, bigintReplacer))

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
   * Add a delete account action
   */
  deleteAccount(beneficiaryId: string): this {
    this.actions.push(actions.deleteAccount(beneficiaryId))

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
  deployFromPublished(
    reference: { codeHash: string | Uint8Array } | { accountId: string },
  ): this {
    this.actions.push(actions.deployFromPublished(reference))

    if (!this.receiverId) {
      this.receiverId = this.signerId
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

    const status = await this.rpc.getStatus()
    const blockHash = base58.decode(status.sync_info.latest_block_hash)

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
    return serializeSignedTransaction(this.cachedSignedTx.signedTx)
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

        const { signedTx, hash } = this.cachedSignedTx

        // Serialize signed transaction using Borsh
        const signedSerialized = serializeSignedTransaction(signedTx)

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
          // Invalidate cached nonce to force fresh fetch on retry
          if (this.cachedSignedTx) {
            TransactionBuilder.nonceManager.invalidate(
              this.signerId,
              this.cachedSignedTx.signedTx.transaction.publicKey.toString(),
            )
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
