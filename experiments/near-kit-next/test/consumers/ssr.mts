import * as Near from "@near-kit/next"
import { parseSsrAccount } from "./ssr-account.js"
import { accountPageResponse } from "./ssr-account-server.js"

const originalFetch = globalThis.fetch
let calls = 0
globalThis.fetch = async (_url, init) => {
  calls++
  const request = JSON.parse(await new Response(init?.body).text())
  return new Response(
    `{"jsonrpc":"2.0","id":${JSON.stringify(request.id)},"result":{"amount":"340282366920938463463374607431768211455","locked":"0","storage_usage":0,"code_hash":"11111111111111111111111111111111","block_hash":"11111111111111111111111111111111","block_height":18446744073709551615}}`,
  )
}
try {
  const response = await accountPageResponse(
    new Request("https://app.invalid/account"),
    {
      source: {
        key: "public-one",
        client: Near.make({ url: "https://fixture.invalid" }),
      },
      accountId: "alice.testnet",
      browserModule: "/account.js",
    },
  )
  if (response.headers.get("cache-control") !== "private, no-store")
    throw new Error("SSR cache isolation failed")
  const html = await response.text()
  const payload =
    /<script id="account-data" type="application\/json">([^<]*)<\/script>/.exec(
      html,
    )?.[1]
  const requestId = /data-request-id="([^"]+)"/.exec(html)?.[1]
  if (!payload || !requestId) throw new Error("Missing SSR hydration payload")
  const snapshot = parseSsrAccount(payload, {
    requestId,
    sourceKey: "public-one",
    accountId: "alice.testnet",
  })
  if (
    calls !== 1 ||
    snapshot.amount !== 340282366920938463463374607431768211455n ||
    snapshot.blockHeight !== 18446744073709551615n
  )
    throw new Error("Packed SSR workflow failed")
  console.log("Packed request-scoped SSR and exact hydration data passed")
} finally {
  globalThis.fetch = originalFetch
}
