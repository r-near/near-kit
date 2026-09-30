/** Application-owned client lifetime. Operations stay in the caller's fiber. */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type * as Scope from "effect/Scope"
import type { NearConfig } from "../core/config-schemas.js"
import { KeyStore, type KeyStoreService } from "./keys.js"
import { Near, bindClient, resolveClient, type NearRuntime } from "./near.js"
import { NonceReservation, type NonceReservationService } from "./nonce.js"
import { Rpc } from "./rpc.js"
import type { RpcPrograms } from "../core/rpc/rpc-program.js"
import { ExternalError, type NearFailure } from "./runtime.js"
import type { TransactionSigner } from "./transaction.js"
import {
  acquireWalletAccounts,
  type WalletAccountObservation,
} from "./wallet.js"

/** Custody is an application dependency, never an ambient default. */
export class Signer extends Context.Service<Signer, TransactionSigner>()(
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
export const acquire = Effect.fn("Client.acquire")(function* (
  config: NearConfig,
  runtime: ClientRuntime,
): Effect.fn.Return<ClientValue, NearFailure, Scope.Scope> {
  const resolved = yield* resolveClient(config, runtime)
  const wallet = resolved.dependencies.wallet
  const walletAccounts = wallet
    ? yield* acquireWalletAccounts(wallet)
    : undefined
  yield* resolved.ready
  // Observable adapters are read through this one acquired observer. A legacy
  // connection without events keeps its documented fresh getAccounts behavior.
  const ownedWallet =
    wallet?.observeAccounts && walletAccounts
      ? {
          ...wallet,
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
        }
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
})

/**
 * One client graph per provided layer. Supply RPC, keys and one nonce allocator
 * shared by every client that signs in the same domain. Optional custody is a
 * typed Effect so signer/wallet layer requirements remain visible to callers.
 */
export class Client extends Context.Service<Client, ClientValue>()(
  "near-kit/Client",
) {
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
