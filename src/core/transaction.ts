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
 * - Use `.build()` to get unsigned transaction, or `.simulate()` to test without sending
 */

import { base58 } from "@scure/base"
import { InvalidKeyError, NearError } from "../errors/index.js"
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
import type { RpcClient } from "./rpc/rpc.js"
import {
  type AccessKeyPermissionBorsh,
  serializeSignedTransaction,
  serializeTransaction,
} from "./schema.js"
import type {
  Action,
  FinalExecutionOutcomeMap,
  KeyPair,
  KeyStore,
  SendOptions,
  SignedTransaction,
  Signer,
  SimulationResult,
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

/**
 * Convert user-friendly permission format to Borsh format
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

export class TransactionBuilder {
  private signerId: string
  private actions: Action[]
  private receiverId?: string
  private rpc: RpcClient
  private keyStore: KeyStore
  private signer?: Signer
  private keyPair?: KeyPair // KeyPair from signWith() for building transaction
  private wallet?: WalletConnection
  private defaultWaitUntil: TxExecutionStatus

  constructor(
    signerId: string,
    rpc: RpcClient,
    keyStore: KeyStore,
    signer?: Signer,
    defaultWaitUntil: TxExecutionStatus = "EXECUTED_OPTIMISTIC",
    wallet?: WalletConnection,
  ) {
    this.signerId = signerId
    this.actions = []
    this.rpc = rpc
    this.keyStore = keyStore
    if (signer !== undefined) {
      this.signer = signer
    }
    this.defaultWaitUntil = defaultWaitUntil
    if (wallet !== undefined) {
      this.wallet = wallet
    }
  }

  /**
   * Add a token transfer action
   */
  transfer(receiverId: string, amount: Amount): this {
    const amountYocto = normalizeAmount(amount)
    this.actions.push(actions.transfer(BigInt(amountYocto)))

    if (!this.receiverId) {
      this.receiverId = receiverId
    }

    return this
  }

  /**
   * Add a function call action
   */
  functionCall(
    contractId: string,
    methodName: string,
    args: object = {},
    options: { gas?: Gas; attachedDeposit?: Amount } = {},
  ): this {
    const argsJson = JSON.stringify(args)
    const argsBytes = new TextEncoder().encode(argsJson)

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

    return this
  }

  /**
   * Add a create account action
   */
  createAccount(accountId: string): this {
    this.actions.push(actions.createAccount())

    if (!this.receiverId) {
      this.receiverId = accountId
    }

    return this
  }

  /**
   * Add a delete account action
   */
  deleteAccount(beneficiaryId: string): this {
    this.actions.push(actions.deleteAccount(beneficiaryId))
    return this
  }

  /**
   * Add a deploy contract action
   */
  deployContract(accountId: string, code: Uint8Array): this {
    this.actions.push(actions.deployContract(code))

    if (!this.receiverId) {
      this.receiverId = accountId
    }

    return this
  }

  /**
   * Publish a global contract that can be reused by multiple accounts
   *
   * @param code - The compiled contract code bytes
   * @param publisherId - Optional account ID. If provided, creates a mutable contract (can be updated).
   *                      If omitted, creates an immutable contract (identified by code hash).
   *
   * @example
   * ```typescript
   * // Publish immutable contract (identified by code hash)
   * await near.transaction(accountId)
   *   .publishContract(contractCode)
   *   .send()
   *
   * // Publish mutable contract (identified by account, can be updated)
   * await near.transaction(accountId)
   *   .publishContract(contractCode, "my-publisher.near")
   *   .send()
   * ```
   */
  publishContract(code: Uint8Array, publisherId?: string): this {
    this.actions.push(actions.publishContract(code, publisherId))

    if (!this.receiverId) {
      this.receiverId = this.signerId
    }

    return this
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

    return this
  }

  /**
   * Add a stake action
   */
  stake(publicKey: string, amount: Amount): this {
    const amountYocto = normalizeAmount(amount)
    const pk = parsePublicKey(publicKey)
    this.actions.push(actions.stake(BigInt(amountYocto), pk))
    return this
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

    return this
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

    return this
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

    return this
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

    // Get key pair - either from signWith() or keyStore
    const keyPair = this.keyPair || (await this.keyStore.get(this.signerId))
    if (!keyPair) {
      throw new InvalidKeyError(`No key found for account: ${this.signerId}`)
    }

    const publicKey = keyPair.publicKey
    const accessKey = await this.rpc.getAccessKey(
      this.signerId,
      publicKey.toString(),
    )

    const status = await this.rpc.getStatus()
    const blockHash = base58.decode(status.sync_info.latest_block_hash)

    const transaction: Transaction = {
      signerId: this.signerId,
      publicKey,
      // NEAR access key nonce represents the last used nonce,
      // so next transaction should use nonce + 1
      nonce: BigInt(accessKey.nonce) + BigInt(1),
      receiverId: this.receiverId,
      actions: this.actions,
      blockHash,
    }

    return transaction
  }

  /**
   * Sign and send the transaction
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

    // Build transaction using private key/signer approach
    const transaction = await this.build()

    // Serialize transaction using Borsh
    const serialized = serializeTransaction(transaction)

    // NEAR protocol requires signing the SHA256 hash of the serialized transaction
    const messageHash = (await crypto.subtle.digest(
      "SHA-256",
      serialized as Uint8Array<ArrayBuffer>,
    )) as ArrayBuffer
    const messageHashArray = new Uint8Array(messageHash)

    // Use custom signer if provided, otherwise fall back to keyStore
    const signature = this.signer
      ? await this.signer(messageHashArray)
      : await (async () => {
          const keyPair = await this.keyStore.get(this.signerId)
          if (!keyPair) {
            throw new InvalidKeyError(
              `No key found for account: ${this.signerId}`,
            )
          }
          return keyPair.sign(messageHashArray)
        })()

    const signedTx: SignedTransaction = {
      transaction,
      signature,
    }

    // Serialize signed transaction using Borsh
    const signedSerialized = serializeSignedTransaction(signedTx)

    // Determine waitUntil - use option if provided, otherwise use default
    const waitUntil = (options?.waitUntil ?? this.defaultWaitUntil) as W

    // Send to network
    return await this.rpc.sendTransaction(signedSerialized, waitUntil)
  }

  /**
   * Simulate the transaction without sending it
   */
  async simulate(): Promise<SimulationResult> {
    throw new Error("simulate() not yet implemented")
  }
}
