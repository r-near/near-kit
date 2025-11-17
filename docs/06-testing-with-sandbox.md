# 6. Testing with Sandbox

Testing blockchain applications can be slow and expensive. You have to wait for transaction finality on a public testnet, and managing test accounts and state is difficult.

`near-kit` solves this with a built-in **Sandbox**: a complete, local NEAR blockchain that runs on your machine.

## Benefits of Sandbox

- **Instant Finality:** Transactions are confirmed instantly.
- **Free:** All operations are free. No need for a testnet faucet.
- **Isolated:** Your tests run in a clean, predictable environment without interference from other developers.
- **Easy Setup:** Start and stop the entire blockchain with just two lines of code.

## System Requirements

The Sandbox runs a real NEAR node, which requires a high file descriptor limit.

- **Check your limit:** `ulimit -n`
- **If the value is less than 65535, you must increase it.**

Please see the [Sandbox Setup Instructions](../src/sandbox/README.md) for platform-specific commands (macOS, Linux, Docker).

## Usage with a Test Framework

The Sandbox is perfect for integration tests. Here’s how to use it with `bun:test`, but the pattern works for Jest, Vitest, or any other framework.

Create a test file like `tests/integration.test.ts`:

```typescript
import { Near } from "near-kit"
import { Sandbox } from "near-kit/sandbox"
import { beforeAll, afterAll, test, expect } from "bun:test"

// These tests can take a moment to initialize the sandbox
describe("My Application Tests", () => {
  let sandbox: Sandbox
  let near: Near

  // 1. Start the Sandbox before all tests
  beforeAll(async () => {
    sandbox = await Sandbox.start()
    near = new Near({ network: sandbox })
    console.log("Sandbox started for tests.")
  }, 120000) // Increase timeout for the first-time binary download

  // 2. Stop the Sandbox after all tests
  afterAll(async () => {
    if (sandbox) {
      await sandbox.stop()
      console.log("Sandbox stopped.")
    }
  })

  // 3. Write your tests!
  test("should create an account and transfer funds", async () => {
    const newAccountId = `test-account.${sandbox.rootAccount.id}`

    // The root account is available via sandbox.rootAccount
    // Its key is automatically loaded into the Near instance.
    const result = await near
      .transaction(sandbox.rootAccount.id)
      .createAccount(newAccountId)
      .transfer(newAccountId, "100 NEAR")
      .send()

    expect(result.final_execution_status).toContain("EXECUTED")

    // Verify the result
    const balance = await near.getBalance(newAccountId)
    expect(balance).toBe("100.00") // getBalance returns formatted NEAR
  })

  test("should call a smart contract", async () => {
    // In a real test, you would first deploy your contract here.
    // For this example, we'll assume a contract is at 'my-contract.test.near'
    // This is just a placeholder to show the pattern.
    // await near.transaction(sandbox.rootAccount.id)
    //   .functionCall('my-contract.test.near', 'some_method', {})
    //   .send();
  })
})
```

### The `sandbox` Object

The `Sandbox.start()` method returns an object with everything you need:

- `sandbox.rpcUrl`: The RPC endpoint for this sandbox instance.
- `sandbox.networkId`: Always `'localnet'`.
- `sandbox.rootAccount.id`: The ID of the pre-funded root account (e.g., `test.near`).
- `sandbox.rootAccount.secretKey`: The private key for the root account.

When you pass the `sandbox` object to `new Near()`, `near-kit` automatically configures the RPC connection and loads the root account's key into an in-memory keystore, making it ready to sign transactions immediately.

- **Next Guide:** [07 - Handling Errors](./07-error-handling.md)
