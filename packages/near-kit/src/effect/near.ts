import * as ConfigProvider from "effect/ConfigProvider"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import type { ContractMethods } from "../contracts/contract.js"
import {
  isKeyStore,
  NearConfigSchema,
  resolveNetworkConfig,
  type NearConfig,
} from "../core/config-schemas.js"
import type { Near as PromiseNear } from "../core/near.js"
import {
  fetchTransport,
  makeRpcPrograms,
  type RpcPrograms,
} from "../core/rpc/rpc-program.js"
import {
  TransactionBuilder,
  type TransactionDependencies,
} from "../core/transaction.js"
import { parseKey } from "../utils/key.js"
import { createEffectContract } from "../contracts/contract.js"
import { makeMemoryStorage } from "./key-storage.js"
import { KeyStore, keyStoreService, type KeyStoreService } from "./keys.js"
import { makeNearPrograms } from "./near-program.js"
import {
  NonceReservation,
  sharedNonceReservation,
  type NonceReservationService,
} from "./nonce.js"
import { Wallet, walletService, type WalletService } from "./wallet.js"
import { Rpc } from "./rpc.js"
import { inputEffect, type NearFailure } from "./runtime.js"
import { transaction } from "./transaction.js"

/** Resolved native capabilities, supplied without Promise conversion. */
export interface NearRuntime {
  readonly rpc?: RpcPrograms
  readonly keyStore?: KeyStoreService
  readonly wallet?: WalletService
  readonly nonceReservation?: NonceReservationService
}

/** Configure once. No asynchronous key write runs until ready is executed. */
export const acquireClient = Effect.fn("Near.acquire")(function* (
  config: NearConfig = {},
  runtime: NearRuntime = {},
) {
  const validated = yield* Schema.decodeUnknownEffect(NearConfigSchema)(config)
  const network = yield* resolveNetworkConfig(validated.network)
  const rpc =
    runtime.rpc ??
    (yield* makeRpcPrograms(
      {
        url: validated.rpcUrl || network.rpcUrl,
        ...(validated.headers ? { headers: validated.headers } : {}),
        ...(validated.retryConfig ? { retry: validated.retryConfig } : {}),
      },
      fetchTransport((url, init) => globalThis.fetch(url, init)),
    ))
  const keyStore =
    runtime.keyStore ??
    (isKeyStore(validated.keyStore)
      ? keyStoreService(validated.keyStore)
      : yield* makeMemoryStorage(validated.keyStore))
  const wallet =
    runtime.wallet ??
    (validated.wallet ? walletService(validated.wallet) : undefined)
  const sandboxRoot = rootAccount(config.network)
  const privateKey = validated.signer
    ? undefined
    : (validated.privateKey ?? sandboxRoot?.secretKey)
  const accountId = validated.privateKey
    ? validated.defaultSignerId || sandboxRoot?.id
    : sandboxRoot?.id
  const key = privateKey
    ? yield* inputEffect(
        () =>
          parseKey(
            typeof privateKey === "string" ? privateKey : privateKey.toString(),
          ),
        "Near.privateKey",
      )
    : undefined
  const ready =
    key && accountId
      ? yield* Effect.cached(keyStore.add(accountId, key))
      : Effect.void
  const dependencies: TransactionDependencies = {
    rpc,
    keyStore,
    ready,
    nonces: runtime.nonceReservation ?? sharedNonceReservation,
    defaultWaitUntil: validated.defaultWaitUntil ?? "EXECUTED_OPTIMISTIC",
    ...(wallet ? { wallet } : {}),
    ...(validated.signer ? { signer: validated.signer } : {}),
  }
  const builder = (id: string) => new TransactionBuilder(id, dependencies)
  const programs = makeNearPrograms({
    rpc,
    keyStore,
    ready,
    wallet,
    defaultSignerId: validated.defaultSignerId || undefined,
    transaction: builder,
  })
  const service = {
    ...programs,
    rpc,
    viewStateAll: rpc.viewStateAll,
    transaction: (id: string) => transaction(builder(id)),
    contract: <T extends ContractMethods>(id: string) =>
      createEffectContract<T>(programs, id),
  }
  return { service, dependencies, ready }
})

/** Sandbox objects carry credentials in addition to the public network fields. */
function rootAccount(
  network: NearConfig["network"],
): { id: string; secretKey?: string } | undefined {
  if (!network || typeof network !== "object" || !("rootAccount" in network))
    return undefined
  const root = network.rootAccount
  if (
    !root ||
    typeof root !== "object" ||
    !("id" in root) ||
    typeof root.id !== "string" ||
    !root.id
  )
    return undefined
  return {
    id: root.id,
    ...("secretKey" in root &&
    typeof root.secretKey === "string" &&
    root.secretKey
      ? { secretKey: root.secretKey }
      : {}),
  }
}

export type NearService = Effect.Success<
  ReturnType<typeof acquireClient>
>["service"]
/** Lazy native acquisition, with configured keys ready before the service is returned. */
export const make = (config: NearConfig = {}, runtime?: NearRuntime) =>
  acquireClient(config, runtime).pipe(
    Effect.flatMap(({ service, ready }) => Effect.as(ready, service)),
  )
/** Reuse the native owner of an existing public client; no reverse adaptation. */
export const fromClient = (client: PromiseNear): NearService => client.effects

const withServices = Effect.fn("Near.acquireServices")(function* (
  config: NearConfig,
  wallet?: WalletService,
) {
  const rpc = yield* Rpc
  const keyStore = yield* KeyStore
  const nonceReservation = yield* NonceReservation
  return yield* make(config, {
    rpc,
    keyStore,
    nonceReservation,
    ...(wallet ? { wallet } : {}),
  })
})

// oxlint-disable-next-line effecttsgo/lazy-effect -- Service operations remain functions; no service acquisition happens per operation.
export class Near extends Context.Service<Near, NearService>()(
  "near-kit/Near",
) {
  static layer = (config: NearConfig = {}): Layer.Layer<Near, NearFailure> =>
    Layer.effect(Near, make(config))
  static layerFromClient = (client: PromiseNear): Layer.Layer<Near> =>
    Layer.succeed(Near, fromClient(client))
  static layerWithRpc = (
    config: NearConfig = {},
  ): Layer.Layer<Near, NearFailure, Rpc> =>
    Layer.effect(
      Near,
      Effect.flatMap(Rpc, (rpc) => make(config, { rpc })),
    )
  static layerWithServices = (
    config: NearConfig = {},
  ): Layer.Layer<Near, NearFailure, Rpc | KeyStore | NonceReservation> =>
    Layer.effect(Near, withServices(config))
  static layerWithWallet = (
    config: NearConfig = {},
  ): Layer.Layer<
    Near,
    NearFailure,
    Rpc | KeyStore | NonceReservation | Wallet
  > =>
    Layer.effect(
      Near,
      Effect.flatMap(Wallet, (wallet) => withServices(config, wallet)),
    )
}

export const batch = <
  const T extends ReadonlyArray<Effect.Effect<unknown, unknown, unknown>>,
>(
  ...effects: T
) => Effect.all(effects, { concurrency: "unbounded" })
/** Public synchronous construction reads current process environment at its boundary. */
export const environment = Layer.sync(ConfigProvider.ConfigProvider, () =>
  ConfigProvider.fromEnv(),
)
