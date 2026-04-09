/**
 * Browser Wallet Integration
 *
 * Connect to user wallets using NEAR Connect.
 * Same near-kit API works in browser and server.
 *
 * Setup:
 *   npm install @hot-labs/near-connect
 */

import { fromHotConnect, Near } from "../src/index.js"

// Type definitions for external libraries
// biome-ignore lint/suspicious/noExplicitAny: External library type
declare const NearConnector: any

type WalletSignInEvent = {
  accounts: Array<{ accountId: string; publicKey: string }>
}

// ============================================================================
// NEAR Connect
// ============================================================================

async function nearConnectExample() {
  // biome-ignore lint/suspicious/noExplicitAny: External library type
  const connector = new (NearConnector as any)({
    network: "mainnet",
    walletConnect: {
      projectId: "your-walletconnect-project-id",
      metadata: {
        name: "My dApp",
        description: "Built with near-kit",
        url: "https://myapp.com",
        icons: ["https://myapp.com/icon.png"],
      },
    },
  })

  connector.on("wallet:signIn", async (event: WalletSignInEvent) => {
    const accountId = event.accounts[0]?.accountId
    if (!accountId) return
    console.log("Connected:", accountId)

    const near = new Near({
      network: "mainnet",
      wallet: fromHotConnect(connector),
    })

    // Same API as server-side
    const balance = await near.view("token.near", "ft_balance_of", {
      account_id: accountId,
    })
    console.log("Balance:", balance)

    await near.call(
      "guestbook.near",
      "add_message",
      { text: "Hello!" },
      { signerId: accountId, gas: "30 Tgas" },
    )

    await near.send("friend.near", "1 NEAR")
  })

  connector.on("wallet:signOut", () => {
    console.log("Disconnected")
  })

  // In UI: <button onClick={() => connector.show()}>Connect</button>
  console.log("NEAR Connect ready")
}

// ============================================================================
// Run example
// ============================================================================

async function main() {
  console.log("Browser Wallet Integration\n")
  console.log("NEAR Connect: Modern, iframe-isolated, WalletConnect v2")
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}

export { nearConnectExample }
