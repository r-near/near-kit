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
  readonly [nativeWallet]?: WalletService
}

/** Project native operations into the documented Promise connection shape. */
export const walletConnection = (effects: WalletService): WalletConnection => {
  const { signMessage, signDelegateActions } = effects
  const connection: WalletConnection = {
    getAccounts: () => runPromise(effects.getAccounts()),
    signAndSendTransaction: (params) =>
      runPromise(effects.signAndSendTransaction(params)),
    ...(signMessage
      ? {
          signMessage: (params: Parameters<typeof signMessage>[0]) =>
            runPromise(signMessage.call(effects, params)),
        }
      : {}),
    ...(signDelegateActions
      ? {
          signDelegateActions: (
            params: Parameters<typeof signDelegateActions>[0],
          ) => runPromise(signDelegateActions.call(effects, params)),
        }
      : {}),
  }
  Object.defineProperty(connection, nativeWallet, { value: effects })
  return connection
}

/** The sole boundary for structural application-provided Promise wallets. */
export const walletService = (connection: NativeConnection): WalletService => {
  const native = connection[nativeWallet]
  if (native) return native
  const signMessage = connection.signMessage?.bind(connection)
  const signDelegateActions = connection.signDelegateActions?.bind(connection)
  return Wallet.of({
    getAccounts: () =>
      fromPromise(() => connection.getAccounts(), "wallet.getAccounts"),
    signAndSendTransaction: (params) =>
      fromPromise(
        () => connection.signAndSendTransaction(params),
        "wallet.signAndSendTransaction",
      ),
    ...(signMessage
      ? {
          signMessage: (params: Parameters<typeof signMessage>[0]) =>
            fromPromise(() => signMessage(params), "wallet.signMessage"),
        }
      : {}),
    ...(signDelegateActions
      ? {
          signDelegateActions: (
            params: Parameters<typeof signDelegateActions>[0],
          ) =>
            fromPromise(
              () => signDelegateActions(params),
              "wallet.signDelegateActions",
            ),
        }
      : {}),
  })
}

export class Wallet extends Context.Service<Wallet, WalletService>()(
  "near-kit/Wallet",
) {
  static layer = (connection: WalletConnection): Layer.Layer<Wallet> =>
    Layer.succeed(Wallet, walletService(connection))
}
