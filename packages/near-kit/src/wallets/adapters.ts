/**
 * Wallet adapters for NEAR wallet integrations.
 *
 * Provides adapter functions to integrate with popular NEAR wallets:
 * - `@hot-labs/near-connect` (NEAR Connect)
 * - `@near-wallet-selector/core` (deprecated)
 *
 * These adapters use duck typing / structural compatibility to work with
 * wallet interfaces. While the actual wallet packages use `@near-js` types
 * (which are classes), our types (plain objects) are structurally compatible
 * and work correctly at runtime. See `tests/wallets/type-compatibility.test.ts`
 * for verification.
 */

import { sha256 } from "@noble/hashes/sha2.js"
import { base58, base64 } from "@scure/base"
import * as Effect from "effect/Effect"
import { decodeSignedDelegateAction } from "../core/schema.js"
import type {
  Action,
  FinalExecutionOutcome,
  SignedMessage,
  SignMessageParams,
  SignDelegateActionsParams,
  WalletAccount,
  WalletConnection,
} from "../core/types.js"
import { ExternalError, fromPromise, fromSync } from "../effect/runtime.js"
import { walletConnection } from "../effect/wallet.js"
import type {
  NearConnectAction,
  NearConnectAddKeyPermission,
  NearConnectConnector,
} from "./types.js"

// Wallet interface types based on @near-wallet-selector/core v10.x (deprecated).
// These are duck-typed to match the actual wallet interface structure.
// Note: Some wallet-selector implementations type signAndSendTransaction
// as returning `void | FinalExecutionOutcome`. We normalize this to always
// return a FinalExecutionOutcome from our adapter (we throw if the wallet
// returns void) so that the rest of near-kit can rely on a concrete result.
type WalletSelectorWallet = {
  getAccounts(): Promise<Array<{ accountId: string; publicKey?: string }>>
  signAndSendTransaction(params: {
    signerId?: string
    receiverId?: string // Optional in wallet-selector (defaults to contractId)
    actions: unknown[] // We pass our Action[] which is structurally compatible
  }): Promise<unknown> // Runtime result is structurally compatible with our FinalExecutionOutcome
  signMessage?(params: {
    message: string
    recipient: string
    nonce: Buffer // wallet-selector uses Buffer (Node.js), we convert from Uint8Array
    callbackUrl?: string
    state?: string
  }): Promise<unknown> // Many wallets type this as void | SignedMessage
}

// Preserve the adapter's existing forwarding of custom public-key representations.
const walletPublicKey = (key: unknown): string => String(key)

/**
 * Convert a near-kit Action to NEAR Connect's action format.
 * @internal
 */
function convertActionToNearConnect(action: Action): NearConnectAction {
  if ("functionCall" in action && action.functionCall) {
    const { methodName, gas, deposit } = action.functionCall
    let args: unknown = action.functionCall.args
    if (args instanceof Uint8Array) {
      try {
        args = JSON.parse(new TextDecoder().decode(args))
      } catch {
        /* Preserve non-JSON binary arguments, as NEAR Connect does. */
      }
    }
    return {
      type: "FunctionCall",
      params: {
        methodName,
        args: args as Record<string, unknown>,
        gas: gas.toString(),
        deposit: deposit.toString(),
      },
    }
  }
  if ("transfer" in action && action.transfer)
    return {
      type: "Transfer",
      params: { deposit: action.transfer.deposit.toString() },
    }
  if ("stake" in action && action.stake)
    return {
      type: "Stake",
      params: {
        stake: action.stake.stake.toString(),
        publicKey: walletPublicKey(action.stake.publicKey),
      },
    }
  if ("addKey" in action && action.addKey) {
    const { publicKey, accessKey } = action.addKey
    // The public adapter historically forwards the supplied permission shape.
    const permission: unknown = accessKey.permission
    return {
      type: "AddKey",
      params: {
        publicKey: walletPublicKey(publicKey),
        accessKey: {
          nonce: Number(accessKey.nonce),
          permission: permission as NearConnectAddKeyPermission,
        },
      },
    }
  }
  if ("deleteKey" in action && action.deleteKey)
    return {
      type: "DeleteKey",
      params: { publicKey: walletPublicKey(action.deleteKey.publicKey) },
    }
  if ("deleteAccount" in action && action.deleteAccount)
    return {
      type: "DeleteAccount",
      params: { beneficiaryId: action.deleteAccount.beneficiaryId },
    }
  if ("createAccount" in action && action.createAccount !== undefined)
    return { type: "CreateAccount" }
  if ("deployContract" in action && action.deployContract)
    return {
      type: "DeployContract",
      params: { code: action.deployContract.code },
    }

  if ("useGlobalContract" in action) {
    const { contractIdentifier } = action.useGlobalContract
    return {
      type: "UseGlobalContract",
      params: {
        contractIdentifier:
          "AccountId" in contractIdentifier
            ? { accountId: contractIdentifier.AccountId }
            : {
                codeHash: base58.encode(
                  new Uint8Array(contractIdentifier.CodeHash),
                ),
              },
      },
    }
  }

  if ("deployGlobalContract" in action) {
    const { code, deployMode } = action.deployGlobalContract
    return {
      type: "DeployGlobalContract",
      params: {
        code,
        deployMode: "AccountId" in deployMode ? "AccountId" : "CodeHash",
      },
    }
  }

  throw new Error(
    `Unsupported action type: ${Object.keys(action).join(", ") || "unknown"}`,
  )
}

/**
 * Adapter for @near-wallet-selector/core
 *
 * Converts a wallet-selector Wallet instance to the WalletConnection interface.
 *
 * @deprecated NEAR Wallet Selector is deprecated. Use {@link fromNearConnect} with
 * `@hot-labs/near-connect` (NEAR Connect) instead.
 *
 * @param wallet - Wallet instance from wallet-selector
 * @returns WalletConnection interface compatible with near-kit
 *
 * @example
 * ```typescript
 * import { Near } from 'near-kit'
 * import { setupWalletSelector } from '@near-wallet-selector/core'
 * import { fromWalletSelector } from 'near-kit/wallets'
 *
 * const selector = await setupWalletSelector({
 *   network: 'mainnet',
 *   modules: [...]
 * })
 * const wallet = await selector.wallet()
 *
 * const near = new Near({
 *   network: 'mainnet',
 *   wallet: fromWalletSelector(wallet)
 * })
 * ```
 */
export function fromWalletSelector(
  wallet: WalletSelectorWallet,
): WalletConnection {
  return walletConnection({
    getAccounts: () => selectorAccounts(wallet),
    signAndSendTransaction: (params) => selectorTransaction(wallet, params),
    signMessage: (params) => selectorMessage(wallet, params),
  })
}

/**
 * Adapter for @hot-labs/near-connect (NEAR Connect)
 *
 * Converts a NEAR Connect NearConnector instance to the WalletConnection interface.
 *
 * @param connector - NearConnector instance from NEAR Connect
 * @returns WalletConnection interface compatible with near-kit
 *
 * @example
 * ```typescript
 * import { Near } from 'near-kit'
 * import { NearConnector } from '@hot-labs/near-connect'
 * import { fromNearConnect } from 'near-kit/wallets'
 *
 * const connector = new NearConnector({ network: 'mainnet' })
 *
 * // Wait for user to connect their wallet
 * connector.on('wallet:signIn', async () => {
 *   const near = new Near({
 *     network: 'mainnet',
 *     wallet: fromNearConnect(connector)
 *   })
 *
 *   // Use near-kit with the connected wallet
 *   await near.call('contract.near', 'method', { arg: 'value' })
 * })
 * ```
 */
export function fromNearConnect(
  connector: NearConnectConnector,
): WalletConnection {
  // Validate that we have a proper connector
  if (!connector || typeof connector.wallet !== "function") {
    throw new Error(
      "Invalid NEAR Connect instance. Make sure @hot-labs/near-connect is installed and you're passing a NearConnector instance.",
    )
  }

  return walletConnection({
    getAccounts: () => connectAccounts(connector),
    signAndSendTransaction: (params) => connectTransaction(connector, params),
    signMessage: (params) => connectMessage(connector, params),
    signDelegateActions: (params) => connectDelegates(connector, params),
  })
}

/**
 * @deprecated Renamed to {@link fromNearConnect}. This alias will be removed in a future major version.
 */
export const fromHotConnect = fromNearConnect

const walletFailure = (message: string) =>
  Effect.fail(
    new ExternalError({
      operation: "wallet.validate",
      cause: new Error(message),
    }),
  )

// Programs are defined once; adapters bind only their external connector.
type TransactionParams = Parameters<
  WalletConnection["signAndSendTransaction"]
>[0]
const normalizeAccounts = (accounts: WalletAccount[]) =>
  accounts.map(({ accountId, publicKey }) => ({
    accountId,
    ...(publicKey !== undefined ? { publicKey } : {}),
  }))
const selectorAccounts = Effect.fn("WalletSelector.getAccounts")(
  (wallet: WalletSelectorWallet) =>
    fromPromise(() => wallet.getAccounts(), "wallet-selector.getAccounts").pipe(
      Effect.map(normalizeAccounts),
    ),
)
const selectorTransaction = Effect.fn("WalletSelector.signAndSendTransaction")(
  function* (wallet: WalletSelectorWallet, params: TransactionParams) {
    const result = yield* fromPromise(
      () => wallet.signAndSendTransaction(params),
      "wallet-selector.signAndSendTransaction",
    )
    if (!result)
      return yield* walletFailure("Wallet did not return transaction outcome")
    return result as FinalExecutionOutcome
  },
)
const selectorMessage = Effect.fn("WalletSelector.signMessage")(function* (
  wallet: WalletSelectorWallet,
  params: SignMessageParams,
) {
  const signMessage = wallet.signMessage?.bind(wallet)
  if (!signMessage)
    return yield* walletFailure("Wallet does not support message signing")
  const result = yield* fromPromise(
    () =>
      signMessage({
        message: params.message,
        recipient: params.recipient,
        nonce: Buffer.from(params.nonce),
      }),
    "wallet-selector.signMessage",
  )
  if (!result)
    return yield* walletFailure("Wallet did not return signed message")
  return result as SignedMessage
})
const connected = (connector: NearConnectConnector) =>
  fromPromise(() => connector.wallet(), "near-connect.wallet")
const connectAccounts = Effect.fn("NearConnect.getAccounts")(function* (
  connector: NearConnectConnector,
) {
  const wallet = yield* connected(connector)
  return normalizeAccounts(
    yield* fromPromise(() => wallet.getAccounts(), "near-connect.getAccounts"),
  )
})
const connectTransaction = Effect.fn("NearConnect.signAndSendTransaction")(
  function* (connector: NearConnectConnector, params: TransactionParams) {
    const wallet = yield* connected(connector)
    const actions = yield* fromSync(
      () => params.actions.map(convertActionToNearConnect),
      "near-connect.actions",
    )
    return yield* fromPromise(
      () => wallet.signAndSendTransaction({ ...params, actions }),
      "near-connect.signAndSendTransaction",
    )
  },
)
const connectMessage = Effect.fn("NearConnect.signMessage")(function* (
  connector: NearConnectConnector,
  params: SignMessageParams,
) {
  const wallet = yield* connected(connector)
  return yield* fromPromise(
    () =>
      wallet.signMessage({
        message: params.message,
        recipient: params.recipient,
        nonce: params.nonce,
      }),
    "near-connect.signMessage",
  )
})
const connectDelegates = Effect.fn("NearConnect.signDelegateActions")(
  function* (
    connector: NearConnectConnector,
    params: SignDelegateActionsParams,
  ) {
    const wallet = yield* connected(connector)
    if (wallet.manifest.features?.signDelegateActions === false)
      return yield* walletFailure(
        "Connected wallet does not support delegate action signing. " +
          "Make sure you're using a wallet that supports meta-transactions " +
          "and @hot-labs/near-connect v0.9.0 or later.",
      )
    const delegateActions = yield* fromSync(
      () =>
        params.delegateActions.map(({ actions, receiverId }) => ({
          actions: actions.map(convertActionToNearConnect),
          receiverId,
        })),
      "near-connect.actions",
    )
    const response = yield* fromPromise(
      () => wallet.signDelegateActions({ ...params, delegateActions }),
      "near-connect.signDelegateActions",
    )
    return yield* fromSync(
      () => ({
        signedDelegateActions: response.signedDelegateActions.map(
          (encoded) => ({
            delegateHash: sha256(base64.decode(encoded)),
            signedDelegate: decodeSignedDelegateAction(encoded),
          }),
        ),
      }),
      "near-connect.decodeDelegate",
    )
  },
)
