/**
 * Wallet adapters for NEAR wallet integrations
 *
 * Provides adapter functions to integrate with popular NEAR wallets:
 * - @near-wallet-selector/core
 * - @hot-labs/near-connect
 *
 * These adapters use duck typing / structural compatibility to work with
 * wallet interfaces. While the actual wallet packages use @near-js types
 * (which are classes), our types (plain objects) are structurally compatible
 * and work correctly at runtime. See tests/wallets/type-compatibility.test.ts
 * for verification.
 */

import type {
  FinalExecutionOutcome,
  SignedMessage,
  WalletConnection,
} from "../core/types.js"

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

// Wallet interface types based on @hot-labs/near-connect v0.6.x
// These are duck-typed to match the NearWalletBase interface
type HotConnectWallet = {
  getAccounts(data?: { network?: string }): Promise<
    Array<{
      accountId: string
      publicKey: string // Required in HOT Connect (unlike wallet-selector)
    }>
  >
  signAndSendTransaction(params: {
    signerId?: string
    receiverId: string // Required in HOT Connect
    actions: unknown[] // We pass our Action[] which is structurally compatible
    network?: string
  }): Promise<FinalExecutionOutcome> // Returns @near-js type, structurally compatible
  signMessage(params: {
    message: string
    recipient: string
    nonce: Uint8Array // HOT Connect correctly uses Uint8Array
    network?: string
  }): Promise<SignedMessage> // HOT Connect always returns SignedMessage (not void)
}

// Type for HOT Connect's connector pattern
type HotConnectConnector = {
  wallet(): Promise<HotConnectWallet>
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
export function fromHotConnect(
  connector: HotConnectConnector,
): WalletConnection {
  return {
    async getAccounts() {
      const wallet = await connector.wallet()
      const accounts = await wallet.getAccounts()
      // HOT Connect requires publicKey (not optional)
      return accounts.map((acc) => ({
        accountId: acc.accountId,
        publicKey: acc.publicKey,
      }))
    },

    async signAndSendTransaction(params) {
      const wallet = await connector.wallet()
      // Our Action[] type is structurally compatible with @near-js Action[]
      // Duck typing works at runtime - see type-compatibility.test.ts
      return await wallet.signAndSendTransaction({
        ...(params.signerId !== undefined && { signerId: params.signerId }),
        receiverId: params.receiverId,
        actions: params.actions,
      })
    },

    async signMessage(params) {
      const wallet = await connector.wallet()
      // HOT Connect uses Uint8Array for nonce (matches our type)
      return await wallet.signMessage({
        message: params.message,
        recipient: params.recipient,
        nonce: params.nonce,
      })
    },
  }
}
