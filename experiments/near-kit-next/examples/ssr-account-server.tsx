/** Copy this Fetch route into an application with an allowlisted public RPC source. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderToString } from "react-dom/server"
import {
  type AccountSource,
  readSsrAccount,
  SsrAccount,
  serializeSsrAccount,
} from "./ssr-account.js"

function attribute(text: string): string {
  return text.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;"
      case "<":
        return "&lt;"
      case ">":
        return "&gt;"
      case '"':
        return "&quot;"
      default:
        return "&#39;"
    }
  })
}

export async function accountPageResponse(
  request: Request,
  options: {
    readonly source: AccountSource
    readonly accountId: string
    // App-owned same-origin module path, for example /account.js. Never user input.
    readonly browserModule: string
  },
): Promise<Response> {
  request.signal.throwIfAborted()
  const browserModule = options.browserModule
  if (
    typeof browserModule !== "string" ||
    browserModule.length > 256 ||
    /^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*\.js$/.exec(
      browserModule,
    )?.[0] !== browserModule
  )
    throw new TypeError(
      "Expected an application-owned local JavaScript module path",
    )
  const source = { key: options.source.key, client: options.source.client }
  const initial = await readSsrAccount(
    source,
    {
      requestId: crypto.randomUUID(),
      sourceKey: source.key,
      accountId: options.accountId,
    },
    request.signal,
  )
  request.signal.throwIfAborted()
  // This client exists only for this render, even under simultaneous requests.
  const queryClient = new QueryClient()
  try {
    const content = renderToString(
      <QueryClientProvider client={queryClient}>
        <SsrAccount source={source} initial={initial} />
      </QueryClientProvider>,
    )
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Account snapshot</title></head><body><div id="account-root" data-request-id="${attribute(initial.requestId)}" data-source-key="${attribute(initial.sourceKey)}" data-account-id="${attribute(initial.accountId)}">${content}</div><script id="account-data" type="application/json">${serializeSsrAccount(initial)}</script><script type="module" src="${attribute(browserModule)}"></script></body></html>`
    // Cancellation after the RPC completes must still suppress a success page.
    request.signal.throwIfAborted()
    return new Response(html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "private, no-store",
      },
    })
  } finally {
    queryClient.clear()
  }
}
