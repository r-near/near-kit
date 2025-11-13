/**
 * Transaction action factories
 * Provides clean, type-safe interfaces for creating NEAR transaction actions
 */

import type {
  PublicKey,
  Ed25519PublicKey,
  Secp256k1PublicKey,
} from "./types.js"
import type {
  ClassicAction,
  AccessKeyPermissionBorsh,
  TransferAction,
  FunctionCallAction,
  CreateAccountAction,
  DeleteAccountAction,
  DeployContractAction,
  StakeAction,
  AddKeyAction,
  DeleteKeyAction,
  DeployGlobalContractAction,
  UseGlobalContractAction,
  SignedDelegateAction,
} from "./schema.js"
import { publicKeyToZorsh, signatureToZorsh } from "./schema.js"

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

// ==================== Global Contract Actions ====================

export class GlobalContractDeployMode {
  CodeHash?: Record<string, never>
  AccountId?: Record<string, never>

  constructor(mode: { CodeHash: Record<string, never> } | { AccountId: Record<string, never> }) {
    if ("CodeHash" in mode) {
      this.CodeHash = mode.CodeHash
    } else if ("AccountId" in mode) {
      this.AccountId = mode.AccountId
    }
  }
}

export class GlobalContractIdentifier {
  CodeHash?: Uint8Array
  AccountId?: string

  constructor(id: { CodeHash: Uint8Array } | { AccountId: string }) {
    if ("CodeHash" in id) {
      this.CodeHash = id.CodeHash
    } else if ("AccountId" in id) {
      this.AccountId = id.AccountId
    }
  }
}

export class DeployGlobalContract {
  code: Uint8Array
  deployMode: GlobalContractDeployMode

  constructor(code: Uint8Array, deployMode: GlobalContractDeployMode) {
    this.code = code
    this.deployMode = deployMode
  }
}

export class UseGlobalContract {
  contractIdentifier: GlobalContractIdentifier

  constructor(contractIdentifier: GlobalContractIdentifier) {
    this.contractIdentifier = contractIdentifier
  }
}

// ==================== Delegate Actions ====================

export class DelegateAction {
  senderId: string
  receiverId: string
  actions: ClassicAction[]
  nonce: bigint
  maxBlockHeight: bigint
  publicKey: PublicKey

  constructor(
    senderId: string,
    receiverId: string,
    actions: ClassicAction[],
    nonce: bigint,
    maxBlockHeight: bigint,
    publicKey: PublicKey
  ) {
    this.senderId = senderId
    this.receiverId = receiverId
    this.actions = actions
    this.nonce = nonce
    this.maxBlockHeight = maxBlockHeight
    this.publicKey = publicKey
  }
}

export class SignedDelegate {
  delegateAction: DelegateAction
  signature: import("./types.js").Signature

  constructor(delegateAction: DelegateAction, signature: import("./types.js").Signature) {
    this.delegateAction = delegateAction
    this.signature = signature
  }
}

// ==================== Action Factory Functions ====================

/**
 * Create a transfer action
 */
export function transfer(deposit: bigint): TransferAction {
  return {
    transfer: { deposit },
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
): FunctionCallAction {
  return {
    functionCall: { methodName, args, gas, deposit },
  }
}

/**
 * Create an account creation action
 */
export function createAccount(): CreateAccountAction {
  return {
    createAccount: {},
  }
}

/**
 * Create a delete account action
 */
export function deleteAccount(beneficiaryId: string): DeleteAccountAction {
  return {
    deleteAccount: { beneficiaryId },
  }
}

/**
 * Create a deploy contract action
 */
export function deployContract(code: Uint8Array): DeployContractAction {
  return {
    deployContract: { code },
  }
}

/**
 * Create a stake action
 */
export function stake(
  amount: bigint,
  publicKey: Ed25519PublicKey
): { stake: { stake: bigint; publicKey: { ed25519Key: { data: number[] } } } }
export function stake(
  amount: bigint,
  publicKey: Secp256k1PublicKey
): { stake: { stake: bigint; publicKey: { secp256k1Key: { data: number[] } } } }
export function stake(amount: bigint, publicKey: PublicKey): StakeAction
export function stake(amount: bigint, publicKey: PublicKey): StakeAction {
  return {
    stake: {
      stake: amount,
      publicKey: publicKeyToZorsh(publicKey),
    },
  }
}

/**
 * Create an add key action
 */
export function addKey(
  publicKey: Ed25519PublicKey,
  permission: AccessKeyPermissionBorsh
): {
  addKey: {
    publicKey: { ed25519Key: { data: number[] } }
    accessKey: { nonce: bigint; permission: AccessKeyPermissionBorsh }
  }
}
export function addKey(
  publicKey: Secp256k1PublicKey,
  permission: AccessKeyPermissionBorsh
): {
  addKey: {
    publicKey: { secp256k1Key: { data: number[] } }
    accessKey: { nonce: bigint; permission: AccessKeyPermissionBorsh }
  }
}
export function addKey(
  publicKey: PublicKey,
  permission: AccessKeyPermissionBorsh
): AddKeyAction
export function addKey(
  publicKey: PublicKey,
  permission: AccessKeyPermissionBorsh
): AddKeyAction {
  return {
    addKey: {
      publicKey: publicKeyToZorsh(publicKey),
      accessKey: { nonce: BigInt(0), permission },
    },
  }
}

/**
 * Create a delete key action
 */
export function deleteKey(
  publicKey: Ed25519PublicKey
): { deleteKey: { publicKey: { ed25519Key: { data: number[] } } } }
export function deleteKey(
  publicKey: Secp256k1PublicKey
): { deleteKey: { publicKey: { secp256k1Key: { data: number[] } } } }
export function deleteKey(publicKey: PublicKey): DeleteKeyAction
export function deleteKey(publicKey: PublicKey): DeleteKeyAction {
  return {
    deleteKey: {
      publicKey: publicKeyToZorsh(publicKey),
    },
  }
}

/**
 * Create a deploy global contract action
 */
export function deployGlobalContract(
  code: Uint8Array,
  deployMode: GlobalContractDeployMode
): DeployGlobalContractAction {
  // Convert class instance to discriminated union
  const deployModeConverted = deployMode.CodeHash !== undefined
    ? { CodeHash: {} }
    : { AccountId: {} }

  return {
    deployGlobalContract: {
      code,
      deployMode: deployModeConverted,
    },
  }
}

/**
 * Create a use global contract action
 */
export function useGlobalContract(
  contractIdentifier: GlobalContractIdentifier
): UseGlobalContractAction {
  // Convert class instance to discriminated union
  const identifierConverted = contractIdentifier.CodeHash !== undefined
    ? { CodeHash: Array.from(contractIdentifier.CodeHash) as number[] }
    : { AccountId: contractIdentifier.AccountId as string }

  return {
    useGlobalContract: {
      contractIdentifier: identifierConverted,
    },
  }
}

/**
 * Create a signed delegate action for meta-transactions
 */
export function signedDelegate(
  delegateAction: DelegateAction,
  signature: import("./types.js").Signature
): SignedDelegateAction {
  return {
    signedDelegate: {
      delegateAction: {
        senderId: delegateAction.senderId,
        receiverId: delegateAction.receiverId,
        actions: delegateAction.actions,
        nonce: delegateAction.nonce,
        maxBlockHeight: delegateAction.maxBlockHeight,
        publicKey: publicKeyToZorsh(delegateAction.publicKey),
      },
      signature: signatureToZorsh(signature),
    },
  }
}
