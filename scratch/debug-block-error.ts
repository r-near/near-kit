import { Sandbox } from "../src/sandbox/sandbox.js"

const sandbox = await Sandbox.start()

// Make raw fetch to see actual RPC response
const response = await fetch(sandbox.rpcUrl, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "query",
    params: {
      request_type: "view_account",
      block_id: 999999999,
      account_id: "test.near"
    }
  })
})

const result = await response.json()
console.log("\n=== Raw RPC Response ===")
console.log(JSON.stringify(result, null, 2))

if (result.error) {
  console.log("\n=== Error Cause Info ===")
  console.log("cause.name:", result.error.cause?.name)
  console.log("cause.info:", result.error.cause?.info)
  console.log("cause.info.block_reference type:", typeof result.error.cause?.info?.block_reference)
  console.log("cause.info.block_reference value:", result.error.cause?.info?.block_reference)
}

await sandbox.stop()
