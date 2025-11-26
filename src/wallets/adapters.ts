/**
 * Wallet adapters for NEAR wallet integrations.
 *
 * Provides adapter functions to integrate with popular NEAR wallets:
 * - `@near-wallet-selector/core`
 * - `@hot-labs/near-connect`
 *
 * These adapters use duck typing / structural compatibility to work with
 * wallet interfaces. While the actual wallet packages use `@near-js` types
 * (which are classes), our types (plain objects) are structurally compatible
 * and work correctly at runtime. See `tests/wallets/type-compatibility.test.ts`
 * for verification.
 */

import { base58 } from "@scure/base"
import type {
  Action,
  FinalExecutionOutcome,
  SignedMessage,
  WalletConnection,
} from "../core/types.js"
import { parsePublicKey } from "../utils/key.js"
import type {
  HotConnectAction,
  HotConnectAddKeyPermission,
  HotConnectConnector,
} from "./types.js"

// Wallet interface types based on @near-wallet-selector/core v10.x
// These are duck-typed to match the actual wallet interface structure.
// Note: Some wallet-selector implementations type signAndSendTransaction
// as returning `void | FinalExecutionOutcome`. We normalize this to always
// return a FinalExecutionOutcome from our adapter (we throw if the wallet
// returns void) so that the rest of near-kit can rely on a concrete result.
type WalletSelectorWallet = {
  getAccounts(): Promise<Array<{ accountId: string; publicKey?: string }>>
  signAndSendTransaction(params: {
    signerId?: string
    receiverId?: string // Optional in wallet-selector (defaults to contractId)
    actions: unknown[] // We pass our Action[] which is structurally compatible
  }): Promise<unknown> // Runtime result is structurally compatible with our FinalExecutionOutcome
  signMessage?(params: {
    message: string
    recipient: string
    nonce: Buffer // wallet-selector uses Buffer (Node.js), we convert from Uint8Array
    callbackUrl?: string
    state?: string
  }): Promise<unknown> // Many wallets type this as void | SignedMessage
}

/**
 * Adapter for @near-wallet-selector/core
 *
 * Converts a wallet-selector Wallet instance to the WalletConnection interface.
 *
 * @param wallet - Wallet instance from wallet-selector
 * @returns WalletConnection interface compatible with near-ts
 *
 * @example
 * ```typescript
 * import { Near } from 'near-ts'
 * import { setupWalletSelector } from '@near-wallet-selector/core'
 * import { fromWalletSelector } from 'near-ts/wallets'
 *
 * const selector = await setupWalletSelector({
 *   network: 'mainnet',
 *   modules: [...]
 * })
 * const wallet = await selector.wallet()
 *
 * const near = new Near({
 *   network: 'mainnet',
 *   wallet: fromWalletSelector(wallet)
 * })
 * ```
 */
export function fromWalletSelector(
  wallet: WalletSelectorWallet,
): WalletConnection {
  return {
    async getAccounts() {
      const accounts = await wallet.getAccounts()
      return accounts.map((acc) => ({
        accountId: acc.accountId,
        ...(acc.publicKey !== undefined && { publicKey: acc.publicKey }),
      }))
    },

    async signAndSendTransaction(params): Promise<FinalExecutionOutcome> {
      // Our Action[] type is structurally compatible with @near-js Action[]
      // Duck typing works at runtime - see type-compatibility.test.ts
      const result = await wallet.signAndSendTransaction({
        ...(params.signerId !== undefined && { signerId: params.signerId }),
        receiverId: params.receiverId,
        actions: params.actions,
      })

      if (!result) {
        throw new Error("Wallet did not return transaction outcome")
      }
      return result as FinalExecutionOutcome
    },

    async signMessage(params): Promise<SignedMessage> {
      if (!wallet.signMessage) {
        throw new Error("Wallet does not support message signing")
      }

      // wallet-selector expects Buffer, convert from Uint8Array
      const nonce = Buffer.from(params.nonce)

      const result = await wallet.signMessage({
        message: params.message,
        recipient: params.recipient,
        nonce,
      })

      // Browser wallets may return void
      if (!result) {
        throw new Error("Wallet did not return signed message")
      }
      return result as SignedMessage
    },
  }
}

/**
 * Adapter for @hot-labs/near-connect (HOT Connect)
 *
 * Converts a HOT Connect NearConnector instance to the WalletConnection interface.
 *
 * @param connector - NearConnector instance from HOT Connect
 * @returns WalletConnection interface compatible with near-ts
 *
 * @example
 * ```typescript
 * import { Near } from 'near-ts'
 * import { NearConnector } from '@hot-labs/near-connect'
 * import { fromHotConnect } from 'near-ts/wallets'
 *
 * const connector = new NearConnector({ network: 'mainnet' })
 *
 * // Wait for user to connect their wallet
 * connector.on('wallet:signIn', async () => {
 *   const near = new Near({
 *     network: 'mainnet',
 *     wallet: fromHotConnect(connector)
 *   })
 *
 *   // Use near-ts with the connected wallet
 *   await near.call('contract.near', 'method', { arg: 'value' })
 * })
 * ```
 */
/**
 * Adapter for @hot-labs/near-connect (HOT Connect)
 *
 * Converts a HOT Connect NearConnector instance to the WalletConnection interface.
 *
 * @param connector - NearConnector instance from HOT Connect
 * @returns WalletConnection interface compatible with near-kit
 *
 * @example
 * ```typescript
 * import { Near } from 'near-kit'
 * import { NearConnector } from '@hot-labs/near-connect'
 * import { fromHotConnect } from 'near-kit/wallets'
 *
 * const connector = new NearConnector({ network: 'mainnet' })
 *
 * // Wait for user to connect their wallet
 * connector.on('wallet:signIn', async () => {
 *   const near = new Near({
 *     network: 'mainnet',
 *     wallet: fromHotConnect(connector)
 *   })
 *
 *   // Use near-kit with the connected wallet
 *   await near.call('contract.near', 'method', { arg: 'value' })
 * })
 * ```
 */

function stringifyPublicKey(publicKey: unknown): string {
  const normalize = (value: string) => parsePublicKey(value).toString()

  if (typeof publicKey === "string") {
    try {
      return normalize(publicKey)
    } catch {
      return publicKey
    }
  }
  if (publicKey && typeof publicKey === "object") {
    const pk = publicKey as {
      ed25519Key?: { data: number[] }
      secp256k1Key?: { data: number[] }
      toString?: () => string
    }
    if (pk.toString) {
      const str = pk.toString()
      if (str && str !== "[object Object]") {
        try {
          return normalize(str)
        } catch {
          // Fall through to other representations
        }
      }
    }
    if (pk.ed25519Key?.data) {
      return normalize(
        `ed25519:${base58.encode(new Uint8Array(pk.ed25519Key.data))}`,
      )
    }
    if (pk.secp256k1Key?.data) {
      return normalize(
        `secp256k1:${base58.encode(new Uint8Array(pk.secp256k1Key.data))}`,
      )
    }
  }
  return String(publicKey)
}

export function fromHotConnect(
  connector: HotConnectConnector,
): WalletConnection {
  // Validate that we have a proper connector
  if (!connector || typeof connector.wallet !== "function") {
    throw new Error(
      "Invalid HOT Connect instance. Make sure @hot-labs/near-connect is installed and you're passing a NearConnector instance.",
    )
  }

  return {
    async getAccounts() {
      const wallet = await connector.wallet()
      const accounts = await wallet.getAccounts()

      return accounts.map((acc) => ({
        accountId: acc.accountId,
        publicKey: acc.publicKey,
      }))
    },

    async signAndSendTransaction(params): Promise<FinalExecutionOutcome> {
      const wallet = await connector.wallet()

      const convertAction = (action: Action): HotConnectAction => {
        const a = action as Record<string, unknown>

        if ("functionCall" in a && a["functionCall"]) {
          const fc = a["functionCall"] as {
            methodName: string
            args: unknown
            gas: bigint
            deposit: bigint
          }

          let args: unknown = fc.args
          if (
            Array.isArray(args) &&
            args.every((x: unknown) => typeof x === "number")
          ) {
            try {
              const argsString = new TextDecoder().decode(
                new Uint8Array(args as number[]),
              )
              args = JSON.parse(argsString)
            } catch {
              // If parsing fails, keep args as raw bytes (may be binary data)
            }
          } else if (args instanceof Uint8Array) {
            try {
              const argsString = new TextDecoder().decode(args)
              args = JSON.parse(argsString)
            } catch {
              // Keep raw bytes on parse failure
            }
          }

          const argsObject: Record<string, unknown> =
            args && typeof args === "object" && !Array.isArray(args)
              ? (args as Record<string, unknown>)
              : {}

          return {
            type: "FunctionCall",
            params: {
              methodName: fc.methodName,
              args: argsObject,
              gas: fc.gas.toString(),
              deposit: fc.deposit.toString(),
            },
          }
        }

        if ("transfer" in a && a["transfer"]) {
          const t = a["transfer"] as { deposit: bigint }
          return {
            type: "Transfer",
            params: { deposit: t.deposit.toString() },
          }
        }

        if ("stake" in a && a["stake"]) {
          const s = a["stake"] as { stake: bigint; publicKey: unknown }
          return {
            type: "Stake",
            params: {
              stake: s.stake.toString(),
              publicKey: stringifyPublicKey(s.publicKey),
            },
          }
        }

        if ("addKey" in a && a["addKey"]) {
          const ak = a["addKey"] as {
            publicKey: unknown
            accessKey: { nonce: bigint; permission: unknown }
          }
          return {
            type: "AddKey",
            params: {
              publicKey: stringifyPublicKey(ak.publicKey),
              accessKey: {
                nonce: Number(ak.accessKey.nonce),
                permission: ak.accessKey
                  .permission as HotConnectAddKeyPermission,
              },
            },
          }
        }

        if ("deleteKey" in a && a["deleteKey"]) {
          const dk = a["deleteKey"] as { publicKey: unknown }
          return {
            type: "DeleteKey",
            params: {
              publicKey: stringifyPublicKey(dk.publicKey),
            },
          }
        }

        if ("deleteAccount" in a && a["deleteAccount"]) {
          const da = a["deleteAccount"] as { beneficiaryId: string }
          return {
            type: "DeleteAccount",
            params: {
              beneficiaryId: da.beneficiaryId,
            },
          }
        }

        if ("createAccount" in a && a["createAccount"] !== undefined) {
          return {
            type: "CreateAccount",
          }
        }

        if ("deployContract" in a && a["deployContract"]) {
          const dc = a["deployContract"] as { code: Uint8Array }
          return {
            type: "DeployContract",
            params: {
              code: dc.code,
            },
          }
        }

        throw new Error(
          `Unsupported action type: ${Object.keys(a).join(", ") || "unknown"}`,
        )
      }

      const hotConnectorActions = params.actions.map(convertAction)

      const result = await wallet.signAndSendTransaction({
        ...(params.signerId !== undefined && { signerId: params.signerId }),
        receiverId: params.receiverId,
        actions: hotConnectorActions,
      })

      return result as FinalExecutionOutcome
    },

    async signMessage(params): Promise<SignedMessage> {
      const wallet = await connector.wallet()
      const result = await wallet.signMessage({
        message: params.message,
        recipient: params.recipient,
        nonce: params.nonce,
      })
      return result as SignedMessage
    },
  }
}
