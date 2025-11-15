/**
 * Transaction action factories
 * Provides clean, type-safe interfaces for creating NEAR transaction actions
 */

import { base58 } from "@scure/base"
import type {
  AccessKeyPermissionBorsh,
  AddKeyAction,
  ClassicAction,
  CreateAccountAction,
  DeleteAccountAction,
  DeleteKeyAction,
  DeployContractAction,
  DeployGlobalContractAction,
  FunctionCallAction,
  SignedDelegateAction,
  StakeAction,
  TransferAction,
  UseGlobalContractAction,
} from "./schema.js"
import { publicKeyToZorsh, signatureToZorsh } from "./schema.js"
import type {
  Ed25519PublicKey,
  PublicKey,
  Secp256k1PublicKey,
} from "./types.js"

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
    publicKey: PublicKey,
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

  constructor(
    delegateAction: DelegateAction,
    signature: import("./types.js").Signature,
  ) {
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
  deposit: bigint,
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
  publicKey: Ed25519PublicKey,
): { stake: { stake: bigint; publicKey: { ed25519Key: { data: number[] } } } }
export function stake(
  amount: bigint,
  publicKey: Secp256k1PublicKey,
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
  permission: AccessKeyPermissionBorsh,
): {
  addKey: {
    publicKey: { ed25519Key: { data: number[] } }
    accessKey: { nonce: bigint; permission: AccessKeyPermissionBorsh }
  }
}
export function addKey(
  publicKey: Secp256k1PublicKey,
  permission: AccessKeyPermissionBorsh,
): {
  addKey: {
    publicKey: { secp256k1Key: { data: number[] } }
    accessKey: { nonce: bigint; permission: AccessKeyPermissionBorsh }
  }
}
export function addKey(
  publicKey: PublicKey,
  permission: AccessKeyPermissionBorsh,
): AddKeyAction
export function addKey(
  publicKey: PublicKey,
  permission: AccessKeyPermissionBorsh,
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
export function deleteKey(publicKey: Ed25519PublicKey): {
  deleteKey: { publicKey: { ed25519Key: { data: number[] } } }
}
export function deleteKey(publicKey: Secp256k1PublicKey): {
  deleteKey: { publicKey: { secp256k1Key: { data: number[] } } }
}
export function deleteKey(publicKey: PublicKey): DeleteKeyAction
export function deleteKey(publicKey: PublicKey): DeleteKeyAction {
  return {
    deleteKey: {
      publicKey: publicKeyToZorsh(publicKey),
    },
  }
}

/**
 * Publish a global contract that can be reused by multiple accounts
 *
 * @param code - The compiled contract code bytes
 * @param accountId - Optional account ID. If provided, creates a mutable contract (can be updated).
 *                    If omitted, creates an immutable contract (identified by code hash).
 * @returns DeployGlobalContractAction
 *
 * @example
 * ```typescript
 * // Publish immutable contract (identified by code hash)
 * publishContract(contractCode)
 *
 * // Publish mutable contract (identified by account, can be updated)
 * publishContract(contractCode, "my-publisher.near")
 * ```
 */
export function publishContract(
  code: Uint8Array,
  accountId?: string,
): DeployGlobalContractAction {
  const deployMode = accountId ? { AccountId: {} } : { CodeHash: {} }

  return {
    deployGlobalContract: {
      code,
      deployMode,
    },
  }
}

/**
 * Deploy a contract to this account from previously published code in the global registry
 *
 * @param reference - Reference to the published contract, either:
 *                    - { codeHash: Uint8Array | string } - Reference by code hash (Uint8Array or base58 string)
 *                    - { accountId: string } - Reference by the account that published it
 * @returns UseGlobalContractAction
 *
 * @example
 * ```typescript
 * // Deploy from code hash (Uint8Array)
 * deployFromPublished({ codeHash: hashBytes })
 *
 * // Deploy from code hash (base58 string)
 * deployFromPublished({ codeHash: "5FzD8..." })
 *
 * // Deploy from account ID
 * deployFromPublished({ accountId: "contract-publisher.near" })
 * ```
 */
export function deployFromPublished(
  reference: { codeHash: string | Uint8Array } | { accountId: string },
): UseGlobalContractAction {
  let contractIdentifier: { CodeHash: number[] } | { AccountId: string }

  if ("accountId" in reference) {
    contractIdentifier = { AccountId: reference.accountId }
  } else {
    // Handle codeHash - could be string (base58) or Uint8Array
    const hashBytes =
      typeof reference.codeHash === "string"
        ? base58.decode(reference.codeHash)
        : reference.codeHash

    // Validate hash is 32 bytes
    if (hashBytes.length !== 32) {
      throw new Error(
        `Code hash must be 32 bytes, got ${hashBytes.length} bytes`,
      )
    }

    contractIdentifier = { CodeHash: Array.from(hashBytes) as number[] }
  }

  return {
    useGlobalContract: {
      contractIdentifier,
    },
  }
}

/**
 * Create a signed delegate action for meta-transactions
 */
export function signedDelegate(
  delegateAction: DelegateAction,
  signature: import("./types.js").Signature,
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
