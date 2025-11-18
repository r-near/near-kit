/**
 * Quickstart - Essential NEAR operations
 *
 * Covers: view, call, send, type-safe contracts, transaction builder
 * Run: bun run examples/quickstart.ts
 */

import { type Contract, Near, type PrivateKey } from "../src/index.js"

const ACCOUNT_ID = process.env["NEAR_ACCOUNT_ID"] || "your-account.testnet"
const PRIVATE_KEY = (process.env["NEAR_PRIVATE_KEY"] ||
  "ed25519:...") as PrivateKey

// ============================================================================
// 1. View contract data (read-only, no keys needed)
// ============================================================================

async function viewExample() {
  const near = new Near({ network: "testnet" })

  const messages = await near.view(
    "guestbook.near-examples.testnet",
    "get_messages",
    {},
  )
  console.log("Messages:", messages)

  const balance = await near.getBalance("alice.testnet")
  console.log("Balance:", balance)
}

// ============================================================================
// 2. Call contract method (requires signing)
// ============================================================================

async function callExample() {
  const near = new Near({
    network: "testnet",
    privateKey: PRIVATE_KEY,
    defaultSignerId: ACCOUNT_ID,
  })

  const result = await near.call(
    "guestbook.near-examples.testnet",
    "add_message",
    { text: "Hello from near-kit" },
    { gas: "30 Tgas" },
  )

  console.log("Transaction:", result.transaction?.hash)
}

// ============================================================================
// 3. Send NEAR tokens
// ============================================================================

async function sendExample() {
  const near = new Near({
    network: "testnet",
    privateKey: PRIVATE_KEY,
    defaultSignerId: ACCOUNT_ID,
  })

  const result = await near.send("friend.testnet", "1 NEAR")
  console.log("Sent:", result.transaction?.hash)
}

// ============================================================================
// 4. Type-safe contracts
// ============================================================================

type GuestbookMethods = {
  view: {
    get_messages(): Promise<Array<{ sender: string; text: string }>>
    total_messages(): Promise<number>
  }
  call: {
    add_message: (args: { text: string }) => Promise<void>
  }
}

async function typeSafeExample() {
  const near = new Near({
    network: "testnet",
    privateKey: PRIVATE_KEY,
    defaultSignerId: ACCOUNT_ID,
  })

  const guestbook: Contract<GuestbookMethods> = near.contract(
    "guestbook.near-examples.testnet",
  )

  // Full TypeScript autocomplete and type checking
  const total = await guestbook.view.total_messages()
  console.log("Total:", total)

  await guestbook.call.add_message({ text: "Type-safe!" }, { gas: "30 Tgas" })
}

// ============================================================================
// 5. Transaction builder (multiple actions)
// ============================================================================

async function transactionBuilderExample() {
  const near = new Near({
    network: "testnet",
    privateKey: PRIVATE_KEY,
    defaultSignerId: ACCOUNT_ID,
  })

  const result = await near
    .transaction(ACCOUNT_ID)
    .transfer("alice.testnet", "0.5 NEAR")
    .functionCall(
      "guestbook.near-examples.testnet",
      "add_message",
      { text: "Batch transaction" },
      { gas: "30 Tgas" },
    )
    .send()

  console.log("Batch:", result.transaction?.hash)
}

// ============================================================================
// Run examples
// ============================================================================

async function main() {
  console.log("Quickstart Examples\n")

  await viewExample()

  if (ACCOUNT_ID === "your-account.testnet") {
    console.log(
      "\nSet NEAR_ACCOUNT_ID and NEAR_PRIVATE_KEY to run write examples",
    )
    return
  }

  await callExample()
  await typeSafeExample()
  await transactionBuilderExample()
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error)
}

export {
  callExample,
  sendExample,
  transactionBuilderExample,
  typeSafeExample,
  viewExample,
}
