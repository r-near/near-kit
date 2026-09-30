import type * as Effect from "effect/Effect"
import type { ContractMethods } from "../contracts/contract.js"
import type { BlockReference } from "../core/config-schemas.js"
import type { Near } from "../core/near.js"
import type { CallOptions } from "../core/types.js"
import type { NearFailure } from "./runtime.js"

export type EffectContract<T extends ContractMethods> = {
  [Group in keyof T]: {
    [Method in keyof T[Group]]: T[Group][Method] extends (
      ...args: infer Args
    ) => Promise<infer Result>
      ? (...args: Args) => Effect.Effect<Result, NearFailure>
      : never
  }
}

/** Type-safe native contract proxy; execution remains lazy and interruptible. */
export const createEffectContract = <T extends ContractMethods>(
  near: Near,
  contractId: string,
): EffectContract<T> =>
  ({
    view: new Proxy(
      {},
      {
        get:
          (_target, methodName: string) =>
          (args?: object | Uint8Array, options?: BlockReference) =>
            near.effects.view(contractId, methodName, args ?? {}, options),
      },
    ),
    call: new Proxy(
      {},
      {
        get:
          (_target, methodName: string) =>
          (args?: object | Uint8Array, options?: CallOptions) =>
            near.effects.call(
              contractId,
              methodName,
              args ?? {},
              options ?? {},
            ),
      },
    ),
  }) as EffectContract<T>
