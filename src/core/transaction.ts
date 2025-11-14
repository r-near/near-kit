/**
 * Transaction builder for creating and sending NEAR transactions
 */

import { base58 } from "@scure/base"
import { InvalidKeyError, NearError, SignatureError } from "../errors/index.js"
import { parsePublicKey } from "../utils/key.js"
import {
  type Amount,
  type Gas,
  normalizeAmount,
  normalizeGas,
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
  FinalExecutionOutcome,
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
  private wallet?: WalletConnection
  private defaultWaitUntil: TxExecutionStatus

  constructor(
    signerId: string,
    rpc: RpcClient,
    keyStore: KeyStore,
    signer?: Signer,
    defaultWaitUntil: TxExecutionStatus = "EXECUTED_OPTIMISTIC",
    wallet?: WalletConnection
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
   * Override the signer for this transaction
   */
  signWith(key: string | Signer): this {
    if (typeof key === "string") {
      // Parse key and create signer
      // This would require parseKey implementation
      throw new SignatureError("String key signing not yet implemented")
    } else {
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

    // Get access key info for nonce and block hash
    const keyPair = await this.keyStore.get(this.signerId)
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
  async send(options?: SendOptions): Promise<FinalExecutionOutcome> {
    if (!this.receiverId) {
      throw new NearError(
        "No receiver ID set for transaction",
        "INVALID_TRANSACTION"
      )
    }

    // Use wallet if available
    if (this.wallet) {
      return await this.wallet.signAndSendTransaction({
        signerId: this.signerId,
        receiverId: this.receiverId,
        actions: this.actions,
      })
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
    const waitUntil = options?.waitUntil ?? this.defaultWaitUntil

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
