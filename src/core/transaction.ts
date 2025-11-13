/**
 * Transaction builder for creating and sending NEAR transactions
 */

import { base58 } from "@scure/base"
import { parseGas, parseNearAmount } from "../utils/format.js"
import { DEFAULT_FUNCTION_CALL_GAS } from "./constants.js"
import type { RpcClient } from "./rpc.js"
import {
  serializeTransaction,
  serializeSignedTransaction,
} from "./schema.js"
import * as actions from "./actions.js"
import type {
  Action,
  FinalExecutionOutcome,
  KeyStore,
  PublicKey,
  SignedTransaction,
  Signer,
  SimulationResult,
  Transaction,
} from "./types.js"

export class TransactionBuilder {
  private signerId: string
  private actions: Action[]
  private receiverId?: string
  private rpc: RpcClient
  private keyStore: KeyStore
  private signer?: Signer

  constructor(
    signerId: string,
    rpc: RpcClient,
    keyStore: KeyStore,
    signer?: Signer
  ) {
    this.signerId = signerId
    this.actions = []
    this.rpc = rpc
    this.keyStore = keyStore
    if (signer !== undefined) {
      this.signer = signer
    }
  }

  /**
   * Add a token transfer action
   */
  transfer(receiverId: string, amount: string | number): this {
    const amountYocto = parseNearAmount(amount.toString())
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
    options: { gas?: string | number; attachedDeposit?: string | number } = {}
  ): this {
    const argsJson = JSON.stringify(args)
    const argsBytes = new TextEncoder().encode(argsJson)

    const gas = options.gas
      ? parseGas(options.gas.toString())
      : DEFAULT_FUNCTION_CALL_GAS

    const deposit = options.attachedDeposit
      ? parseNearAmount(options.attachedDeposit.toString())
      : "0"

    this.actions.push(
      actions.functionCall(methodName, argsBytes, BigInt(gas), BigInt(deposit))
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
  stake(publicKey: string, amount: string | number): this {
    const amountYocto = parseNearAmount(amount.toString())

    // Parse public key (simplified)
    const pk: PublicKey = {
      keyType: 0,
      data: new Uint8Array(),
      toString: () => publicKey,
    }

    this.actions.push(actions.stake(BigInt(amountYocto), pk))
    return this
  }

  /**
   * Add an add key action
   */
  addKey(accountId: string, publicKey: string, permission: unknown): this {
    const pk: PublicKey = {
      keyType: 0,
      data: new Uint8Array(),
      toString: () => publicKey,
    }

    this.actions.push(actions.addKey(pk, permission))

    if (!this.receiverId) {
      this.receiverId = accountId
    }

    return this
  }

  /**
   * Add a delete key action
   */
  deleteKey(accountId: string, publicKey: string): this {
    const pk: PublicKey = {
      keyType: 0,
      data: new Uint8Array(),
      toString: () => publicKey,
    }

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
      throw new Error("String key signing not yet implemented")
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
      throw new Error("No receiver ID set for transaction")
    }

    // Get access key info for nonce and block hash
    const keyPair = await this.keyStore.get(this.signerId)
    if (!keyPair) {
      throw new Error(`No key found for account: ${this.signerId}`)
    }

    const publicKey = keyPair.publicKey
    const accessKey = await this.rpc.getAccessKey(
      this.signerId,
      publicKey.toString()
    )

    const status = await this.rpc.getStatus()
    const blockHash = base58.decode(status.sync_info.latest_block_hash)

    const transaction: Transaction = {
      signerId: this.signerId,
      publicKey,
      nonce: BigInt(accessKey.nonce) + BigInt(1),
      receiverId: this.receiverId,
      actions: this.actions,
      blockHash,
    }

    return transaction
  }

  /**
   * Sign and send the transaction
   */
  async send(): Promise<FinalExecutionOutcome> {
    const transaction = await this.build()

    // Serialize transaction using Borsh
    const serialized = serializeTransaction(transaction)

    const keyPair = await this.keyStore.get(this.signerId)
    if (!keyPair) {
      throw new Error(`No key found for account: ${this.signerId}`)
    }

    const signature = keyPair.sign(serialized)

    const signedTx: SignedTransaction = {
      transaction,
      signature,
    }

    // Serialize signed transaction using Borsh
    const signedSerialized = serializeSignedTransaction(signedTx)

    // Send to network
    const result = await this.rpc.sendTransaction(signedSerialized)

    return result as FinalExecutionOutcome
  }

  /**
   * Simulate the transaction without sending it
   */
  async simulate(): Promise<SimulationResult> {
    throw new Error("simulate() not yet implemented")
  }
}
