import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { ZodError } from "zod"
import type { ContractMethods } from "../contracts/contract.js"
import type { NearConfig } from "../core/config-schemas.js"
import { Near as PromiseNear, type NearRuntime } from "../core/near.js"
import { NearError } from "../errors/index.js"
import { createEffectContract } from "./contract.js"
import { KeyStore, keyStoreConnection } from "./keys.js"
import { NonceReservation } from "./nonce.js"
import { Wallet, walletConnection } from "./wallet.js"
import { Rpc } from "./rpc.js"
import { ExternalError, type NearFailure } from "./runtime.js"
import { transaction } from "./transaction.js"

/** Construct lazily; synchronous configuration failures stay in the error channel. */
export const make = (
  config: NearConfig = {},
  runtime?: NearRuntime,
): Effect.Effect<PromiseNear, NearFailure> =>
  Effect.try({
    try: () =>
      new PromiseNear(config, { ...runtime, deferInitialization: true }),
    catch: (cause) =>
      cause instanceof NearError || cause instanceof ZodError
        ? cause
        : new ExternalError({ operation: "Near.configure", cause }),
  }).pipe(Effect.flatMap((client) => Effect.as(client.ready, client)))

/** The native API shares exactly the same client state and implementation. */
export const fromClient = (client: PromiseNear) => ({
  client,
  getConnectedAccountId: client.effects.getConnectedAccountId,
  rpc: client.rpcEffects,
  view: client.effects.view,
  call: client.effects.call,
  send: client.effects.send,
  signMessage: client.effects.signMessage,
  getBalance: client.effects.getBalance,
  getAccount: client.effects.getAccount,
  accountExists: client.effects.accountExists,
  getAccessKey: client.effects.getAccessKey,
  getAccessKeys: client.effects.getAccessKeys,
  getContractCode: client.effects.getContractCode,
  getGlobalContract: client.effects.getGlobalContract,
  globalContractExists: client.effects.globalContractExists,
  getTransactionStatus: client.effects.getTransactionStatus,
  getStatus: client.effects.getStatus,
  viewState: client.effects.viewState,
  viewStateAll: client.rpcEffects.viewStateAll,
  transaction: (signerId: string) => transaction(client.transaction(signerId)),
  contract: <T extends ContractMethods>(contractId: string) =>
    createEffectContract<T>(client, contractId),
})

export type NearService = ReturnType<typeof fromClient>

/**
 * Injectable NEAR client. Layers are descriptions: each fresh construction owns
 * its client and key-store state, while consumers can share a provided layer.
 */
// oxlint-disable-next-line effecttsgo/lazy-effect -- Kit service operations remain named Effect.fn functions, including zero-argument methods.
export class Near extends Context.Service<Near, NearService>()(
  "near-kit/Near",
) {
  static layer = (config: NearConfig = {}): Layer.Layer<Near, NearFailure> =>
    Layer.effect(
      Near,
      Effect.map(make(config), (client) => Near.of(fromClient(client))),
    )

  static layerFromClient = (client: PromiseNear): Layer.Layer<Near> =>
    Layer.succeed(Near, fromClient(client))

  /** Supply an RPC service to inject a transport without changing application code. */
  static layerWithRpc = (
    config: NearConfig = {},
  ): Layer.Layer<Near, NearFailure, Rpc> =>
    Layer.effect(
      Near,
      Effect.gen(function* () {
        const rpc = yield* Rpc
        const client = yield* make(config, { rpc })
        return fromClient(client)
      }),
    )
  /** Explicit native dependency graph: supplied keys and nonce reservations control signing. */
  static layerWithServices = (
    config: NearConfig = {},
  ): Layer.Layer<Near, NearFailure, Rpc | KeyStore | NonceReservation> =>
    Layer.effect(
      Near,
      Effect.gen(function* () {
        const rpc = yield* Rpc
        const keys = yield* KeyStore
        const nonceReservation = yield* NonceReservation
        const client = yield* make(
          { ...config, keyStore: keyStoreConnection(keys) },
          { rpc, nonceReservation },
        )
        return Near.of(fromClient(client))
      }),
    )

  /** As above, with an explicit native wallet dependency. */
  static layerWithWallet = (
    config: NearConfig = {},
  ): Layer.Layer<
    Near,
    NearFailure,
    Rpc | KeyStore | NonceReservation | Wallet
  > =>
    Layer.effect(
      Near,
      Effect.gen(function* () {
        const rpc = yield* Rpc
        const keys = yield* KeyStore
        const nonceReservation = yield* NonceReservation
        const wallet = yield* Wallet
        const client = yield* make(
          {
            ...config,
            keyStore: keyStoreConnection(keys),
            wallet: walletConnection(wallet),
          },
          { rpc, nonceReservation },
        )
        return Near.of(fromClient(client))
      }),
    )
}

/** Native batching keeps cancellation and requirements in the caller's fiber. */
export const batch = <
  const T extends ReadonlyArray<Effect.Effect<unknown, unknown, unknown>>,
>(
  ...effects: T
) => Effect.all(effects, { concurrency: "unbounded" })
