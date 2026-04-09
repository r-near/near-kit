/**
 * Wallet integration adapters for NEAR.
 *
 * @remarks
 * Re-exports the {@link WalletConnection} interface and concrete adapters
 * {@link fromNearConnect} and {@link fromWalletSelector} for integrating with
 * NEAR wallet libraries.
 */
export type { WalletConnection } from "../core/types.js"
export {
  fromHotConnect,
  fromNearConnect,
  fromWalletSelector,
} from "./adapters.js"
