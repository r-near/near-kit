import * as Near from "@near-kit/next"
import type { WalletSelector } from "@near-wallet-selector/core"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createElement } from "react"
import { renderToString } from "react-dom/server"
import { WalletAccount } from "./wallet-account.js"
import { WalletQueryAccount } from "./wallet-query.js"
import type { SelectorObservation } from "./wallet-selector-observation.js"

const acceptsPublicSelector = (selector: WalletSelector): SelectorObservation =>
  selector
void acceptsPublicSelector
let resources = 0
const selector: SelectorObservation = {
  get options(): WalletSelector["options"] {
    resources++
    throw new Error("SSR read options")
  },
  get store(): WalletSelector["store"] {
    resources++
    throw new Error("SSR read store")
  },
  on() {
    resources++
    throw new Error("SSR subscribed")
  },
}
const source = {
  client: Near.make({ url: "https://fixture.invalid" }),
  sourceKey: "fixture",
  networkId: "testnet",
  revision: 0,
}
const props = { setup: { status: "ready" as const, selector }, source }
const cache = new QueryClient()
const plain = renderToString(createElement(WalletAccount, props))
const queried = renderToString(
  createElement(
    QueryClientProvider,
    { client: cache },
    createElement(WalletQueryAccount, props),
  ),
)
if (
  !plain.includes("Loading wallet selection") ||
  !queried.includes("Loading wallet selection") ||
  resources !== 0 ||
  cache.getQueryCache().getAll().length !== 0
)
  throw new Error("Packed optional wallet SSR lifecycle failed")
cache.clear()
console.log("Packed optional strict wallet types and SSR passed")
