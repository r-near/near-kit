import * as Context from "effect/Context"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Result from "effect/Result"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import type { WalletAccount, WalletConnection } from "../core/types.js"
import { ExternalError, fromPromise, fromSync, runPromise } from "./runtime.js"

type NativeMethod<F> = F extends (...args: infer A) => Promise<infer R>
  ? (...args: A) => Effect.Effect<R, ExternalError>
  : never

export interface WalletService {
  readonly getAccounts: NativeMethod<WalletConnection["getAccounts"]>
  /** Optional live account capability. Its owner must retain the acquired scope. */
  readonly observeAccounts?: () => Effect.Effect<
    WalletAccountObservation,
    never,
    Scope.Scope
  >
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

/** Account observation is independent of client readiness and signing failures. */
export type WalletAccountState =
  | { readonly _tag: "Loading" }
  | {
      readonly _tag: "Ready"
      readonly accounts: ReadonlyArray<Readonly<WalletAccount>>
    }
  | { readonly _tag: "Failed"; readonly error: ExternalError }

export interface WalletAccountObservation {
  // oxlint-disable-next-line effecttsgo/lazy-effect -- Keep named service operations consistent with the native wallet API.
  readonly get: () => Effect.Effect<WalletAccountState>
  readonly changes: Stream.Stream<WalletAccountState>
  /** Completes after the first account result or observation failure. */
  readonly ready: Effect.Effect<void>
}

/** Share a scoped source once; consumers cannot mutate the observed snapshot. */
export const observeAccountStream = /* @__PURE__ */ Effect.fn(
  "Wallet.observeAccountStream",
)(function* (
  source: Stream.Stream<
    Result.Result<ReadonlyArray<WalletAccount>, ExternalError>,
    ExternalError
  >,
) {
  const state = yield* SubscriptionRef.make<WalletAccountState>(
    Object.freeze({ _tag: "Loading" }),
  )
  const ready = yield* Deferred.make<void>()
  const publish = (value: WalletAccountState) =>
    SubscriptionRef.set(state, Object.freeze(value)).pipe(
      Effect.andThen(Deferred.succeed(ready, undefined)),
    )
  const fail = (error: ExternalError) =>
    publish({
      _tag: "Failed",
      error: new ExternalError({
        operation: "wallet.observeAccounts",
        cause: error.cause,
      }),
    })
  yield* source.pipe(
    Stream.runForEach((result) => {
      if (Result.isFailure(result)) return fail(result.failure)
      return fromSync(
        () =>
          Object.freeze(
            result.success.map(({ accountId, publicKey }) =>
              Object.freeze({
                accountId,
                ...(publicKey !== undefined ? { publicKey } : {}),
              }),
            ),
          ),
        "wallet.observeAccounts",
      ).pipe(
        Effect.flatMap((accounts) => publish({ _tag: "Ready", accounts })),
        Effect.catch(fail),
      )
    }),
    Effect.catch(fail),
    Effect.forkScoped,
  )
  return {
    get: Effect.fn("Wallet.accounts.get")(() => SubscriptionRef.get(state)),
    changes: SubscriptionRef.changes(state),
    ready: Deferred.await(ready),
  } satisfies WalletAccountObservation
})

/** Acquire once in a client scope, including a snapshot for legacy wallets. */
export const acquireWalletAccounts = /* @__PURE__ */ Effect.fn(
  "Wallet.acquireAccounts",
)((wallet: WalletService) =>
  wallet.observeAccounts
    ? wallet.observeAccounts()
    : observeAccountStream(
        Stream.fromEffect(Effect.result(wallet.getAccounts())),
      ),
)

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

// oxlint-disable-next-line effecttsgo/lazy-effect -- Operations remain functions; observation acquisition is only executed by the scoped owner.
export class Wallet extends Context.Service<Wallet, WalletService>()(
  "near-kit/Wallet",
) {
  static layer = (connection: WalletConnection): Layer.Layer<Wallet> =>
    Layer.succeed(Wallet, walletService(connection))
}
