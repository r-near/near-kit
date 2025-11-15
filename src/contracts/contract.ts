/**
 * Type-safe contract interface
 */

import type { BlockReference } from "../core/config-schemas.js"
import type { Near } from "../core/near.js"
import type { CallOptions } from "../core/types.js"

/**
 * Contract method interface
 *
 * Methods can be defined as:
 * - View methods: (args?: ArgsType | Uint8Array, options?: BlockReference) => Promise<ReturnType>
 * - Call methods: (args?: ArgsType | Uint8Array, options?: CallOptions) => Promise<ReturnType>
 */
export interface ContractMethods {
  view: Record<
    string,
    (args?: unknown, options?: BlockReference) => Promise<unknown>
  >
  call: Record<
    string,
    (args?: unknown, options?: CallOptions) => Promise<unknown>
  >
}

/**
 * Create a type-safe contract proxy
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
 * Helper to extend Near class with contract method
 */
export function addContractMethod(nearPrototype: typeof Near.prototype): void {
  nearPrototype.contract = function <T extends ContractMethods>(
    this: Near,
    contractId: string,
  ): T {
    return createContract<T>(this, contractId)
  }
}
