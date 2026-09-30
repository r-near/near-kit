/** Injectable native RPC services. The Promise client remains an API boundary. */
import { Context, Effect, Layer } from "effect"
import type { RpcRetryConfigInput } from "../core/config-schemas.js"
import { RpcClient, type RpcFetch } from "../core/rpc/rpc.js"

export interface RpcLayerConfig {
  readonly url: string
  readonly headers?: Record<string, string>
  readonly retry?: RpcRetryConfigInput
}

/** The HTTP boundary is explicit so environments can supply their own transport. */
export class RpcTransport extends Context.Service<
  RpcTransport,
  { readonly fetch: RpcFetch }
>()("near-kit/RpcTransport") {
  static layer(fetch: RpcFetch): Layer.Layer<RpcTransport> {
    return Layer.succeed(RpcTransport, RpcTransport.of({ fetch }))
  }

  static readonly layerFetch = RpcTransport.layer((url, init) =>
    globalThis.fetch(url, init),
  )
}

/** Same protocol operations as RpcClient, returning Effects rather than Promises. */
export type RpcService = {
  readonly [K in keyof RpcClient as K extends `${infer Name}Effect`
    ? Name
    : never]: RpcClient[K]
} & {
  readonly client: RpcClient
  readonly viewStateAll: RpcClient["viewStateAllStream"]
}

// oxlint-disable-next-line effecttsgo/lazy-effect -- Uniform operation methods preserve the RpcClient adapter contract and Kit service conventions.
export class Rpc extends Context.Service<Rpc, RpcService>()("near-kit/Rpc") {
  /** Requires an explicitly supplied transport. */
  static layer(config: RpcLayerConfig): Layer.Layer<Rpc, never, RpcTransport> {
    return Layer.effect(
      Rpc,
      Effect.gen(function* () {
        const transport = yield* RpcTransport
        const client = RpcClient.withTransport(
          config.url,
          transport.fetch,
          config.headers,
          config.retry,
        )
        return serviceFromClient(client)
      }),
    )
  }

  /** Use the platform's fetch implementation. */
  static layerFetch(config: RpcLayerConfig): Layer.Layer<Rpc> {
    return Rpc.layer(config).pipe(Layer.provide(RpcTransport.layerFetch))
  }

  /** Reuse an already configured client and its request-id sequence. */
  static layerClient(client: RpcClient): Layer.Layer<Rpc> {
    return Layer.succeed(Rpc, serviceFromClient(client))
  }
}

function serviceFromClient(client: RpcClient): RpcService {
  return Rpc.of({
    client,
    call: client.callEffect.bind(client),
    query: client.queryEffect.bind(client),
    viewFunction: client.viewFunctionEffect.bind(client),
    getAccount: client.getAccountEffect.bind(client),
    viewCode: client.viewCodeEffect.bind(client),
    viewGlobalContractCode: client.viewGlobalContractCodeEffect.bind(client),
    getAccessKey: client.getAccessKeyEffect.bind(client),
    getAccessKeys: client.getAccessKeysEffect.bind(client),
    getGasKeyNonces: client.getGasKeyNoncesEffect.bind(client),
    sendTransaction: client.sendTransactionEffect.bind(client),
    getTransactionStatus: client.getTransactionStatusEffect.bind(client),
    receiptToTx: client.receiptToTxEffect.bind(client),
    getStatus: client.getStatusEffect.bind(client),
    getBlock: client.getBlockEffect.bind(client),
    getGasPrice: client.getGasPriceEffect.bind(client),
    viewState: client.viewStateEffect.bind(client),
    viewStateAll: client.viewStateAllStream.bind(client),
    blockEffects: client.blockEffectsEffect.bind(client),
    genesisConfig: client.genesisConfigEffect.bind(client),
    maintenanceWindows: client.maintenanceWindowsEffect.bind(client),
  })
}
