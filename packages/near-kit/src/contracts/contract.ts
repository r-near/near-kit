import type { BlockReference } from "../core/config-schemas.js"
import type { Near } from "../core/near.js"
import type { CallOptions } from "../core/types.js"

/**
 * Utility type to automatically add options parameter to call methods.
 *
 * Usage:
 * ```typescript
 * type MyContract = Contract<{
 *   view: {
 *     get_count: () => Promise<number>
 *   }
 *   call: {
 *     increment: (args: { amount: number }) => Promise<void>
 *   }
 * }>
 * ```
 *
 * The call method will automatically get an options parameter:
 * increment: (args: { amount: number }, options?: CallOptions) => Promise<void>
 */
export type Contract<
  T extends {
    // biome-ignore lint/suspicious/noExplicitAny: Generic constraint needs any for flexibility
    view: Record<string, (...args: any[]) => any>
    // biome-ignore lint/suspicious/noExplicitAny: Generic constraint needs any for flexibility
    call: Record<string, (...args: any[]) => any>
  },
> = {
  view: T["view"]
  call: {
    [K in keyof T["call"]]: T["call"][K] extends (
      ...args: infer TArgs
    ) => infer TReturn
      ? TArgs extends [infer TFirstArg, ...infer _Rest]
        ? (args: TFirstArg, options?: CallOptions) => TReturn
        : (args?: undefined, options?: CallOptions) => TReturn
      : never
  }
}

/**
 * Base contract method interface used by {@link Contract}.
 *
 * Methods can be defined as:
 * - View methods: (args?: ArgsType | Uint8Array, options?: BlockReference) => Promise<ReturnType>
 * - Call methods: (args?: ArgsType | Uint8Array, options?: CallOptions) => Promise<ReturnType>
 *
 * This is a base interface without index signatures to allow
 * extending interfaces to define specific method signatures with type safety.
 */
export interface ContractMethods {
  // biome-ignore lint/suspicious/noExplicitAny: Base interface needs any for flexibility
  view: Record<string, (...args: any[]) => Promise<any>>
  // biome-ignore lint/suspicious/noExplicitAny: Base interface needs any for flexibility
  call: Record<string, (...args: any[]) => Promise<any>>
}

/**
 * Create a type-safe contract proxy for a NEAR contract.
 *
 * @param near - The {@link Near} client instance to use for calls.
 * @param contractId - Account ID of the target contract.
 *
 * @returns A proxy implementing the given {@link ContractMethods} interface.
 *
 * @remarks
 * Prefer using {@link Near.contract} instead of calling this function directly.
 */
export function createContract<T extends ContractMethods>(
  near: Near,
  contractId: string,
): T {
  const proxy = {
    view: new Proxy(
      {},
      {
        get: (_target, methodName: string) => {
          return async (
            args?: object | Uint8Array,
            options?: BlockReference,
          ) => {
            return await near.view(contractId, methodName, args || {}, options)
          }
        },
      },
    ),
    call: new Proxy(
      {},
      {
        get: (_target, methodName: string) => {
          return async (args?: object | Uint8Array, options?: CallOptions) => {
            return await near.call(
              contractId,
              methodName,
              args || {},
              options || {},
            )
          }
        },
      },
    ),
  }

  return proxy as T
}

/**
 * Helper to extend {@link Near} prototype with a `contract` method.
 *
 * @internal This is used to keep the core {@link Near} implementation focused;
 * library users should call {@link Near.contract} instead of using this helper.
 */
export function addContractMethod(nearPrototype: typeof Near.prototype): void {
  nearPrototype.contract = function <T extends ContractMethods>(
    this: Near,
    contractId: string,
  ): T {
    return createContract<T>(this, contractId)
  }
}
