import * as Near from "@near-kit/next"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { StrictMode, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import { AccountBalance } from "../../examples/account-balance.js"
import { platformChecks } from "../consumers/platform.js"

declare global {
  interface Window {
    readDemo: {
      platform: typeof platformChecks
      select: (accountId: string | null, network?: string) => void
      batchABA: () => void
      views: () => Promise<{
        count: number
        bytes: number[]
      }>
    }
  }
}
function App() {
  const [selection, setSelection] = useState({
    _tag: "Connected" as const,
    accountId: "a.testnet",
    rpcUrl: `${location.origin}/rpc/one`,
    revision: 0,
  } as Parameters<typeof AccountBalance>[0]["selection"])
  const revision = useRef(0)
  const select = (accountId: string | null, network = "one") => {
    revision.current += 1
    setSelection(
      accountId === null
        ? { _tag: "Disconnected" }
        : {
            _tag: "Connected",
            accountId,
            rpcUrl: `${location.origin}/rpc/${network}`,
            revision: revision.current,
          },
    )
  }
  window.readDemo = {
    platform: platformChecks,
    select,
    batchABA: () => {
      select("b.testnet")
      select("a.testnet")
    },
    views: async () => {
      const near = Near.make({ url: `${location.origin}/immediate` })
      const result = await Effect.runPromise(
        Effect.all({
          json: Near.view(near, {
            accountId: "fixture",
            method: "json",
            args: new Uint8Array([1]),
            schema: Schema.Struct({ count: Schema.Number }),
          }),
          bytes: Near.viewBytes(near, {
            accountId: "fixture",
            method: "binary",
            args: { json: true },
          }),
        }).pipe(Effect.provide(Near.fetchLayer)),
      )
      return {
        count: result.json.value.count,
        bytes: Array.from(result.bytes.value),
      }
    },
  }
  return <AccountBalance selection={selection} />
}
const root = document.getElementById("root")
if (root === null) throw new Error("Missing fixture root")
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
