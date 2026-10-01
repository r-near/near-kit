import * as Near from "@near-kit/next"
import type {
  WalletSelector,
  WalletSelectorEvents,
  WalletSelectorState,
} from "@near-wallet-selector/core"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { StrictMode, useState } from "react"
import { createRoot } from "react-dom/client"
import { BehaviorSubject } from "rxjs"
import { WalletAccount } from "../../examples/wallet-account.js"
import { WalletQueryAccount } from "../../examples/wallet-query.js"
import type {
  ReadSource,
  SelectorObservation,
  WalletSetup,
} from "../../examples/wallet-selector-observation.js"

// Real browser/application lifecycle with a typed mocked connector seam. No wallet
// extension, connector creation or connection/write method is exercised.
const state = (
  accountId: string | null,
  walletId = "wallet-a",
): WalletSelectorState => ({
  contract: null,
  modules: [],
  accounts: accountId === null ? [] : [{ accountId, active: true }],
  selectedWalletId: accountId === null ? null : walletId,
  recentlySignedInWallets: [],
  rememberRecentWallets: "",
})
const subject = new BehaviorSubject(state("a.testnet"))
const listeners = new Map<
  keyof WalletSelectorEvents,
  Set<(event: never) => void>
>()
const on: WalletSelector["on"] = (name, callback) => {
  const group = listeners.get(name) ?? new Set<(event: never) => void>()
  const own = callback as (event: never) => void
  listeners.set(name, group)
  group.add(own)
  return {
    remove: () => {
      group.delete(own)
    },
  }
}
const selector: SelectorObservation = {
  store: {
    getState: () => subject.getValue(),
    observable: subject.asObservable(),
  },
  on,
  options: {
    network: {
      networkId: "testnet",
      nodeUrl: "https://unused.invalid",
      helperUrl: "",
      explorerUrl: "",
      indexerUrl: "",
    },
    languageCode: undefined,
    debug: false,
    optimizeWalletOrder: false,
    randomizeWalletOrder: false,
    relayerUrl: undefined,
  },
}
const binding = (network: string, revision: number): ReadSource => ({
  client: Near.make({ url: `${location.origin}/rpc/${network}` }),
  sourceKey: `fixture-${network}`,
  networkId: "testnet",
  revision,
})
const cache = new QueryClient()
declare global {
  interface Window {
    walletDemo: {
      select: (id: string | null) => void
      batchABA: () => void
      network: (networkId: string, walletId?: string) => void
      source: (network: string) => void
      enabled: (enabled: boolean) => void
      setup: (status: "ready" | "failed") => void
      unmount: () => void
      subscriptions: () => number
    }
  }
}
const element = document.getElementById("root")
if (element === null) throw new Error("Missing root")
const root = createRoot(element)
let sourceRevision = 0
function App() {
  const [source, setSource] = useState(() => binding("one", 0))
  const [enabled, setEnabled] = useState(true)
  const [setup, setSetup] = useState<WalletSetup>({ status: "ready", selector })
  window.walletDemo = {
    select: (id) => subject.next(state(id)),
    batchABA: () => {
      subject.next(state("b.testnet"))
      subject.next(state("a.testnet"))
    },
    network: (networkId, walletId = "wallet-a") => {
      for (const listener of listeners.get("networkChanged") ?? [])
        listener({ networkId, walletId } as never)
    },
    source: (network) => setSource(binding(network, ++sourceRevision)),
    enabled: setEnabled,
    setup: (status) =>
      setSetup(status === "ready" ? { status, selector } : { status }),
    unmount: () => {
      root.unmount()
      cache.clear()
    },
    subscriptions: () =>
      subject.observers.length +
      [...listeners.values()].reduce((sum, group) => sum + group.size, 0),
  }
  const props = { setup, source, enabled }
  return new URLSearchParams(location.search).get("mode") === "query" ? (
    <QueryClientProvider client={cache}>
      <WalletQueryAccount {...props} />
    </QueryClientProvider>
  ) : (
    <WalletAccount {...props} />
  )
}
root.render(
  <StrictMode>
    <App />
  </StrictMode>,
)
