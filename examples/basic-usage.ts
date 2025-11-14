/**
 * Basic usage examples for @near/client
 */

import { Near } from "../src/index.js"

// Example 1: Simple read operation
async function exampleView() {
  const near = new Near({ network: "testnet" })

  // View a contract method (no gas required)
  const result = await near.view("example.testnet", "get_status", {})

  console.log("Contract status:", result)
}

// Example 2: Check account balance
async function exampleBalance() {
  const near = new Near({ network: "testnet" })

  const balance = await near.getBalance("example.testnet")
  console.log("Account balance:", balance)

  const exists = await near.accountExists("example.testnet")
  console.log("Account exists:", exists)
}

// Example 3: Type-safe contract interface
interface MyContract {
  view: {
    get_balance(args: { account_id: string }): Promise<string>
    get_info(): Promise<{ name: string; version: string }>
  }
  call: {
    transfer(args: { to: string; amount: string }): Promise<void>
    set_data(args: { key: string; value: unknown }): Promise<boolean>
  }
}

async function exampleTypeSafeContract() {
  const near = new Near({ network: "testnet" })

  const contract = near.contract<MyContract>("example.testnet")

  // Fully typed view methods
  const balance = await contract.view.get_balance({
    account_id: "alice.testnet",
  })
  console.log("Balance:", balance)

  const info = await contract.view.get_info()
  console.log("Contract info:", info)

  // Fully typed call methods (would require signing)
  // await contract.call.transfer(
  //   { to: 'bob.testnet', amount: '100' },
  //   { gas: '30 Tgas', attachedDeposit: '1' }
  // );
}

// Example 4: Batch operations
async function exampleBatch() {
  const near = new Near({ network: "testnet" })

  const [balance, status, exists] = await near.batch(
    near.getBalance("alice.testnet"),
    near.getStatus(),
    near.accountExists("bob.testnet"),
  )

  console.log("Batch results:", { balance, status, exists })
}

// Example 5: Network status
async function exampleNetworkStatus() {
  const near = new Near({ network: "testnet" })

  const status = await near.getStatus()
  console.log("Network status:", status)
}

// Run examples
async function _main() {
  console.log("=== NEAR Client Library Examples ===\n")

  try {
    console.log("1. View operation:")
    await exampleView()
    console.log()

    console.log("2. Check balance:")
    await exampleBalance()
    console.log()

    console.log("3. Type-safe contract:")
    await exampleTypeSafeContract()
    console.log()

    console.log("4. Batch operations:")
    await exampleBatch()
    console.log()

    console.log("5. Network status:")
    await exampleNetworkStatus()
    console.log()
  } catch (error) {
    console.error("Error:", error)
  }
}

// Uncomment to run examples
// main();
