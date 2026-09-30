/* oxlint-disable effecttsgo/unstable-api-usage -- Uses the matching pinned Effect 4 FetchHttpClient platform layer. */
/** NEAR Sandbox: the simple Promise API over scope-owned native resources. */
import { NodeServices } from "@effect/platform-node"
import { ConfigProvider, Effect, Exit, Layer, Scope } from "effect"
import { FetchHttpClient } from "effect/http"
import { makeSandbox, type SandboxService } from "../effect/sandbox.js"
import { runPromise } from "../effect/runtime.js"
import type { SandboxOptions, StateRecord, StateSnapshot } from "./types.js"

export { getPlatformId } from "./platform.js"
export { EMPTY_CODE_HASH } from "./types.js"
export type { SandboxOptions, StateRecord, StateSnapshot } from "./types.js"

const platform = Layer.merge(NodeServices.layer, FetchHttpClient.layer)

/**
 * A local NEAR node. Call stop() to release its process and temporary files.
 * Effect applications can use the scoped Sandbox layer instead.
 */
export class Sandbox {
  readonly rpcUrl: string
  readonly networkId: string
  readonly rootAccount: { id: string; secretKey: string }

  private constructor(
    private readonly service: SandboxService,
    private readonly scope: Scope.Closeable,
  ) {
    this.rpcUrl = service.rpcUrl
    this.networkId = service.networkId
    this.rootAccount = service.rootAccount
  }

  static start(options: SandboxOptions = {}): Promise<Sandbox> {
    return runPromise(
      Effect.gen(function* () {
        const scope = yield* Scope.make()
        const service = yield* makeSandbox(options).pipe(
          Effect.provide(platform),
          Effect.provideService(
            ConfigProvider.ConfigProvider,
            ConfigProvider.fromEnv(),
          ),
          Scope.provide(scope),
          Effect.onExit((exit) =>
            Exit.isFailure(exit) ? Scope.close(scope, exit) : Effect.void,
          ),
        )
        return new Sandbox(service, scope)
      }),
    )
  }

  stop(): Promise<void> {
    return runPromise(Scope.close(this.scope, Exit.void))
  }
  patchState(records: StateRecord[]): Promise<void> {
    return runPromise(this.service.patchState(records))
  }
  fastForward(numBlocks: number): Promise<void> {
    return runPromise(this.service.fastForward(numBlocks))
  }
  dumpState(): Promise<StateSnapshot> {
    return runPromise(this.service.dumpState())
  }
  restoreState(snapshot: StateSnapshot): Promise<void> {
    return runPromise(this.service.restoreState(snapshot))
  }
  saveSnapshot(): Promise<string> {
    return runPromise(this.service.saveSnapshot())
  }
  loadSnapshot(snapshotPath: string): Promise<StateSnapshot> {
    return runPromise(this.service.loadSnapshot(snapshotPath))
  }
  restart(snapshot?: StateSnapshot): Promise<void> {
    return runPromise(this.service.restart(snapshot))
  }
}
