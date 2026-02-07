/**
 * Internal wallet type helpers for near-kit.
 *
 * Defines lightweight structural types for external wallet libraries
 * (e.g. HOT Connect) without taking a hard dependency on their packages.
 *
 * @internal
 */

import type {
  FinalExecutionOutcome,
  SignDelegateActionsResult,
  SignedMessage,
} from "../core/types.js"

/**
 * HOT Connect action types, mirroring `@hot-labs/near-connect`'s
 * `types/transactions.ts` definitions.
 */

export type HotConnectCreateAccountAction = {
  type: "CreateAccount"
}

export type HotConnectDeployContractAction = {
  type: "DeployContract"
  params: {
    code: Uint8Array
  }
}

export type HotConnectFunctionCallAction = {
  type: "FunctionCall"
  params: {
    methodName: string
    args: Record<string, unknown>
    gas: string
    deposit: string
  }
}

export type HotConnectTransferAction = {
  type: "Transfer"
  params: {
    deposit: string
  }
}

export type HotConnectStakeAction = {
  type: "Stake"
  params: {
    stake: string
    publicKey: string
  }
}

export type HotConnectAddKeyPermission =
  | "FullAccess"
  | {
      receiverId: string
      allowance?: string
      methodNames?: string[]
    }

export type HotConnectAddKeyAction = {
  type: "AddKey"
  params: {
    publicKey: string
    accessKey: {
      nonce?: number
      permission: HotConnectAddKeyPermission
    }
  }
}

export type HotConnectDeleteKeyAction = {
  type: "DeleteKey"
  params: {
    publicKey: string
  }
}

export type HotConnectDeleteAccountAction = {
  type: "DeleteAccount"
  params: {
    beneficiaryId: string
  }
}

export type HotConnectAction =
  | HotConnectCreateAccountAction
  | HotConnectDeployContractAction
  | HotConnectFunctionCallAction
  | HotConnectTransferAction
  | HotConnectStakeAction
  | HotConnectAddKeyAction
  | HotConnectDeleteKeyAction
  | HotConnectDeleteAccountAction

/**
 * HOT Connect wallet + connector interfaces (structural).
 */

/**
 * HOT Connect's params for signDelegateActions (v0.9.0+).
 * Uses HotConnectAction[] instead of our Action[].
 * @internal
 */
export type HotConnectSignDelegateActionsParams = {
  network?: string
  signerId?: string
  delegateActions: Array<{
    actions: HotConnectAction[]
    receiverId: string
  }>
}

/**
 * HOT Connect's response for signDelegateActions (v0.9.0+).
 * @internal
 */
export type HotConnectSignDelegateActionsResponse = {
  signedDelegateActions: SignDelegateActionsResult["signedDelegateActions"]
}

export type HotConnectWallet = {
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
    actions: HotConnectAction[]
    network?: string
  }): Promise<FinalExecutionOutcome>
  signMessage(params: {
    message: string
    recipient: string
    nonce: Uint8Array
    network?: string
  }): Promise<SignedMessage>
  signDelegateActions?(
    params: HotConnectSignDelegateActionsParams,
  ): Promise<HotConnectSignDelegateActionsResponse>
}

export type HotConnectConnector = {
  wallet(): Promise<HotConnectWallet>
}
