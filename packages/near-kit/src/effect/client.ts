/** Application-owned client lifetime. Operations stay in the caller's fiber. */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import type { NearConfig } from "../core/config-schemas.js"
import { KeyStore, type KeyStoreService } from "./keys.js"
import { Near, bindClient, resolveClient, type NearRuntime } from "./near.js"
import { NonceReservation, type NonceReservationService } from "./nonce.js"
import { Rpc } from "./rpc.js"
import type { RpcPrograms } from "../core/rpc/rpc-program.js"
import { ExternalError, fromSync, type NearFailure } from "./runtime.js"
import type { TransactionSigner } from "./transaction.js"
import {
  acquireWalletAccounts,
  type WalletAccountObservation,
  type WalletAccountState,
  type WalletService,
} from "./wallet.js"

/** Custody is an application dependency, never an ambient default. */
export class Signer
  extends /* @__PURE__ */ Context.Service<Signer, TransactionSigner>()(
    "near-kit/Signer",
  ) {}

export interface ClientRuntime extends NearRuntime {
  readonly rpc: RpcPrograms
  readonly keyStore: KeyStoreService
  readonly nonceReservation: NonceReservationService
}

export interface ClientValue extends ReturnType<typeof bindClient> {
  readonly _tag: "NearClient"
  readonly walletAccounts?: WalletAccountObservation
}

/** Acquire once inside the scope which owns the supplied capability layers. */
export const acquire = /* @__PURE__ */ Effect.fn("Client.acquire")(function* (
  config: NearConfig,
  runtime: ClientRuntime,
): Effect.fn.Return<ClientValue, NearFailure, Scope.Scope> {
  const resolved = yield* resolveClient(config, runtime)
  const wallet = resolved.dependencies.wallet
  const walletAccounts = wallet?.observeAccounts
    ? yield* acquireWalletAccounts(wallet)
    : undefined
  yield* resolved.ready
  return yield* observedClient(resolved, walletAccounts)
})

const observedClient = /* @__PURE__ */ Effect.fn("Client.bindObservation")(
  function* (
    resolved: Effect.Success<ReturnType<typeof resolveClient>>,
    walletAccounts?: WalletAccountObservation,
  ): Effect.fn.Return<ClientValue, ExternalError> {
    const wallet = resolved.dependencies.wallet
    const ownedWallet: WalletService | undefined =
      wallet && walletAccounts
        ? yield* fromSync(
            () => ({
              signAndSendTransaction:
                wallet.signAndSendTransaction.bind(wallet),
              ...(wallet.signMessage
                ? { signMessage: wallet.signMessage.bind(wallet) }
                : {}),
              ...(wallet.signDelegateActions
                ? {
                    signDelegateActions:
                      wallet.signDelegateActions.bind(wallet),
                  }
                : {}),
              getAccounts: Effect.fn("Client.walletAccounts")(function* () {
                yield* walletAccounts.ready
                const state = yield* walletAccounts.get()
                if (state._tag === "Ready")
                  return state.accounts.map((account) => ({ ...account }))
                if (state._tag === "Failed") return yield* state.error
                return yield* new ExternalError({
                  operation: "wallet.observeAccounts",
                  cause: new Error(
                    "Wallet observation completed readiness without an account result",
                  ),
                })
              }),
            }),
            "Client.wallet",
          )
        : wallet
    const client = bindClient({
      ...resolved,
      dependencies: {
        ...resolved.dependencies,
        ...(ownedWallet ? { wallet: ownedWallet } : {}),
      },
    })
    return {
      _tag: "NearClient",
      ...client,
      ...(walletAccounts ? { walletAccounts } : {}),
    }
  },
)

export interface PreparedClient {
  readonly client: ClientValue
  /** Close the previous activation scope before starting another. */
  readonly activate: Effect.Effect<void, never, Scope.Scope>
}

/**
 * Assemble without I/O. Signing operations own configured-key readiness;
 * activation owns only live account observation and can restart after cleanup.
 */
export const prepareClient = /* @__PURE__ */ Effect.fn("Client.prepare")(
  function* (
    config: NearConfig = {},
    runtime: NearRuntime = {},
  ): Effect.fn.Return<PreparedClient, NearFailure> {
    const resolved = yield* resolveClient(config, runtime)
    const wallet = resolved.dependencies.wallet
    if (!wallet?.observeAccounts) {
      return { client: yield* observedClient(resolved), activate: Effect.void }
    }
    const current = yield* SubscriptionRef.make<
      WalletAccountObservation | WalletAccountState
    >({ _tag: "Loading" })
    const changes = SubscriptionRef.changes(current).pipe(
      Stream.switchMap((value) =>
        "changes" in value ? value.changes : Stream.succeed(value),
      ),
    )
    const get = Effect.fn("Client.preparedAccounts")(function* () {
      const value = yield* SubscriptionRef.get(current)
      return "get" in value ? yield* value.get() : value
    })
    const waitUntilReady = changes.pipe(
      Stream.filter((state) => state._tag !== "Loading"),
      Stream.take(1),
      Stream.runDrain,
    )
    const observation: WalletAccountObservation = {
      get,
      changes,
      ready: get().pipe(
        Effect.flatMap((state) =>
          state._tag === "Loading" ? waitUntilReady : Effect.void,
        ),
      ),
    }
    const activate = Effect.gen(function* () {
      const acquired = yield* acquireWalletAccounts(wallet)
      yield* Effect.acquireRelease(SubscriptionRef.set(current, acquired), () =>
        SubscriptionRef.set(current, {
          _tag: "Failed",
          error: new ExternalError({
            operation: "wallet.observeAccounts",
            cause: new Error("Wallet observation scope closed"),
          }),
        }),
      )
    })
    return {
      client: yield* observedClient(resolved, observation),
      activate,
    }
  },
)

/**
 * One client graph per provided layer. Supply RPC, keys and one nonce allocator
 * shared by every client that signs in the same domain. Optional custody is a
 * typed Effect so signer/wallet layer requirements remain visible to callers.
 */
export class Client
  extends /* @__PURE__ */ Context.Service<Client, ClientValue>()(
    "near-kit/Client",
  )
{
  static layer<E = never, R = never>(
    config: NearConfig = {},
    custody: Effect.Effect<
      Pick<NearRuntime, "signer" | "wallet">,
      E,
      R
    > = Effect.succeed({}),
  ): Layer.Layer<
    Client | Near,
    NearFailure | E,
    Rpc | KeyStore | NonceReservation | R
  > {
    return Layer.effectContext(
      Effect.gen(function* () {
        const authority = yield* custody
        const rpc = yield* Rpc
        const keyStore = yield* KeyStore
        const nonceReservation = yield* NonceReservation
        const client = yield* acquire(config, {
          ...authority,
          rpc,
          keyStore,
          nonceReservation,
        })
        return Context.make(Client, client).pipe(
          Context.add(Near, client.service),
        )
      }),
    )
  }
}
