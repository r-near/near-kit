/**
 * Internal wallet type helpers for near-kit.
 *
 * Defines lightweight structural types for external wallet libraries
 * (e.g. NEAR Connect) without taking a hard dependency on their packages.
 *
 * @internal
 */

import type {
  FinalExecutionOutcome,
  SignDelegateActionsResult,
  SignedMessage,
} from "../core/types.js"

/**
 * NEAR Connect action types, mirroring `@hot-labs/near-connect`'s
 * `types/transactions.ts` definitions.
 */

export type NearConnectCreateAccountAction = {
  type: "CreateAccount"
}

export type NearConnectDeployContractAction = {
  type: "DeployContract"
  params: {
    code: Uint8Array
  }
}

export type NearConnectFunctionCallAction = {
  type: "FunctionCall"
  params: {
    methodName: string
    args: Record<string, unknown>
    gas: string
    deposit: string
  }
}

export type NearConnectTransferAction = {
  type: "Transfer"
  params: {
    deposit: string
  }
}

export type NearConnectStakeAction = {
  type: "Stake"
  params: {
    stake: string
    publicKey: string
  }
}

export type NearConnectAddKeyPermission =
  | "FullAccess"
  | {
      receiverId: string
      allowance?: string
      methodNames?: string[]
    }

export type NearConnectAddKeyAction = {
  type: "AddKey"
  params: {
    publicKey: string
    accessKey: {
      nonce?: number
      permission: NearConnectAddKeyPermission
    }
  }
}

export type NearConnectDeleteKeyAction = {
  type: "DeleteKey"
  params: {
    publicKey: string
  }
}

export type NearConnectDeleteAccountAction = {
  type: "DeleteAccount"
  params: {
    beneficiaryId: string
  }
}

export type NearConnectAction =
  | NearConnectCreateAccountAction
  | NearConnectDeployContractAction
  | NearConnectFunctionCallAction
  | NearConnectTransferAction
  | NearConnectStakeAction
  | NearConnectAddKeyAction
  | NearConnectDeleteKeyAction
  | NearConnectDeleteAccountAction

/**
 * NEAR Connect wallet + connector interfaces (structural).
 */

/**
 * NEAR Connect's params for signDelegateActions (v0.9.0+).
 * Uses NearConnectAction[] instead of our Action[].
 * @internal
 */
export type NearConnectSignDelegateActionsParams = {
  network?: string
  signerId?: string
  delegateActions: Array<{
    actions: NearConnectAction[]
    receiverId: string
  }>
}

/**
 * NEAR Connect's response for signDelegateActions (v0.9.0+).
 * @internal
 */
export type NearConnectSignDelegateActionsResponse = {
  signedDelegateActions: SignDelegateActionsResult["signedDelegateActions"]
}

export type NearConnectWallet = {
  manifest?: {
    features?: {
      signDelegateAction?: boolean
    }
  }
  getAccounts(data?: { network?: string }): Promise<
    Array<{
      accountId: string
      publicKey: string
    }>
  >
  signAndSendTransaction(params: {
    signerId?: string
    receiverId: string
    actions: NearConnectAction[]
    network?: string
  }): Promise<FinalExecutionOutcome>
  signMessage(params: {
    message: string
    recipient: string
    nonce: Uint8Array
    network?: string
  }): Promise<SignedMessage>
  signDelegateActions?(
    params: NearConnectSignDelegateActionsParams,
  ): Promise<NearConnectSignDelegateActionsResponse>
}

export type NearConnectConnector = {
  wallet(): Promise<NearConnectWallet>
}

/** @deprecated Use {@link NearConnectAction} instead */
export type HotConnectAction = NearConnectAction
/** @deprecated Use {@link NearConnectAddKeyPermission} instead */
export type HotConnectAddKeyPermission = NearConnectAddKeyPermission
/** @deprecated Use {@link NearConnectConnector} instead */
export type HotConnectConnector = NearConnectConnector
