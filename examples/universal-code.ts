/**
 * Example: Universal Code - Same API for Server and Browser
 *
 * This example demonstrates how to write code once that works:
 * - Server-side with private keys
 * - Browser with wallet-selector
 * - Browser with HOT Connect
 *
 * The key insight: near-ts provides a unified API that abstracts
 * away the signing mechanism. Your transaction logic stays the same!
 */

import { Near, type WalletConnection } from "../src/index.js"

/**
 * Business logic function that works with ANY signing method
 * This is the same code whether running server-side or browser-side!
 */
async function addGuestbookMessage(
  near: Near,
  signerId: string,
  message: string,
) {
  console.log(`Adding message from ${signerId}: "${message}"`)

  const result = await near.call(
    "guest-book.testnet",
    "add_message",
    { text: message },
    { signerId, gas: "30 Tgas" },
  )

  console.log("Message added successfully!")
  return result
}

/**
 * Another business logic function - works everywhere!
 */
async function sendTokensAndCall(
  near: Near,
  signerId: string,
  receiverId: string,
  amount: string,
) {
  console.log(`Sending ${amount} NEAR to ${receiverId} and calling contract`)

  // Complex transaction with multiple actions
  const result = await near
    .transaction(signerId)
    .transfer(receiverId, amount)
    .functionCall(
      "contract.testnet",
      "on_receive",
      { sender: signerId },
      { gas: "50 Tgas" },
    )
    .send()

  console.log("Transaction completed!")
  return result
}

// ============================================================================
// Example 1: Server-side usage (Node.js with private key)
// ============================================================================
async function serverSideExample() {
  console.log("\n=== Server-side Example ===\n")

  const near = new Near({
    network: "testnet",
    privateKey: process.env.NEAR_PRIVATE_KEY || "ed25519:...",
    signerId: "bot.testnet",
  })

  // Use the same business logic functions!
  await addGuestbookMessage(near, "bot.testnet", "Hello from server!")
  await sendTokensAndCall(near, "bot.testnet", "receiver.testnet", "1 NEAR")
}

// ============================================================================
// Example 2: Browser usage with wallet-selector
// ============================================================================
async function browserWalletSelectorExample(wallet: any) {
  console.log("\n=== Browser (Wallet Selector) Example ===\n")

  // Import adapter (you would do this at the top in real code)
  const { fromWalletSelector } = await import("../src/index.js")

  const near = new Near({
    network: "testnet",
    wallet: fromWalletSelector(wallet),
  })

  // Get user's account
  const accounts = await wallet.getAccounts()
  const signerId = accounts[0].accountId

  // Use the SAME business logic functions!
  await addGuestbookMessage(near, signerId, "Hello from browser wallet!")
  await sendTokensAndCall(near, signerId, "receiver.testnet", "0.5 NEAR")
}

// ============================================================================
// Example 3: Browser usage with HOT Connect
// ============================================================================
async function browserHotConnectExample(connector: any) {
  console.log("\n=== Browser (HOT Connect) Example ===\n")

  // Import adapter (you would do this at the top in real code)
  const { fromHotConnect } = await import("../src/index.js")

  const near = new Near({
    network: "mainnet",
    wallet: fromHotConnect(connector),
  })

  // Get user's account
  const wallet = await connector.wallet()
  const accounts = await wallet.getAccounts()
  const signerId = accounts[0].accountId

  // Use the SAME business logic functions!
  await addGuestbookMessage(near, signerId, "Hello from HOT wallet!")
  await sendTokensAndCall(near, signerId, "receiver.near", "1 NEAR")
}

// ============================================================================
// Example 4: Abstract wallet interface for maximum flexibility
// ============================================================================
async function universalExample(config: {
  network: string
  wallet?: WalletConnection
  privateKey?: string
  signerId?: string
}) {
  console.log("\n=== Universal Example ===\n")

  // Create client - works with wallet OR private key
  const near = new Near(config)

  // Determine signer ID from wallet or config
  const signerId = config.signerId || "default.testnet"

  // Business logic - completely agnostic to signing method!
  await addGuestbookMessage(near, signerId, "Hello from anywhere!")

  // This is the power of near-ts: write once, run anywhere
  console.log("✅ Same code works server-side and browser-side!")
}

// Run examples
async function main() {
  // Note: In real usage, you'd only run one of these based on your environment

  // Server-side
  if (process.env.NEAR_PRIVATE_KEY) {
    await serverSideExample()
  } else {
    console.log("Set NEAR_PRIVATE_KEY to run server-side example")
  }

  // Universal approach
  await universalExample({
    network: "testnet",
    privateKey: process.env.NEAR_PRIVATE_KEY,
    signerId: "test.testnet",
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error)
}

export {
  addGuestbookMessage,
  sendTokensAndCall,
  serverSideExample,
  browserWalletSelectorExample,
  browserHotConnectExample,
  universalExample,
}
