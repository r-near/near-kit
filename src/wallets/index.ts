/**
 * Wallet integration adapters for NEAR.
 *
 * @remarks
 * Re-exports the {@link WalletConnection} interface and concrete adapters
 * {@link fromWalletSelector} and {@link fromHotConnect} for integrating with
 * common NEAR wallet libraries.
 */
export type { WalletConnection } from "../core/types.js"
export { fromHotConnect, fromWalletSelector } from "./adapters.js"
