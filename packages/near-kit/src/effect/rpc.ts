/** Context-owned native RPC service and explicitly selected HTTP transports. */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import {
  HttpBody,
  HttpClient,
  type HttpClientError,
  HttpClientRequest,
} from "effect/http"
import {
  type RpcClient,
  type RpcFetch,
  rpcFromPromises,
  rpcToPromises,
} from "../core/rpc/rpc.js"
import { isRetryableStatus } from "../core/rpc/rpc-error-handler.js"
import {
  fetchTransport,
  makeRpcPrograms,
  type RpcProgramConfig,
  type RpcPrograms,
  type RpcTransportService,
  transportError,
} from "../core/rpc/rpc-program.js"
import { NetworkError } from "../errors/index.js"

export type RpcLayerConfig = RpcProgramConfig

export class RpcTransport extends Context.Service<
  RpcTransport,
  RpcTransportService
>()("near-kit/RpcTransport") {
  /** Exact fetch semantics for existing public clients and custom transports. */
  static layer(fetch: RpcFetch): Layer.Layer<RpcTransport> {
    return Layer.effect(
      RpcTransport,
      Effect.sync(() => RpcTransport.of(fetchTransport(fetch))),
    )
  }

  static readonly layerFetch = RpcTransport.layer((url, init) =>
    globalThis.fetch(url, init),
  )

  /* oxlint-disable effecttsgo/unstable-api-usage -- This opt-in adapter deliberately targets the pinned Effect 4.0.0-rc.118 HTTP stack, covered by scoped lifecycle tests. */
  /** Use an application's Effect HTTP stack, including its middleware and tracing. */
  static readonly layerHttpClient: Layer.Layer<
    RpcTransport,
    never,
    HttpClient.HttpClient
  > = Layer.effect(
    this,
    Effect.gen(function* () {
      const http = HttpClient.withScope(yield* HttpClient.HttpClient)
      return RpcTransport.of({
        execute: Effect.fn("RpcTransport.http")(function* (
          url,
          headers,
          request,
        ) {
          const body = yield* Effect.try({
            try: () => JSON.stringify(request),
            catch: transportError,
          })
          const response = yield* http
            .execute(
              HttpClientRequest.post(url, {
                headers: { "Content-Type": "application/json", ...headers },
              }).pipe(HttpClientRequest.setBody(HttpBody.raw(body))),
            )
            .pipe(Effect.mapError(httpFailure))
          if (response.status < 200 || response.status >= 300) {
            return yield* Effect.fail(
              new NetworkError(
                `HTTP ${response.status}`,
                response.status,
                isRetryableStatus(response.status),
              ),
            )
          }
          const data = yield* response.json.pipe(Effect.mapError(httpFailure))
          return { status: response.status, data }
        }, Effect.scoped),
      })
    }),
  )
  /* oxlint-enable effecttsgo/unstable-api-usage */
}

export interface RpcService extends RpcPrograms {
  /** The same programs exposed at the public Near.rpc Promise boundary. */
  readonly client: RpcClient
}

// oxlint-disable-next-line effecttsgo/lazy-effect -- Uniform operation methods match Kit's explicit service-method convention.
export class Rpc extends Context.Service<Rpc, RpcService>()("near-kit/Rpc") {
  static layer(config: RpcLayerConfig): Layer.Layer<Rpc, never, RpcTransport> {
    return Layer.effect(
      Rpc,
      Effect.gen(function* () {
        const transport = yield* RpcTransport
        const programs = yield* makeRpcPrograms(config, transport)
        return Rpc.of({ ...programs, client: rpcToPromises(programs) })
      }),
    )
  }

  static layerFetch(config: RpcLayerConfig): Layer.Layer<Rpc> {
    return Rpc.layer(config).pipe(Layer.provide(RpcTransport.layerFetch))
  }

  /** Explicit boundary for an existing or caller-supplied Promise RPC provider. */
  static layerClient(client: RpcClient): Layer.Layer<Rpc> {
    return Layer.succeed(Rpc, Rpc.of({ ...rpcFromPromises(client), client }))
  }
}

/* oxlint-disable effecttsgo/unstable-api-usage -- Error mapping belongs to the opt-in pinned HTTP adapter above. */
function httpFailure(
  error: HttpClientError.HttpClientError,
): NetworkError | import("../errors/index.js").NearError {
  if (error.reason._tag === "StatusCodeError") {
    return new NetworkError(
      `HTTP ${error.reason.response.status}`,
      error.reason.response.status,
      isRetryableStatus(error.reason.response.status),
    )
  }
  return transportError("cause" in error.reason ? error.reason.cause : error)
}

/* oxlint-enable effecttsgo/unstable-api-usage */
