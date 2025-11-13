/**
 * Transaction builder for creating and sending NEAR transactions
 */

import { serialize } from "borsh"
import { parseGas, parseNearAmount } from "../utils/format.js"
import { DEFAULT_FUNCTION_CALL_GAS } from "./constants.js"
import type { RpcClient } from "./rpc.js"
import {
  type Action,
  type FinalExecutionOutcome,
  KeyPair,
  type KeyStore,
  type PublicKey,
  type SignedTransaction,
  type Signer,
  type SimulationResult,
  type Transaction,
} from "./types.js"

// Borsh schema for transaction actions
class Transfer {
  deposit: bigint

  constructor(deposit: string) {
    this.deposit = BigInt(deposit)
  }
}

class FunctionCall {
  methodName: string
  args: Uint8Array
  gas: bigint
  deposit: bigint

  constructor(
    methodName: string,
    args: Uint8Array,
    gas: string,
    deposit: string,
  ) {
    this.methodName = methodName
    this.args = args
    this.gas = BigInt(gas)
    this.deposit = BigInt(deposit)
  }
}

class CreateAccount {}
class DeleteAccount {
  beneficiaryId: string
  constructor(id: string) {
    this.beneficiaryId = id
  }
}
class DeployContract {
  code: Uint8Array
  constructor(code: Uint8Array) {
    this.code = code
  }
}
class Stake {
  stake: bigint
  publicKey: PublicKey
  constructor(amount: string, pk: PublicKey) {
    this.stake = BigInt(amount)
    this.publicKey = pk
  }
}

class AddKey {
  publicKey: PublicKey
  accessKey: { nonce: bigint; permission: unknown }

  constructor(publicKey: PublicKey, permission: unknown) {
    this.publicKey = publicKey
    this.accessKey = { nonce: BigInt(0), permission }
  }
}

class DeleteKey {
  publicKey: PublicKey
  constructor(publicKey: PublicKey) {
    this.publicKey = publicKey
  }
}

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
    signer?: Signer,
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

    this.actions.push({
      enum: "transfer",
      transfer: new Transfer(amountYocto),
    })

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
    options: { gas?: string | number; attachedDeposit?: string | number } = {},
  ): this {
    const argsJson = JSON.stringify(args)
    const argsBytes = new TextEncoder().encode(argsJson)

    const gas = options.gas
      ? parseGas(options.gas.toString())
      : DEFAULT_FUNCTION_CALL_GAS

    const deposit = options.attachedDeposit
      ? parseNearAmount(options.attachedDeposit.toString())
      : "0"

    this.actions.push({
      enum: "functionCall",
      functionCall: new FunctionCall(methodName, argsBytes, gas, deposit),
    })

    if (!this.receiverId) {
      this.receiverId = contractId
    }

    return this
  }

  /**
   * Add a create account action
   */
  createAccount(accountId: string): this {
    this.actions.push({
      enum: "createAccount",
      createAccount: new CreateAccount(),
    })

    if (!this.receiverId) {
      this.receiverId = accountId
    }

    return this
  }

  /**
   * Add a delete account action
   */
  deleteAccount(beneficiaryId: string): this {
    this.actions.push({
      enum: "deleteAccount",
      deleteAccount: new DeleteAccount(beneficiaryId),
    })

    return this
  }

  /**
   * Add a deploy contract action
   */
  deployContract(accountId: string, code: Uint8Array): this {
    this.actions.push({
      enum: "deployContract",
      deployContract: new DeployContract(code),
    })

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

    this.actions.push({
      enum: "stake",
      stake: new Stake(amountYocto, pk),
    })

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

    this.actions.push({
      enum: "addKey",
      addKey: new AddKey(pk, permission),
    })

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

    this.actions.push({
      enum: "deleteKey",
      deleteKey: new DeleteKey(pk),
    })

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
      publicKey.toString(),
    )

    const status = await this.rpc.getStatus()
    const blockHash = this.base58ToBytes(status.sync_info.latest_block_hash)

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

    // Serialize and sign transaction
    // Note: This is a simplified version - proper implementation
    // would use Borsh serialization with correct schema
    const serialized = this.serializeTransaction(transaction)

    const keyPair = await this.keyStore.get(this.signerId)
    if (!keyPair) {
      throw new Error(`No key found for account: ${this.signerId}`)
    }

    const signature = keyPair.sign(serialized)

    const signedTx: SignedTransaction = {
      transaction,
      signature,
    }

    // Serialize signed transaction
    const signedSerialized = this.serializeSignedTransaction(signedTx)

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

  // Helper methods
  private serializeTransaction(tx: Transaction): Uint8Array {
    // Placeholder - proper implementation would use Borsh
    // For now, return a simple encoding
    const encoder = new TextEncoder()
    return encoder.encode(JSON.stringify(tx))
  }

  private serializeSignedTransaction(signedTx: SignedTransaction): Uint8Array {
    // Placeholder - proper implementation would use Borsh
    const encoder = new TextEncoder()
    return encoder.encode(JSON.stringify(signedTx))
  }

  private base58ToBytes(base58: string): Uint8Array {
    // Simplified base58 decode
    // Proper implementation in utils/key.ts
    return new Uint8Array(32) // Placeholder
  }
}
