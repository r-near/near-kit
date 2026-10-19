import * as Near from "@near-kit/next"
import { accountPageResponse } from "../../examples/ssr-account-server.js"

/** Local deterministic HTTP fixture, exercising the same exported route recipe. */
export function renderSsrFixture(request: Request) {
  const url = new URL(request.url)
  const name = url.searchParams.get("source") ?? "one"
  if (name !== "one" && name !== "two")
    throw new Error("Unknown fixture source")
  return accountPageResponse(request, {
    source: {
      key: `ssr-${name}`,
      client: Near.make({ url: `${url.origin}/rpc/ssr-${name}` }),
    },
    accountId: url.searchParams.get("account") ?? "alice.testnet",
    browserModule: "/ssr.js",
  })
}
