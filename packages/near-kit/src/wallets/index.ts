/**
 * Wallet integration adapters for NEAR.
 *
 * @remarks
 * Re-exports the {@link WalletConnection} interface and wallet adapters:
 * {@link fromNearConnect} (recommended), deprecated {@link fromHotConnect} alias,
 * and deprecated {@link fromWalletSelector}.
 */
export type { WalletConnection } from "../core/types.js"
export {
  fromHotConnect,
  fromNearConnect,
  fromWalletSelector,
} from "./adapters.js"
