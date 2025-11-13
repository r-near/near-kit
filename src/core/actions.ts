/**
 * Transaction action factories
 * Provides clean, type-safe interfaces for creating NEAR transaction actions
 */

import type { Action, PublicKey } from "./types.js"

// ==================== Action Data Classes ====================

export class Transfer {
  deposit: bigint

  constructor(deposit: bigint) {
    this.deposit = deposit
  }
}

export class FunctionCall {
  methodName: string
  args: Uint8Array
  gas: bigint
  deposit: bigint

  constructor(methodName: string, args: Uint8Array, gas: bigint, deposit: bigint) {
    this.methodName = methodName
    this.args = args
    this.gas = gas
    this.deposit = deposit
  }
}

export class CreateAccount {}

export class DeleteAccount {
  beneficiaryId: string

  constructor(beneficiaryId: string) {
    this.beneficiaryId = beneficiaryId
  }
}

export class DeployContract {
  code: Uint8Array

  constructor(code: Uint8Array) {
    this.code = code
  }
}

export class Stake {
  stake: bigint
  publicKey: PublicKey

  constructor(stake: bigint, publicKey: PublicKey) {
    this.stake = stake
    this.publicKey = publicKey
  }
}

export class AddKey {
  publicKey: PublicKey
  accessKey: { nonce: bigint; permission: unknown }

  constructor(publicKey: PublicKey, permission: unknown) {
    this.publicKey = publicKey
    this.accessKey = { nonce: BigInt(0), permission }
  }
}

export class DeleteKey {
  publicKey: PublicKey

  constructor(publicKey: PublicKey) {
    this.publicKey = publicKey
  }
}

// ==================== Action Factory Functions ====================

/**
 * Create a transfer action
 */
export function transfer(deposit: bigint): Action {
  return {
    enum: "transfer",
    transfer: new Transfer(deposit),
  }
}

/**
 * Create a function call action
 */
export function functionCall(
  methodName: string,
  args: Uint8Array,
  gas: bigint,
  deposit: bigint
): Action {
  return {
    enum: "functionCall",
    functionCall: new FunctionCall(methodName, args, gas, deposit),
  }
}

/**
 * Create an account creation action
 */
export function createAccount(): Action {
  return {
    enum: "createAccount",
    createAccount: new CreateAccount(),
  }
}

/**
 * Create a delete account action
 */
export function deleteAccount(beneficiaryId: string): Action {
  return {
    enum: "deleteAccount",
    deleteAccount: new DeleteAccount(beneficiaryId),
  }
}

/**
 * Create a deploy contract action
 */
export function deployContract(code: Uint8Array): Action {
  return {
    enum: "deployContract",
    deployContract: new DeployContract(code),
  }
}

/**
 * Create a stake action
 */
export function stake(amount: bigint, publicKey: PublicKey): Action {
  return {
    enum: "stake",
    stake: new Stake(amount, publicKey),
  }
}

/**
 * Create an add key action
 */
export function addKey(publicKey: PublicKey, permission: unknown): Action {
  return {
    enum: "addKey",
    addKey: new AddKey(publicKey, permission),
  }
}

/**
 * Create a delete key action
 */
export function deleteKey(publicKey: PublicKey): Action {
  return {
    enum: "deleteKey",
    deleteKey: new DeleteKey(publicKey),
  }
}
