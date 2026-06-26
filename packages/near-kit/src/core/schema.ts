/**
 * Borsh serialization schemas for NEAR transactions using Zorsh
 * Based on NEAR Protocol specification and near-api-js implementation
 *
 * This module handles the low-level binary serialization details and keeps
 * all Zorsh-specific types internal. External code should only use the
 * serializeTransaction and serializeSignedTransaction functions.
 */

import { base64 } from "@scure/base"
import { b } from "@zorsh/zorsh"
import { InvalidKeyError } from "../errors/index.js"
import type { DelegateAction } from "./actions.js"
import type {
  Ed25519PublicKey,
  Ed25519Signature,
  MlDsa65PublicKey,
  MlDsa65Signature,
  PublicKey,
  Secp256k1PublicKey,
  Secp256k1Signature,
  Signature,
  SignedTransaction,
  Transaction,
} from "./types.js"
import { KeyType } from "./types.js"

// ==================== NEP-461 Prefix ====================

/**
 * Prefix for delegate actions (NEP-366 meta transactions)
 * Value: 2^30 + 366 = 1073742190
 *
 * This prefix is prepended to DelegateAction when serializing for signing,
 * ensuring delegate action signatures are always distinguishable from
 * transaction signatures.
 */
export const DELEGATE_ACTION_PREFIX = 1073742190

/**
 * Prefix for V2 delegate actions (gas-key meta transactions, NEP-611).
 * Value: 2^30 + 611 = 1073742435
 *
 * This is the NEP-461 domain tag for `DelegateActionV2`. It is DISTINCT from
 * {@link DELEGATE_ACTION_PREFIX}, so a V1 delegate signature is never valid for
 * a V2 delegate action and vice versa.
 */
export const DELEGATE_ACTION_V2_PREFIX = 1073742435

// ==================== Public Key ====================

/**
 * Ed25519 public key data (32 bytes)
 */
const Ed25519KeySchema = b.struct({
  data: b.array(b.u8(), 32),
})

/**
 * Secp256k1 public key data (64 bytes)
 */
const Secp256k1KeySchema = b.struct({
  data: b.array(b.u8(), 64),
})

/**
 * ML-DSA-65 (FIPS 204) public key data (1952 bytes)
 */
const MlDsa65KeySchema = b.struct({
  data: b.array(b.u8(), 1952),
})

/**
 * PublicKey enum (0 = Ed25519, 1 = Secp256k1, 2 = ML-DSA-65)
 */
export const PublicKeySchema = b.enum({
  ed25519Key: Ed25519KeySchema,
  secp256k1Key: Secp256k1KeySchema,
  mlDsa65Key: MlDsa65KeySchema,
})

// ==================== Signature ====================

/**
 * Ed25519 signature data (64 bytes)
 */
const Ed25519SignatureSchema = b.struct({
  data: b.array(b.u8(), 64),
})

/**
 * Secp256k1 signature data (65 bytes)
 */
const Secp256k1SignatureSchema = b.struct({
  data: b.array(b.u8(), 65),
})

/**
 * ML-DSA-65 (FIPS 204) signature data (3309 bytes)
 */
const MlDsa65SignatureSchema = b.struct({
  data: b.array(b.u8(), 3309),
})

/**
 * Signature enum (0 = Ed25519, 1 = Secp256k1, 2 = ML-DSA-65)
 */
export const SignatureSchema = b.enum({
  ed25519Signature: Ed25519SignatureSchema,
  secp256k1Signature: Secp256k1SignatureSchema,
  mlDsa65Signature: MlDsa65SignatureSchema,
})

// ==================== Access Key Permissions ====================

/**
 * Function call permission with optional allowance
 */
const FunctionCallPermissionSchema = b.struct({
  allowance: b.option(b.u128()),
  receiverId: b.string(),
  methodNames: b.vec(b.string()),
})

/**
 * FunctionCallPermission type inferred from the Borsh schema.
 */
export type FunctionCallPermissionBorsh = b.infer<
  typeof FunctionCallPermissionSchema
>

/**
 * Full access permission (empty struct)
 */
const FullAccessPermissionSchema = b.struct({})

/**
 * Gas key information (protocol v85 / NEAR 2.13).
 *
 * Gas keys are access keys with a prepaid balance used to pay for gas. A single
 * gas key allocates `numNonces` independent nonce slots so it can sign multiple
 * transactions in parallel.
 *
 * Field order matches nearcore `GasKeyInfo { balance: u128, num_nonces: u16 }`.
 */
const GasKeyInfoSchema = b.struct({
  balance: b.u128(),
  numNonces: b.u16(),
})

/**
 * AccessKeyPermission enum.
 *
 * Variant order is the Borsh discriminant and MUST match nearcore:
 * 0 = FunctionCall, 1 = FullAccess, 2 = GasKeyFunctionCall, 3 = GasKeyFullAccess.
 */
export const AccessKeyPermissionSchema = b.enum({
  functionCall: FunctionCallPermissionSchema,
  fullAccess: FullAccessPermissionSchema,
  gasKeyFunctionCall: b.struct({
    gasKeyInfo: GasKeyInfoSchema,
    functionCall: FunctionCallPermissionSchema,
  }),
  gasKeyFullAccess: b.struct({
    gasKeyInfo: GasKeyInfoSchema,
  }),
})

/**
 * GasKeyInfo type inferred from the Borsh schema.
 */
export type GasKeyInfoBorsh = b.infer<typeof GasKeyInfoSchema>

/**
 * AccessKeyPermission type inferred from schema
 */
export type AccessKeyPermissionBorsh = b.infer<typeof AccessKeyPermissionSchema>

/**
 * Access key with nonce and permission
 */
const AccessKeySchema = b.struct({
  nonce: b.u64(),
  permission: AccessKeyPermissionSchema,
})

// ==================== Transaction Actions ====================

/**
 * CreateAccount action (empty struct)
 */
const CreateAccountSchema = b.struct({})

/**
 * DeployContract action with WASM code
 */
const DeployContractSchema = b.struct({
  code: b.bytes(),
})

/**
 * FunctionCall action
 * Field order: methodName, args, gas, deposit
 */
const FunctionCallSchema = b.struct({
  methodName: b.string(),
  args: b.bytes(),
  gas: b.u64(),
  deposit: b.u128(),
})

/**
 * Transfer action with deposit amount
 */
const TransferSchema = b.struct({
  deposit: b.u128(),
})

/**
 * Stake action with amount and validator public key
 */
const StakeSchema = b.struct({
  stake: b.u128(),
  publicKey: PublicKeySchema,
})

/**
 * AddKey action to add a new access key
 */
const AddKeySchema = b.struct({
  publicKey: PublicKeySchema,
  accessKey: AccessKeySchema,
})

/**
 * DeleteKey action to remove an access key
 */
const DeleteKeySchema = b.struct({
  publicKey: PublicKeySchema,
})

/**
 * DeleteAccount action with beneficiary
 */
const DeleteAccountSchema = b.struct({
  beneficiaryId: b.string(),
})

// ==================== Gas Key Actions ====================

/**
 * TransferToGasKey action (protocol v85 / NEAR 2.13).
 *
 * Funds a gas key's prepaid balance. Mirrors nearcore
 * `TransferToGasKeyAction { public_key: PublicKey, deposit: u128 }`.
 */
const TransferToGasKeySchema = b.struct({
  publicKey: PublicKeySchema,
  deposit: b.u128(),
})

/**
 * WithdrawFromGasKey action (protocol v85 / NEAR 2.13).
 *
 * Withdraws NEAR from a gas key's balance back to the account. Mirrors nearcore
 * `WithdrawFromGasKeyAction { public_key: PublicKey, amount: u128 }`. Note the
 * second field is `amount`, not `deposit`.
 */
const WithdrawFromGasKeySchema = b.struct({
  publicKey: PublicKeySchema,
  amount: b.u128(),
})

// ==================== Global Contract Actions ====================

/**
 * GlobalContractDeployMode enum
 * 0 = CodeHash (deploy by code hash)
 * 1 = AccountId (deploy by account ID)
 */
const GlobalContractDeployModeSchema = b.enum({
  CodeHash: b.struct({}),
  AccountId: b.struct({}),
})

/**
 * GlobalContractIdentifier enum
 * 0 = CodeHash (32-byte hash)
 * 1 = AccountId (string)
 */
const GlobalContractIdentifierSchema = b.enum({
  CodeHash: b.array(b.u8(), 32),
  AccountId: b.string(),
})

/**
 * DeployGlobalContract action
 */
const DeployGlobalContractSchema = b.struct({
  code: b.bytes(),
  deployMode: GlobalContractDeployModeSchema,
})

/**
 * UseGlobalContract action
 */
const UseGlobalContractSchema = b.struct({
  contractIdentifier: GlobalContractIdentifierSchema,
})

// ==================== NEP-616 Deterministic Account (StateInit) Actions ====================

/**
 * DeterministicAccountStateInitV1 struct
 * Contains the initialization state for a deterministic account
 */
const DeterministicAccountStateInitV1Schema = b.struct({
  code: GlobalContractIdentifierSchema,
  data: b.hashMap(b.bytes(), b.bytes()),
})

/**
 * DeterministicAccountStateInit enum (versioned)
 * V1 is the first version
 */
const DeterministicAccountStateInitSchema = b.enum({
  V1: DeterministicAccountStateInitV1Schema,
})

/**
 * DeterministicStateInit action (NEP-616)
 * Used to deploy a contract with a deterministically derived account ID
 */
const DeterministicStateInitSchema = b.struct({
  stateInit: DeterministicAccountStateInitSchema,
  deposit: b.u128(),
})

// ==================== Transaction Nonce / Mode (NEAR 2.13) ====================
//
// Defined here (ahead of the action/delegate schemas) because DelegateActionV2
// uses TransactionNonce, and they are leaf enums with no forward dependencies.

/**
 * TransactionNonce enum (NEAR 2.13).
 *
 * Variant order is the Borsh discriminant and MUST match nearcore:
 * 0 = `Nonce { nonce: u64 }` (ordinary access keys),
 * 1 = `GasKeyNonce { nonce: u64, nonce_index: u16 }` (gas keys).
 */
export const TransactionNonceSchema = b.enum({
  nonce: b.struct({ nonce: b.u64() }),
  gasKeyNonce: b.struct({ nonce: b.u64(), nonceIndex: b.u16() }),
})

/**
 * NonceMode enum (NEAR 2.13).
 *
 * Variant order is the Borsh discriminant and MUST match nearcore:
 * 0 = `Monotonic` (default; any nonce strictly greater than the access key
 * nonce), 1 = `Strict` (nonce must be exactly `ak_nonce + 1`).
 */
export const NonceModeSchema = b.enum({
  monotonic: b.struct({}),
  strict: b.struct({}),
})

// ==================== Delegate Actions ====================

/**
 * ClassicActions enum - the actions allowed inside a DelegateAction (NEP-366),
 * mirroring nearcore's `NonDelegateAction` which wraps the full `Action` enum.
 *
 * The Borsh discriminants MUST match `Action` exactly. A zorsh enum assigns
 * discriminants positionally, so slot 8 (`Action::Delegate`) is kept as a
 * placeholder to keep slots 9..=13 aligned with the protocol; it is never
 * emitted because delegate actions cannot be nested. The gas-key actions
 * therefore land at their true discriminants 12 and 13.
 */
const ClassicActionsSchema = b.enum({
  createAccount: CreateAccountSchema,
  deployContract: DeployContractSchema,
  functionCall: FunctionCallSchema,
  transfer: TransferSchema,
  stake: StakeSchema,
  addKey: AddKeySchema,
  deleteKey: DeleteKeySchema,
  deleteAccount: DeleteAccountSchema,
  // Slot 8 = Action::Delegate. Placeholder for discriminant alignment only;
  // nested delegate actions are forbidden, so this is never serialized. (An
  // empty-struct schema is reused so this enum has no forward dependency on
  // the delegate schemas defined below.)
  delegatePlaceholder: CreateAccountSchema,
  deployGlobalContract: DeployGlobalContractSchema,
  useGlobalContract: UseGlobalContractSchema,
  deterministicStateInit: DeterministicStateInitSchema,
  transferToGasKey: TransferToGasKeySchema,
  withdrawFromGasKey: WithdrawFromGasKeySchema,
})

/**
 * ClassicAction type - actions that can be used within a DelegateAction.
 *
 * Excludes the `delegatePlaceholder` (discriminant-alignment-only) variant so
 * callers cannot construct a nested delegate action, which the protocol forbids.
 */
export type ClassicAction = Exclude<
  b.infer<typeof ClassicActionsSchema>,
  { delegatePlaceholder: unknown }
>

/**
 * DelegateAction for meta-transactions
 * Allows one account to sign a transaction on behalf of another
 */
const DelegateActionSchema = b.struct({
  senderId: b.string(),
  receiverId: b.string(),
  actions: b.vec(ClassicActionsSchema),
  nonce: b.u64(),
  maxBlockHeight: b.u64(),
  publicKey: PublicKeySchema,
})

/**
 * SignedDelegate - a delegate action with signature
 */
const SignedDelegateSchema = b.struct({
  delegateAction: DelegateActionSchema,
  signature: SignatureSchema,
})

// ==================== DelegateV2 (gas-key meta-transactions, NEAR 2.13) ====================
//
// `DelegateActionV2` is like the NEP-366 `DelegateAction` but its `nonce` is a
// `TransactionNonce` (gas-key capable). It is carried by `Action::DelegateV2`
// (discriminant 14) inside a versioned payload, and is signed under a DISTINCT
// NEP-461 domain tag (NEP-611), so V1 delegate signatures are NOT valid for V2.

/**
 * Actions allowed inside a DelegateActionV2, mirroring nearcore's
 * `NonDelegateAction` (which wraps the full `Action` enum and rejects nested
 * delegates at runtime).
 *
 * The Borsh discriminants MUST match `Action` exactly (0..=13). A zorsh enum
 * assigns discriminants positionally, so slot 8 (`Action::Delegate`) is kept as
 * a placeholder to keep slots 9..=13 aligned with the protocol; it is never
 * emitted because delegate actions cannot be nested. This deliberately differs
 * from the V1 `ClassicActionsSchema`, whose discriminants drift past index 8.
 */
const NonDelegateActionSchema = b.enum({
  createAccount: CreateAccountSchema,
  deployContract: DeployContractSchema,
  functionCall: FunctionCallSchema,
  transfer: TransferSchema,
  stake: StakeSchema,
  addKey: AddKeySchema,
  deleteKey: DeleteKeySchema,
  deleteAccount: DeleteAccountSchema,
  // Slot 8 = Action::Delegate. Placeholder for discriminant alignment only;
  // nested delegate actions are forbidden, so this is never serialized.
  signedDelegate: SignedDelegateSchema,
  deployGlobalContract: DeployGlobalContractSchema,
  useGlobalContract: UseGlobalContractSchema,
  deterministicStateInit: DeterministicStateInitSchema,
  transferToGasKey: TransferToGasKeySchema,
  withdrawFromGasKey: WithdrawFromGasKeySchema,
})

/**
 * DelegateActionV2 struct (NEAR 2.13).
 *
 * Field order matches nearcore `DelegateActionV2`: sender_id, receiver_id,
 * actions, nonce (a {@link TransactionNonceSchema}), max_block_height, public_key.
 */
const DelegateActionV2Schema = b.struct({
  senderId: b.string(),
  receiverId: b.string(),
  actions: b.vec(NonDelegateActionSchema),
  nonce: TransactionNonceSchema,
  maxBlockHeight: b.u64(),
  publicKey: PublicKeySchema,
})

/**
 * VersionedDelegateActionPayload enum (NEAR 2.13).
 *
 * Borsh discriminant 0 = `V2(DelegateActionV2)`. The variant is part of the
 * signed payload, so a signature can't be ambiguous across versions.
 */
const VersionedDelegateActionPayloadSchema = b.enum({
  v2: DelegateActionV2Schema,
})

/**
 * VersionedSignedDelegateAction struct (NEAR 2.13).
 *
 * The payload carried by `Action::DelegateV2`: a versioned delegate-action
 * payload plus its signature.
 */
const VersionedSignedDelegateActionSchema = b.struct({
  delegateAction: VersionedDelegateActionPayloadSchema,
  signature: SignatureSchema,
})

export type NonDelegateActionBorsh = b.infer<typeof NonDelegateActionSchema>
export type DelegateActionV2Borsh = b.infer<typeof DelegateActionV2Schema>
export type VersionedSignedDelegateActionBorsh = b.infer<
  typeof VersionedSignedDelegateActionSchema
>

/**
 * Action enum matching NEAR protocol action discriminants
 * Order matters! Each position corresponds to the action type index:
 * 0 = CreateAccount
 * 1 = DeployContract
 * 2 = FunctionCall
 * 3 = Transfer
 * 4 = Stake
 * 5 = AddKey
 * 6 = DeleteKey
 * 7 = DeleteAccount
 * 8 = SignedDelegate
 * 9 = DeployGlobalContract
 * 10 = UseGlobalContract
 * 11 = DeterministicStateInit (NEP-616)
 * 12 = TransferToGasKey (protocol v85 / NEAR 2.13)
 * 13 = WithdrawFromGasKey (protocol v85 / NEAR 2.13)
 * 14 = DelegateV2 (protocol v85 / NEAR 2.13)
 */
export const ActionSchema = b.enum({
  createAccount: CreateAccountSchema,
  deployContract: DeployContractSchema,
  functionCall: FunctionCallSchema,
  transfer: TransferSchema,
  stake: StakeSchema,
  addKey: AddKeySchema,
  deleteKey: DeleteKeySchema,
  deleteAccount: DeleteAccountSchema,
  signedDelegate: SignedDelegateSchema,
  deployGlobalContract: DeployGlobalContractSchema,
  useGlobalContract: UseGlobalContractSchema,
  deterministicStateInit: DeterministicStateInitSchema,
  transferToGasKey: TransferToGasKeySchema,
  withdrawFromGasKey: WithdrawFromGasKeySchema,
  delegateV2: VersionedSignedDelegateActionSchema,
})

/**
 * Action type inferred from the Borsh schema
 * This is the single source of truth for action types
 */
export type Action = b.infer<typeof ActionSchema>

// Export individual action types for use in helper function signatures
export type TransferAction = { transfer: b.infer<typeof TransferSchema> }
export type FunctionCallAction = {
  functionCall: b.infer<typeof FunctionCallSchema>
}
export type CreateAccountAction = {
  createAccount: b.infer<typeof CreateAccountSchema>
}
export type DeleteAccountAction = {
  deleteAccount: b.infer<typeof DeleteAccountSchema>
}
export type DeployContractAction = {
  deployContract: b.infer<typeof DeployContractSchema>
}
export type StakeAction = { stake: b.infer<typeof StakeSchema> }
export type AddKeyAction = { addKey: b.infer<typeof AddKeySchema> }
export type DeleteKeyAction = { deleteKey: b.infer<typeof DeleteKeySchema> }
export type DeployGlobalContractAction = {
  deployGlobalContract: b.infer<typeof DeployGlobalContractSchema>
}
export type UseGlobalContractAction = {
  useGlobalContract: b.infer<typeof UseGlobalContractSchema>
}
export type SignedDelegateAction = {
  signedDelegate: b.infer<typeof SignedDelegateSchema>
}
export type DeterministicStateInitAction = {
  deterministicStateInit: b.infer<typeof DeterministicStateInitSchema>
}
export type TransferToGasKeyAction = {
  transferToGasKey: b.infer<typeof TransferToGasKeySchema>
}
export type WithdrawFromGasKeyAction = {
  withdrawFromGasKey: b.infer<typeof WithdrawFromGasKeySchema>
}
export type DelegateV2Action = {
  delegateV2: b.infer<typeof VersionedSignedDelegateActionSchema>
}

// Export StateInit types for NEP-616
export type StateInit = b.infer<typeof DeterministicAccountStateInitSchema>
export type StateInitV1 = b.infer<typeof DeterministicAccountStateInitV1Schema>
export {
  DeterministicAccountStateInitSchema,
  DeterministicAccountStateInitV1Schema,
}

// ==================== Transaction ====================

/**
 * Transaction schema
 * Field order: signerId, publicKey, nonce, receiverId, blockHash, actions
 */
export const TransactionSchema = b.struct({
  signerId: b.string(),
  publicKey: PublicKeySchema,
  nonce: b.u64(),
  receiverId: b.string(),
  blockHash: b.array(b.u8(), 32),
  actions: b.vec(ActionSchema),
})

/**
 * SignedTransaction schema
 */
export const SignedTransactionSchema = b.struct({
  transaction: TransactionSchema,
  signature: SignatureSchema,
})

// ==================== Transaction V1 (gas keys / strict nonce, NEAR 2.13) ====================

/**
 * Tag byte prepended to a V1 transaction on the wire.
 *
 * NEAR 2.13 makes `Transaction` a versioned enum but keeps custom borsh for
 * backward compatibility: a V0 transaction is serialized TAG-LESS (exactly the
 * legacy unversioned struct), while a V1 transaction is serialized as
 * `[0x01] ++ borsh(TransactionV1)`. The deserializer distinguishes them by the
 * second byte (the high byte of the leading AccountId length, always 0 for V0).
 * @internal
 */
const TRANSACTION_V1_TAG = 1

/**
 * TransactionV1 schema (NEAR 2.13).
 *
 * Same shape as V0 but the `nonce` is a {@link TransactionNonceSchema} and a
 * trailing `nonceMode` is appended. Field order matches nearcore `TransactionV1`:
 * signer_id, public_key, nonce, receiver_id, block_hash, actions, nonce_mode.
 *
 * This serializes the struct ALONE (no version tag); use
 * {@link serializeTransactionV1} to get the tagged wire bytes.
 */
export const TransactionV1Schema = b.struct({
  signerId: b.string(),
  publicKey: PublicKeySchema,
  nonce: TransactionNonceSchema,
  receiverId: b.string(),
  blockHash: b.array(b.u8(), 32),
  actions: b.vec(ActionSchema),
  nonceMode: NonceModeSchema,
})

export type TransactionNonceBorsh = b.infer<typeof TransactionNonceSchema>
export type NonceModeBorsh = b.infer<typeof NonceModeSchema>

// ==================== Serialization Helpers ====================

/**
 * Convert DelegateAction to zorsh-compatible format
 */
function delegateActionToZorsh(delegateAction: DelegateAction) {
  return {
    senderId: delegateAction.senderId,
    receiverId: delegateAction.receiverId,
    actions: delegateAction.actions,
    nonce: delegateAction.nonce,
    maxBlockHeight: delegateAction.maxBlockHeight,
    publicKey: publicKeyToZorsh(delegateAction.publicKey),
  }
}

/**
 * Convert our PublicKey type to zorsh-compatible format.
 *
 * @internal Exported for use in action helpers only.
 */
export function publicKeyToZorsh(pk: Ed25519PublicKey): {
  ed25519Key: { data: number[] }
}
export function publicKeyToZorsh(pk: Secp256k1PublicKey): {
  secp256k1Key: { data: number[] }
}
export function publicKeyToZorsh(pk: MlDsa65PublicKey): {
  mlDsa65Key: { data: number[] }
}
export function publicKeyToZorsh(
  pk: PublicKey,
):
  | { ed25519Key: { data: number[] } }
  | { secp256k1Key: { data: number[] } }
  | { mlDsa65Key: { data: number[] } }
export function publicKeyToZorsh(pk: PublicKey) {
  switch (pk.keyType) {
    case KeyType.ED25519:
      return { ed25519Key: { data: Array.from(pk.data) } }
    case KeyType.SECP256K1:
      return { secp256k1Key: { data: Array.from(pk.data) } }
    case KeyType.ML_DSA_65:
      return { mlDsa65Key: { data: Array.from(pk.data) } }
    default:
      throw new InvalidKeyError(
        `Unsupported key type: ${(pk as PublicKey).keyType}`,
      )
  }
}

/**
 * Convert our Signature type to zorsh-compatible format.
 *
 * @internal Exported for use in action helpers only.
 */
export function signatureToZorsh(sig: Ed25519Signature): {
  ed25519Signature: { data: number[] }
}
export function signatureToZorsh(sig: Secp256k1Signature): {
  secp256k1Signature: { data: number[] }
}
export function signatureToZorsh(sig: MlDsa65Signature): {
  mlDsa65Signature: { data: number[] }
}
export function signatureToZorsh(
  sig: Signature,
):
  | { ed25519Signature: { data: number[] } }
  | { secp256k1Signature: { data: number[] } }
  | { mlDsa65Signature: { data: number[] } }
export function signatureToZorsh(sig: Signature) {
  switch (sig.keyType) {
    case KeyType.ED25519:
      return { ed25519Signature: { data: Array.from(sig.data) } }
    case KeyType.SECP256K1:
      return { secp256k1Signature: { data: Array.from(sig.data) } }
    case KeyType.ML_DSA_65:
      return { mlDsa65Signature: { data: Array.from(sig.data) } }
    default:
      throw new InvalidKeyError(
        `Unsupported key type: ${(sig as Signature).keyType}`,
      )
  }
}

/**
 * Identity passthrough for a transaction action.
 *
 * Action helpers already return zorsh-compatible shapes, and a signed delegate's
 * nested actions cannot themselves be delegate actions, so no conversion is
 * needed here. Retained as the `tx.actions.map(...)` hook in case per-action
 * normalization is ever required again.
 */
function actionToZorsh(action: Action): Action {
  // A signed delegate's nested actions are already in zorsh-compatible form (the
  // action factories produce them) and cannot themselves be delegate actions, so
  // they pass through unchanged. Returning the action as-is keeps the outer
  // delegate intact without re-walking the (differently-typed) ClassicAction set.
  return action
}

/**
 * Serialize a transaction to bytes
 */
export function serializeTransaction(tx: Transaction): Uint8Array {
  return TransactionSchema.serialize({
    signerId: tx.signerId,
    publicKey: publicKeyToZorsh(tx.publicKey),
    nonce: tx.nonce,
    receiverId: tx.receiverId,
    blockHash: Array.from(tx.blockHash),
    actions: tx.actions.map(actionToZorsh),
  })
}

/**
 * Serialize a signed transaction to bytes
 */
export function serializeSignedTransaction(
  signedTx: SignedTransaction,
): Uint8Array {
  return SignedTransactionSchema.serialize({
    transaction: {
      signerId: signedTx.transaction.signerId,
      publicKey: publicKeyToZorsh(signedTx.transaction.publicKey),
      nonce: signedTx.transaction.nonce,
      receiverId: signedTx.transaction.receiverId,
      blockHash: Array.from(signedTx.transaction.blockHash),
      actions: signedTx.transaction.actions.map(actionToZorsh),
    },
    signature: signatureToZorsh(signedTx.signature),
  })
}

// ==================== Transaction V1 Serialization (NEAR 2.13) ====================

/**
 * The V1 fields of a transaction, mirroring nearcore `TransactionV1`.
 *
 * `nonce` is a {@link TransactionNonceBorsh} (carries a nonce index for gas
 * keys) and `nonceMode` controls validation. The remaining fields match the
 * ordinary {@link Transaction}.
 */
export interface TransactionV1 {
  signerId: string
  publicKey: PublicKey
  nonce: TransactionNonceBorsh
  receiverId: string
  blockHash: Uint8Array
  actions: Action[]
  nonceMode: NonceModeBorsh
}

/**
 * Prepend the V1 version tag to already-serialized V1 struct bytes.
 * @internal
 */
function withV1Tag(structBytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(structBytes.length + 1)
  out[0] = TRANSACTION_V1_TAG
  out.set(structBytes, 1)
  return out
}

/**
 * Serialize a V1 transaction to wire bytes (`[0x01] ++ borsh(TransactionV1)`).
 *
 * Use this for the signing payload of a gas-key or strict-nonce transaction. A
 * V0 transaction stays tag-less via {@link serializeTransaction}; never write a
 * `0x00` tag for V0 (that would break backward compatibility).
 */
export function serializeTransactionV1(tx: TransactionV1): Uint8Array {
  const struct = TransactionV1Schema.serialize({
    signerId: tx.signerId,
    publicKey: publicKeyToZorsh(tx.publicKey),
    nonce: tx.nonce,
    receiverId: tx.receiverId,
    blockHash: Array.from(tx.blockHash),
    actions: tx.actions.map(actionToZorsh),
    nonceMode: tx.nonceMode,
  })
  return withV1Tag(struct)
}

/**
 * Serialize a signed V1 transaction to wire bytes.
 *
 * The encoding is `[0x01] ++ borsh(TransactionV1) ++ borsh(Signature)`: the
 * version tag belongs to the inner `Transaction`, and the signature follows the
 * (tagged) transaction, matching nearcore's `SignedTransaction` borsh.
 */
export function serializeSignedTransactionV1(
  tx: TransactionV1,
  signature: Signature,
): Uint8Array {
  const txBytes = serializeTransactionV1(tx)
  const sigBytes = SignatureSchema.serialize(signatureToZorsh(signature))
  const out = new Uint8Array(txBytes.length + sigBytes.length)
  out.set(txBytes, 0)
  out.set(sigBytes, txBytes.length)
  return out
}

// ==================== Delegate Action Serialization ====================

/**
 * Serialize a delegate action for signing
 *
 * Per NEP-461, this prepends a u32 prefix (2^30 + 366) before the delegate action,
 * ensuring signed delegate actions are never identical to signed transactions.
 *
 * Use this to serialize a DelegateAction before signing. The resulting bytes are hashed
 * and signed to create the signature, which is then combined with the DelegateAction
 * using the `signedDelegate()` helper to create a SignedDelegateAction.
 *
 * @param delegateAction - The delegate action to serialize
 * @returns Uint8Array - The prefixed and serialized delegate action
 *
 * @example
 * ```typescript
 * const encoded = serializeDelegateAction(delegateAction)
 * const hash = await crypto.subtle.digest("SHA-256", encoded)
 * const signature = await signer.sign(new Uint8Array(hash))
 * ```
 */
export function serializeDelegateAction(
  delegateAction: DelegateAction,
): Uint8Array {
  const prefixBytes = b.u32().serialize(DELEGATE_ACTION_PREFIX)
  const delegateBytes = DelegateActionSchema.serialize(
    delegateActionToZorsh(delegateAction),
  )

  const result = new Uint8Array(prefixBytes.length + delegateBytes.length)
  result.set(prefixBytes, 0)
  result.set(delegateBytes, prefixBytes.length)

  return result
}

/**
 * Serialize a V2 delegate action for signing (NEP-611 / NEAR 2.13).
 *
 * Prepends the DISTINCT V2 domain tag ({@link DELEGATE_ACTION_V2_PREFIX}) and
 * wraps the action in the versioned payload enum (`V2` => `[0x00]`), exactly as
 * nearcore's `VersionedDelegateActionPayload::get_nep461_hash` does. The result
 * is hashed (SHA-256) and signed.
 *
 * @param delegateAction - The V2 delegate action in Borsh-ready form (its
 *   `publicKey` already converted via {@link publicKeyToZorsh}).
 */
export function serializeDelegateActionV2(
  delegateAction: DelegateActionV2Borsh,
): Uint8Array {
  const prefixBytes = b.u32().serialize(DELEGATE_ACTION_V2_PREFIX)
  // The signed payload is the *versioned payload enum*, so the V2 variant tag
  // (0x00) is part of the bytes.
  const payloadBytes = VersionedDelegateActionPayloadSchema.serialize({
    v2: delegateAction,
  })

  const result = new Uint8Array(prefixBytes.length + payloadBytes.length)
  result.set(prefixBytes, 0)
  result.set(payloadBytes, prefixBytes.length)

  return result
}

export type DelegateActionPayloadFormat = "base64" | "bytes"

type DelegatePayloadReturn<F extends DelegateActionPayloadFormat> =
  F extends "bytes" ? Uint8Array : string

function signedDelegateActionToBytes(
  signedDelegate: SignedDelegateAction,
): Uint8Array {
  return SignedDelegateSchema.serialize(signedDelegate.signedDelegate)
}

/**
 * Encode a SignedDelegateAction for transport.
 *
 * - Default output is a base64 string that can be sent via JSON/HTTP.
 * - Pass `"bytes"` to receive a raw Uint8Array (useful for binary transports).
 */
export function encodeSignedDelegateAction(
  signedDelegate: SignedDelegateAction,
): string
export function encodeSignedDelegateAction<
  F extends DelegateActionPayloadFormat,
>(signedDelegate: SignedDelegateAction, format: F): DelegatePayloadReturn<F>
export function encodeSignedDelegateAction(
  signedDelegate: SignedDelegateAction,
  format: DelegateActionPayloadFormat = "base64",
): string | Uint8Array {
  const serialized = signedDelegateActionToBytes(signedDelegate)
  return format === "base64" ? base64.encode(serialized) : serialized
}

/**
 * Decode an encoded payload (base64 string or bytes) back into the
 * SignedDelegateAction that `.delegate()` returns.
 */
export function decodeSignedDelegateAction(
  payload: string | Uint8Array,
): SignedDelegateAction {
  const bytes = typeof payload === "string" ? base64.decode(payload) : payload
  return {
    signedDelegate: SignedDelegateSchema.deserialize(bytes),
  }
}

/**
 * Encode a V2 signed delegate action ({@link DelegateV2Action}) for transport.
 *
 * - Default output is a base64 string that can be sent via JSON/HTTP.
 * - Pass `"bytes"` to receive a raw Uint8Array.
 */
export function encodeSignedDelegateActionV2(
  signedDelegate: DelegateV2Action,
): string
export function encodeSignedDelegateActionV2<
  F extends DelegateActionPayloadFormat,
>(signedDelegate: DelegateV2Action, format: F): DelegatePayloadReturn<F>
export function encodeSignedDelegateActionV2(
  signedDelegate: DelegateV2Action,
  format: DelegateActionPayloadFormat = "base64",
): string | Uint8Array {
  const serialized = VersionedSignedDelegateActionSchema.serialize(
    signedDelegate.delegateV2,
  )
  return format === "base64" ? base64.encode(serialized) : serialized
}

/**
 * Decode an encoded V2 payload (base64 string or bytes) back into a
 * {@link DelegateV2Action}.
 */
export function decodeSignedDelegateActionV2(
  payload: string | Uint8Array,
): DelegateV2Action {
  const bytes = typeof payload === "string" ? base64.decode(payload) : payload
  return {
    delegateV2: VersionedSignedDelegateActionSchema.deserialize(bytes),
  }
}
