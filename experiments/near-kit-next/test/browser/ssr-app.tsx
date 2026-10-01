import * as Near from "@near-kit/next"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useEffect } from "react"
import { hydrateRoot } from "react-dom/client"
import { parseSsrAccount, SsrAccount } from "../../examples/ssr-account.js"

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
    {
      key,
      client: Near.make({ url: `${location.origin}/rpc/${key}` }),
    },
  ]),
)
function initialFrom(page: Document) {
  const element = page.getElementById("account-root")
  const source = sources[element?.dataset.sourceKey ?? ""]
  if (source === undefined || element === null)
    throw new TypeError("Unknown account source")
  const initial = parseSsrAccount(
    page.getElementById("account-data")?.textContent ?? "",
    {
      requestId: element.dataset.requestId ?? "",
      sourceKey: source.key,
      accountId: element.dataset.accountId ?? "",
    },
  )
  return { source, initial }
}
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
function HydrationMarker() {
  useEffect(() => {
    demo.hydrated = true
  }, [])
  return null
}
try {
  const initial = initialFrom(document) // Validate before React consumes the data.
  const queryClient = new QueryClient() // One document, never a module-level server cache.
  const content = (props: ReturnType<typeof initialFrom>) => (
    <QueryClientProvider client={queryClient}>
      <HydrationMarker />
      <SsrAccount {...props} />
    </QueryClientProvider>
  )
  const reactRoot = hydrateRoot(root, content(initial), {
    onRecoverableError: (error) => demo.recoverable.push(String(error)),
  })
  // Test-only routing/disposal hooks. Ordinary applications use their router's lifecycle.
  let navigation = 0
  demo.navigate = async (path) => {
    const revision = ++navigation
    const response = await fetch(path)
    if (!response.ok) throw new Error("Account navigation failed")
    const next = initialFrom(
      new DOMParser().parseFromString(await response.text(), "text/html"),
    )
    if (revision === navigation) reactRoot.render(content(next))
  }
  demo.dispose = () => {
    navigation += 1
    reactRoot.unmount()
    queryClient.clear()
  }
} catch {
  demo.error = "Invalid account page data"
  root.textContent = demo.error
}
