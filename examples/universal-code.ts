/**
 * Universal Code Pattern
 *
 * Write once, run anywhere: same API works in server-side (Node.js) and
 * browser (wallet) environments. The signing method is abstracted away.
 */

import {
  fromHotConnect,
  Near,
  type PrivateKey,
  type WalletConnection,
} from "../src/index.js"

// External wallet types
// biome-ignore lint/suspicious/noExplicitAny: External library type
type NearConnectorType = { wallet(): Promise<any> }

// ============================================================================
// Business Logic - Works in ANY environment
// ============================================================================

async function addGuestbookMessage(
  near: Near,
  signerId: string,
  message: string,
) {
  return await near.call(
    "guestbook.near-examples.testnet",
    "add_message",
    { text: message },
    { signerId, gas: "30 Tgas" },
  )
}

async function batchTransfer(near: Near, signerId: string) {
  return await near
    .transaction(signerId)
    .transfer("alice.testnet", "1 NEAR")
    .transfer("bob.testnet", "0.5 NEAR")
    .send()
}

// ============================================================================
// Environment 1: Server-side (Node.js with private key)
// ============================================================================

async function serverExample() {
  const near = new Near({
    network: "testnet",
    privateKey: (process.env["NEAR_PRIVATE_KEY"] ||
      "ed25519:...") as PrivateKey,
    defaultSignerId: "bot.testnet",
  })

  await addGuestbookMessage(near, "bot.testnet", "Hello from server")
  await batchTransfer(near, "bot.testnet")
}

// ============================================================================
// Environment 2: Browser with NEAR Connect
// ============================================================================

async function browserNearConnect(connector: NearConnectorType) {
  const near = new Near({
    network: "mainnet",
    wallet: fromHotConnect(connector),
  })

  const wallet = await connector.wallet()
  const accounts = await wallet.getAccounts()
  const signerId = accounts[0].accountId

  await addGuestbookMessage(near, signerId, "Hello from browser")
  await batchTransfer(near, signerId)
}

// ============================================================================
// Universal Factory Pattern
// ============================================================================

type NearConfig =
  | { env: "server"; privateKey: PrivateKey; signerId: string }
  | { env: "browser"; wallet: WalletConnection }

function createNear(config: NearConfig): Near {
  if (config.env === "server") {
    return new Near({
      network: "testnet",
      privateKey: config.privateKey,
      defaultSignerId: config.signerId,
    })
  } else {
    return new Near({
      network: "testnet",
      wallet: config.wallet,
    })
  }
}

async function universalExample(config: NearConfig) {
  const near = createNear(config)
  const signerId = config.env === "server" ? config.signerId : "user.testnet"

  // Same business logic regardless of environment
  await addGuestbookMessage(near, signerId, "Universal code!")
  await batchTransfer(near, signerId)
}

// ============================================================================
// Run examples
// ============================================================================

async function main() {
  console.log("Universal Code Pattern\n")

  if (process.env["NEAR_PRIVATE_KEY"]) {
    console.log("Running server-side example...")
    await serverExample()
  } else {
    console.log("Set NEAR_PRIVATE_KEY to run server-side example")
  }

  console.log("\nKey insight: Same business logic works everywhere!")
  console.log("- Server: uses private key")
  console.log("- Browser: uses wallet")
  console.log("- Code: identical API")
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error)
}

export {
  addGuestbookMessage,
  batchTransfer,
  serverExample,
  browserNearConnect,
  universalExample,
}
