/**
 * Playground for exploring RPC error responses from sandbox
 * This helps identify edge cases in rpc-error-handler.ts that need coverage
 */

import { Sandbox } from "../src/sandbox/sandbox.js"
import { Near } from "../src/core/near.js"
import { InMemoryKeyStore } from "../src/keys/in-memory-keystore.js"

async function exploreRpcErrors() {
  console.log("🧪 Starting RPC Error Exploration...\n")

  const sandbox = await Sandbox.start()
  const keyStore = new InMemoryKeyStore()

  const near = new Near({
    networkId: "sandbox",
    rpcUrl: sandbox.rpcUrl,
    keyStore,
  })

  try {
    // ===== Test 1: Malformed RPC request (should trigger parseRpcError edge cases) =====
    console.log("--- Test 1: Query with invalid block reference ---")
    try {
      const result = await near.rpc.query({
        request_type: "view_account",
        block_id: 999999999, // Very high block that doesn't exist
        account_id: "test.near",
      })
      console.log("❌ Should have failed, got:", result)
    } catch (error: any) {
      console.log("✅ Error type:", error.constructor.name)
      console.log("   Message:", error.message)
      console.log("   Code:", error.code)
      console.log("   Raw error:", JSON.stringify(error, null, 2))
    }

    console.log("\n--- Test 2: Query with block hash (0 bytes) ---")
    try {
      const result = await near.rpc.query({
        request_type: "view_account",
        block_id: "11111111111111111111111111111111", // Invalid block hash
        account_id: "test.near",
      })
      console.log("❌ Should have failed, got:", result)
    } catch (error: any) {
      console.log("✅ Error type:", error.constructor.name)
      console.log("   Message:", error.message)
    }

    console.log("\n--- Test 3: View access key that doesn't exist (edge case for line 271) ---")
    try {
      const result = await near.rpc.query({
        request_type: "view_access_key",
        account_id: "test.near",
        public_key: "ed25519:11111111111111111111111111111111111111111111",
        finality: "final",
      })
      console.log("❌ Should have failed, got:", result)
    } catch (error: any) {
      console.log("✅ Error type:", error.constructor.name)
      console.log("   Message:", error.message)
    }

    console.log("\n--- Test 4: Call function on non-existent contract ---")
    try {
      const result = await near.rpc.query({
        request_type: "call_function",
        account_id: "nonexistent.test.near",
        method_name: "get_value",
        args_base64: btoa(JSON.stringify({})),
        finality: "final",
      })
      console.log("❌ Should have failed, got:", result)
    } catch (error: any) {
      console.log("✅ Error type:", error.constructor.name)
      console.log("   Message:", error.message)
      console.log("   Context:", error.context)
    }

    console.log("\n--- Test 5: Invalid shard ID ---")
    try {
      // Sandbox might not support this, but worth trying
      const result = await near.rpc.call("chunk", {
        chunk_id: "invalid_chunk_id",
      })
      console.log("❌ Should have failed, got:", result)
    } catch (error: any) {
      console.log("✅ Error type:", error.constructor.name)
      console.log("   Message:", error.message)
    }

    console.log("\n--- Test 6: HTTP status code tests (using invalid endpoint) ---")
    try {
      // Create a Near instance with invalid URL to trigger network errors
      const badNear = new Near({
        networkId: "sandbox",
        rpcUrl: "http://localhost:99999", // Invalid port
        keyStore,
      })
      await badNear.rpc.status()
    } catch (error: any) {
      console.log("✅ Error type:", error.constructor.name)
      console.log("   Message:", error.message)
      console.log("   Retryable:", error.retryable)
    }

    console.log("\n--- Test 7: Try to trigger HostError (line 114) ---")
    // Deploy a contract that might trigger HostError
    const account = await sandbox.createAccount("test-host-error")

    // Try to call a function that might trigger a host error (invalid WASM, etc.)
    try {
      await account.functionCall({
        contractId: account.accountId,
        methodName: "invalid_method",
        args: {},
        gas: "300 Tgas",
      })
    } catch (error: any) {
      console.log("✅ Error type:", error.constructor.name)
      console.log("   Message:", error.message)
      console.log("   Panic:", error.panicMessage)
    }

    console.log("\n--- Test 8: Try malformed error (lines 165, 177) ---")
    // This requires mocking, so we'll note it for unit tests
    console.log("⚠️  Malformed error structure requires mocked RPC responses (unit tests)")

    console.log("\n--- Test 9: Query error without accountId/publicKey context (line 274) ---")
    try {
      const result = await near.rpc.query({
        request_type: "call_function",
        account_id: "nonexistent.test.near",
        method_name: "test",
        args_base64: "",
        finality: "final",
      })
      console.log("❌ Should have failed, got:", result)
    } catch (error: any) {
      console.log("✅ Error type:", error.constructor.name)
      console.log("   Message:", error.message)
    }

    console.log("\n--- Test 10: Check different HTTP status codes (isRetryableStatus) ---")
    const statusCodes = [408, 429, 500, 502, 503, 504, 400, 404]
    for (const code of statusCodes) {
      // We can't easily trigger specific HTTP status codes from sandbox
      // This requires unit tests with mocked fetch
      console.log(`⚠️  Status ${code} requires mocked HTTP responses (unit tests)`)
    }

  } finally {
    await sandbox.stop()
  }

  console.log("\n✨ Exploration complete!")
  console.log("\n📝 Summary of uncovered lines:")
  console.log("  - Line 114: HostError fallback - needs contract that triggers host errors")
  console.log("  - Line 165: Malformed ActionError - needs mocked RPC responses")
  console.log("  - Line 177: ActionError with dataStr - needs specific error types")
  console.log("  - Lines 214-222: HTTP status codes - needs mocked fetch")
  console.log("  - Line 271: AccessKeyDoesNotExist edge case - already covered?")
  console.log("  - Line 286: parseRpcError with undefined - needs mocked RPC")
}

exploreRpcErrors().catch(console.error)
