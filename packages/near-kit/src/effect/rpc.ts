/** Context-owned native RPC service and browser-safe fetch transport. */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type { RpcFetch } from "../core/rpc/rpc.js"
import {
  fetchTransport,
  makeRpcPrograms,
  type RpcProgramConfig,
  type RpcPrograms,
  type RpcTransportService,
} from "../core/rpc/rpc-program.js"

export type RpcLayerConfig = RpcProgramConfig

export class RpcTransport extends Context.Service<
  RpcTransport,
  RpcTransportService
>()("near-kit/RpcTransport") {
  /** Exact fetch semantics for existing public clients and custom transports. */
  static layer(fetch: RpcFetch): Layer.Layer<RpcTransport> {
    return Layer.succeed(RpcTransport, fetchTransport(fetch))
  }

  static readonly layerFetch = RpcTransport.layer((url, init) =>
    globalThis.fetch(url, init),
  )
}

// oxlint-disable-next-line effecttsgo/lazy-effect -- Uniform operation methods match Kit's explicit service-method convention.
export class Rpc extends Context.Service<Rpc, RpcPrograms>()("near-kit/Rpc") {
  static layer(config: RpcLayerConfig): Layer.Layer<Rpc, never, RpcTransport> {
    return Layer.effect(
      Rpc,
      Effect.flatMap(RpcTransport, (transport) =>
        makeRpcPrograms(config, transport),
      ),
    )
  }

  static layerFetch(config: RpcLayerConfig): Layer.Layer<Rpc> {
    return Rpc.layer(config).pipe(Layer.provide(RpcTransport.layerFetch))
  }
}
