import * as Near from "@near-kit/next"
import { hydrateAccountPage } from "../../examples/ssr-account-client.js"

declare global {
  interface Window {
    ssrDemo: {
      hydrated: boolean
      error: string | null
      recoverable: string[]
      navigate: (path: string) => Promise<void>
      dispose: () => void
    }
  }
}
const root = document.getElementById("account-root")
if (root === null) throw new Error("Missing account root")
// The browser owns this allowlist. Serialized data cannot supply an RPC URL.
const sources = Object.fromEntries(
  ["ssr-one", "ssr-two"].map((key) => [
    key,
    { key, client: Near.make({ url: `${location.origin}/rpc/${key}` }) },
  ]),
)
const demo: Window["ssrDemo"] = {
  hydrated: false,
  error: null,
  recoverable: [],
  navigate: async () => {
    throw new Error("Account page is unavailable")
  },
  dispose: () => {},
}
window.ssrDemo = demo
try {
  const page = hydrateAccountPage(document, sources, {
    onHydrated: () => {
      demo.hydrated = true
    },
    onRecoverableError: (error) => demo.recoverable.push(String(error)),
  })
  // Test routing hooks; application routers own the same request ordering.
  let navigation = 0
  demo.navigate = async (path) => {
    const revision = ++navigation
    const response = await fetch(path)
    if (!response.ok) throw new Error("Account navigation failed")
    const next = new DOMParser().parseFromString(
      await response.text(),
      "text/html",
    )
    if (revision === navigation) page.render(next)
  }
  demo.dispose = () => {
    navigation += 1
    page.dispose()
  }
} catch {
  demo.error = "Invalid account page data"
  root.textContent = demo.error
}
