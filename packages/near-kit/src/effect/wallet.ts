import type * as Effect from "effect/Effect"
import * as Context from "effect/Context"
import * as Layer from "effect/Layer"
import type { WalletConnection } from "../core/types.js"
import { fromPromise, runPromise, type ExternalError } from "./runtime.js"

type NativeMethod<F> = F extends (...args: infer A) => Promise<infer R>
  ? (...args: A) => Effect.Effect<R, ExternalError>
  : never

export interface WalletService {
  readonly getAccounts: NativeMethod<WalletConnection["getAccounts"]>
  readonly signAndSendTransaction: NativeMethod<
    WalletConnection["signAndSendTransaction"]
  >
  readonly signMessage?: NativeMethod<
    NonNullable<WalletConnection["signMessage"]>
  >
  readonly signDelegateActions?: NativeMethod<
    NonNullable<WalletConnection["signDelegateActions"]>
  >
}

const nativeWallet = Symbol.for("near-kit/NativeWallet")
type NativeConnection = WalletConnection & {
  [nativeWallet]?: {
    readonly effects: WalletService
    readonly methods: WalletConnection
  }
}

/** Preserve the Promise connector shape while retaining native programs. */
export const walletConnection = (effects: WalletService): WalletConnection => {
  const connection: NativeConnection = {
    getAccounts: () => runPromise(effects.getAccounts()),
    signAndSendTransaction: (params) =>
      runPromise(effects.signAndSendTransaction(params)),
    ...(effects.signMessage
      ? {
          signMessage: (
            params: Parameters<NonNullable<WalletConnection["signMessage"]>>[0],
          ) => runPromise(effects.signMessage!(params)),
        }
      : {}),
    ...(effects.signDelegateActions
      ? {
          signDelegateActions: (
            params: Parameters<
              NonNullable<WalletConnection["signDelegateActions"]>
            >[0],
          ) => runPromise(effects.signDelegateActions!(params)),
        }
      : {}),
  }
  Object.defineProperty(connection, nativeWallet, {
    value: { effects, methods: { ...connection } },
  })
  return connection
}

/** Application overrides are extension boundaries; built-in adapters stay native. */
export const walletService = (connection: WalletConnection): WalletService => {
  const native = (connection as NativeConnection)[nativeWallet]
  return {
    getAccounts:
      native && connection.getAccounts === native.methods.getAccounts
        ? native.effects.getAccounts
        : () =>
            fromPromise(() => connection.getAccounts(), "wallet.getAccounts"),
    signAndSendTransaction:
      native &&
      connection.signAndSendTransaction ===
        native.methods.signAndSendTransaction
        ? native.effects.signAndSendTransaction
        : (params) =>
            fromPromise(
              () => connection.signAndSendTransaction(params),
              "wallet.signAndSendTransaction",
            ),
    ...(connection.signMessage
      ? {
          signMessage:
            native && connection.signMessage === native.methods.signMessage
              ? native.effects.signMessage!
              : (
                  params: Parameters<
                    NonNullable<WalletConnection["signMessage"]>
                  >[0],
                ) =>
                  fromPromise(
                    () => connection.signMessage!(params),
                    "wallet.signMessage",
                  ),
        }
      : {}),
    ...(connection.signDelegateActions
      ? {
          signDelegateActions:
            native &&
            connection.signDelegateActions ===
              native.methods.signDelegateActions
              ? native.effects.signDelegateActions!
              : (
                  params: Parameters<
                    NonNullable<WalletConnection["signDelegateActions"]>
                  >[0],
                ) =>
                  fromPromise(
                    () => connection.signDelegateActions!(params),
                    "wallet.signDelegateActions",
                  ),
        }
      : {}),
  }
}

export class Wallet extends Context.Service<Wallet, WalletService>()(
  "near-kit/Wallet",
) {
  static layer = (connection: WalletConnection): Layer.Layer<Wallet> =>
    Layer.succeed(Wallet, walletService(connection))
}
