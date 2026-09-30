/** Optional integration with an application's Effect HTTP stack. */
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as HttpBody from "effect/http/HttpBody"
import * as HttpClient from "effect/http/HttpClient"
import type * as HttpClientError from "effect/http/HttpClientError"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import { isRetryableStatus } from "../core/rpc/rpc-error-handler.js"
import { transportError } from "../core/rpc/rpc-program.js"
import { NetworkError, type NearError } from "../errors/index.js"
import { RpcTransport } from "./rpc.js"

/* oxlint-disable effecttsgo/unstable-api-usage -- This opt-in adapter deliberately targets the pinned Effect 4.0.0-rc.118 HTTP stack, covered by scoped lifecycle tests. */
/**
 * Use an application's HttpClient, including its middleware and tracing.
 *
 * Provide this layer to Rpc.layer, then provide your HttpClient layer. Each RPC
 * attempt owns its request scope through body consumption and finalization.
 */
export const rpcTransportHttpClient: Layer.Layer<
  RpcTransport,
  never,
  HttpClient.HttpClient
> = Layer.effect(
  RpcTransport,
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

/* oxlint-disable effecttsgo/unstable-api-usage -- Error mapping belongs to the opt-in pinned HTTP adapter above. */
function httpFailure(error: HttpClientError.HttpClientError): NearError {
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
