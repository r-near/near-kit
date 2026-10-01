/** Copy this browser entry helper alongside the matching server/DTO examples. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useEffect } from "react"
import { hydrateRoot } from "react-dom/client"
import {
  type AccountSource,
  parseSsrAccount,
  SsrAccount,
} from "./ssr-account.js"

export function hydrateAccountPage(
  page: Document,
  sources: Readonly<Record<string, AccountSource>>,
  callbacks: {
    readonly onHydrated?: () => void
    readonly onRecoverableError?: (error: unknown) => void
  } = {},
) {
  const element = page.getElementById("account-root")
  if (element === null) throw new TypeError("Missing account root")
  const readPage = (document: Document) => {
    const root = document.getElementById("account-root")
    const source = sources[root?.dataset.sourceKey ?? ""]
    if (root === null || source === undefined)
      throw new TypeError("Unknown account source")
    return {
      source,
      initial: parseSsrAccount(
        document.getElementById("account-data")?.textContent ?? "",
        {
          requestId: root.dataset.requestId ?? "",
          sourceKey: source.key,
          accountId: root.dataset.accountId ?? "",
        },
      ),
    }
  }
  const initial = readPage(page) // Validate before creating a cache or hydrating.
  const queryClient = new QueryClient()
  function Hydrated() {
    useEffect(() => {
      callbacks.onHydrated?.()
    }, [])
    return null
  }
  const content = (props: ReturnType<typeof readPage>) => (
    <QueryClientProvider client={queryClient}>
      <Hydrated />
      <SsrAccount {...props} />
    </QueryClientProvider>
  )
  let root: ReturnType<typeof hydrateRoot>
  try {
    root = hydrateRoot(element, content(initial), {
      ...(callbacks.onRecoverableError
        ? { onRecoverableError: callbacks.onRecoverableError }
        : {}),
    })
  } catch (error) {
    queryClient.clear()
    throw error
  }
  let disposed = false
  return {
    // The application's router owns loading and ordering subsequent documents.
    render(nextPage: Document) {
      if (disposed) throw new Error("Account page is disposed")
      root.render(content(readPage(nextPage)))
    },
    dispose() {
      if (disposed) return
      disposed = true
      try {
        root.unmount()
      } finally {
        queryClient.clear()
      }
    },
  }
}
