/**
 * Transaction action factories.
 *
 * Provides low-level, type-safe helpers for creating NEAR transaction actions.
 * Most applications should use {@link TransactionBuilder} rather than calling
 * these functions directly; they are exported for advanced and custom tooling.
 */

import { parseCodeHash } from "../utils/state-init.js"
import type {
  AccessKeyPermissionBorsh,
  AddKeyAction,
  ClassicAction,
  CreateAccountAction,
  DeleteAccountAction,
  DeleteKeyAction,
  DeployContractAction,
  DeployGlobalContractAction,
  DeterministicStateInitAction,
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
  Signature,
} from "./types.js"

// ==================== Delegate Actions ====================

/**
 * Delegate action for NEP-366 meta-transactions.
 *
 * Represents a set of classic actions signed by one account to be executed
 * by another (typically a relayer).
 */
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

// ==================== Action Factory Functions ====================

/**
 * Create a transfer action.
 *
 * @param deposit - Amount in yoctoNEAR as bigint.
 */
export function transfer(deposit: bigint): TransferAction {
  return {
    transfer: { deposit },
  }
}

/**
 * Create a function call action.
 *
 * @param methodName - Contract method name.
 * @param args - Serialized arguments as bytes.
 * @param gas - Gas attached (raw units).
 * @param deposit - Attached deposit in yoctoNEAR.
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
 * Create an account creation action.
 */
export function createAccount(): CreateAccountAction {
  return {
    createAccount: {},
  }
}

/**
 * Create a delete account action.
 */
export function deleteAccount(beneficiaryId: string): DeleteAccountAction {
  return {
    deleteAccount: { beneficiaryId },
  }
}

/**
 * Create a deploy contract action.
 *
 * @param code - WASM bytes of the contract to deploy.
 */
export function deployContract(code: Uint8Array): DeployContractAction {
  return {
    deployContract: { code },
  }
}

/**
 * Create a stake action.
 *
 * @param amount - Amount to stake in yoctoNEAR.
 * @param publicKey - Validator public key.
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
 * Create an add key action.
 *
 * @param publicKey - Public key to add.
 * @param permission - Access key permission in Borsh format.
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
 * Create a delete key action.
 *
 * @param publicKey - Public key to remove.
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
 * @returns DeployGlobalContractAction
 *
 * @example
 * ```typescript
 * // Publish updatable contract (identified by your account) - default
 * publishContract(contractCode)
 * publishContract(contractCode, { identifiedBy: "account" })
 *
 * // Publish immutable contract (identified by its hash)
 * publishContract(contractCode, { identifiedBy: "hash" })
 * ```
 */
export function publishContract(
  code: Uint8Array,
  options?: { identifiedBy?: "hash" | "account" },
): DeployGlobalContractAction {
  const deployMode =
    options?.identifiedBy === "hash" ? { CodeHash: {} } : { AccountId: {} }

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
  signature: Signature,
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

// ==================== NEP-616 Deterministic Account Actions ====================

/**
 * Options for creating a StateInit action
 */
export interface StateInitOptions {
  /**
   * Code reference - either a code hash or account ID that published the global contract
   */
  code: { codeHash: string | Uint8Array } | { accountId: string }
  /**
   * Initial key-value pairs to populate in the contract's storage
   * Keys and values should be Borsh-serialized bytes
   */
  data?: Map<Uint8Array, Uint8Array>
  /**
   * Amount to attach for storage costs (in yoctoNEAR)
   */
  deposit: bigint
}

/**
 * Create a StateInit action for deploying a contract with a deterministically derived account ID.
 *
 * This enables NEP-616 deterministic AccountIds where the account ID is derived from:
 * `"0s" + hex(keccak256(borsh(state_init))[12..32])`
 *
 * @param options - StateInit configuration
 * @returns DeterministicStateInitAction
 *
 * @example
 * ```typescript
 * // Deploy from a published global contract by account ID
 * stateInit({
 *   code: { accountId: "publisher.near" },
 *   deposit: BigInt("1000000000000000000000000"), // 1 NEAR
 * })
 *
 * // Deploy from a code hash
 * stateInit({
 *   code: { codeHash: hashBytes },
 *   deposit: BigInt("1000000000000000000000000"),
 * })
 * ```
 */
export function stateInit(
  options: StateInitOptions,
): DeterministicStateInitAction {
  let codeIdentifier: { CodeHash: number[] } | { AccountId: string }

  if ("accountId" in options.code) {
    codeIdentifier = { AccountId: options.code.accountId }
  } else {
    const hashBytes = parseCodeHash(options.code.codeHash)
    codeIdentifier = { CodeHash: Array.from(hashBytes) as number[] }
  }

  return {
    deterministicStateInit: {
      stateInit: {
        V1: {
          code: codeIdentifier,
          data: options.data ?? new Map(),
        },
      },
      deposit: options.deposit,
    },
  }
}
