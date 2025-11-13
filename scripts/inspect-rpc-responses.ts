/**
 * Script to inspect raw RPC responses and validate type definitions
 *
 * Run with: bun run scripts/inspect-rpc-responses.ts
 */

const MAINNET_RPC = "https://free.rpc.fastnear.com"
const TESTNET_RPC = "https://rpc.testnet.fastnear.com"

async function rpcCall(url: string, method: string, params: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    }),
  })

  const data = await response.json()
  return data
}

console.log("=".repeat(80))
console.log("INSPECTING RPC RESPONSES FROM FASTNEAR ENDPOINTS")
console.log("=".repeat(80))
console.log()

// 1. Get Status
console.log("1. status (network status)")
console.log("-".repeat(80))
try {
  const status = await rpcCall(MAINNET_RPC, "status", [])
  console.log(JSON.stringify(status, null, 2))
} catch (error) {
  console.error("Error:", error)
}
console.log()

// 2. Get Gas Price
console.log("2. gas_price (current gas price)")
console.log("-".repeat(80))
try {
  const gasPrice = await rpcCall(MAINNET_RPC, "gas_price", [null])
  console.log(JSON.stringify(gasPrice, null, 2))
} catch (error) {
  console.error("Error:", error)
}
console.log()

// 3. View Account
console.log("3. query - view_account (account info for 'near')")
console.log("-".repeat(80))
try {
  const account = await rpcCall(MAINNET_RPC, "query", {
    request_type: "view_account",
    finality: "final",
    account_id: "near",
  })
  console.log(JSON.stringify(account, null, 2))
} catch (error) {
  console.error("Error:", error)
}
console.log()

// 4. View Access Key
console.log("4. query - view_access_key (access key for 'near')")
console.log("-".repeat(80))
try {
  // First get an access key for the account
  const accessKeys = await rpcCall(MAINNET_RPC, "query", {
    request_type: "view_access_key_list",
    finality: "final",
    account_id: "near",
  })
  console.log("Access key list response:")
  console.log(JSON.stringify(accessKeys, null, 2))

  // If we got keys, query the first one
  if (accessKeys.result?.keys?.[0]) {
    console.log("\nQuerying first access key details:")
    const accessKey = await rpcCall(MAINNET_RPC, "query", {
      request_type: "view_access_key",
      finality: "final",
      account_id: "near",
      public_key: accessKeys.result.keys[0].public_key,
    })
    console.log(JSON.stringify(accessKey, null, 2))
  }
} catch (error) {
  console.error("Error:", error)
}
console.log()

// 5. Call Function (view)
console.log("5. query - call_function (view method on wrap.near)")
console.log("-".repeat(80))
try {
  const argsBase64 = Buffer.from(JSON.stringify({})).toString("base64")
  const viewCall = await rpcCall(MAINNET_RPC, "query", {
    request_type: "call_function",
    finality: "final",
    account_id: "wrap.near",
    method_name: "ft_metadata",
    args_base64: argsBase64,
  })
  console.log(JSON.stringify(viewCall, null, 2))

  // Also decode and show the result
  if (viewCall.result?.result) {
    const decoded = JSON.parse(
      Buffer.from(viewCall.result.result).toString()
    )
    console.log("\nDecoded result:")
    console.log(JSON.stringify(decoded, null, 2))
  }
} catch (error) {
  console.error("Error:", error)
}
console.log()

// 6. Non-existent account error
console.log("6. query - view_account (non-existent account - error case)")
console.log("-".repeat(80))
try {
  const nonExistent = await rpcCall(MAINNET_RPC, "query", {
    request_type: "view_account",
    finality: "final",
    account_id: "this-account-does-not-exist-12345.near",
  })
  console.log(JSON.stringify(nonExistent, null, 2))
} catch (error) {
  console.error("Error:", error)
}
console.log()

// 7. Block query
console.log("7. block (latest block)")
console.log("-".repeat(80))
try {
  const block = await rpcCall(MAINNET_RPC, "block", {
    finality: "final",
  })
  console.log(JSON.stringify(block, null, 2))
} catch (error) {
  console.error("Error:", error)
}
console.log()

// 8. Testnet status for comparison
console.log("8. status (testnet for comparison)")
console.log("-".repeat(80))
try {
  const testnetStatus = await rpcCall(TESTNET_RPC, "status", [])
  console.log(JSON.stringify(testnetStatus, null, 2))
} catch (error) {
  console.error("Error:", error)
}
console.log()

console.log("=".repeat(80))
console.log("INSPECTION COMPLETE")
console.log("=".repeat(80))
