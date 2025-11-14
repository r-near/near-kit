/**
 * Example: Using near-ts with HOT Connect
 *
 * This example demonstrates how to integrate near-ts with HOT Connect,
 * the new recommended wallet connector for NEAR that provides:
 * - Secure isolation of wallet code via iframes
 * - Automatic wallet updates without dApp maintenance
 * - Modern authentication flows
 *
 * Install dependencies:
 * npm install @hot-labs/near-connect
 */

import { fromHotConnect, Near } from "../src/index.js"

// Uncomment to use in a real project:
// import { NearConnector } from "@hot-labs/near-connect"

async function main() {
  // 1. Create HOT Connect connector
  const connector = new (NearConnector as any)({
    network: "mainnet",

    // Optional: WalletConnect configuration
    walletConnect: {
      projectId: "your-project-id",
      metadata: {
        name: "Your dApp Name",
        description: "Your dApp Description",
        url: "https://yourdapp.com",
        icons: ["https://yourdapp.com/icon.png"],
      },
    },
  })

  // 2. Listen for wallet events
  connector.on("wallet:signIn", async (event: any) => {
    console.log("Wallet connected:", event.accounts[0].accountId)

    // 3. Create Near client with HOT Connect adapter
    const near = new Near({
      network: "mainnet",
      wallet: fromHotConnect(connector),
    })

    // 4. Use near-ts API - same as server-side!
    // The wallet will handle signing and sending

    // Call a contract method
    const result = await near.call(
      "contract.near",
      "get_balance",
      { account_id: event.accounts[0].accountId },
      { gas: "30 Tgas" },
    )
    console.log("Balance:", result)

    // Send NEAR tokens
    await near.send("receiver.near", "1 NEAR")

    // Use transaction builder for complex transactions
    await near
      .transaction(event.accounts[0].accountId)
      .transfer("receiver.near", "0.5 NEAR")
      .functionCall(
        "contract.near",
        "method",
        { arg: "value" },
        { gas: "50 Tgas", attachedDeposit: "0.1 NEAR" },
      )
      .send()
  })

  connector.on("wallet:signOut", () => {
    console.log("Wallet disconnected")
  })

  // 3. Show wallet connection UI
  // This will display a modal for the user to select their wallet
  // The connector handles the UI automatically
  console.log("HOT Connect is ready. User can now connect their wallet.")

  // In a browser environment, you might trigger connection via a button:
  // <button onClick={() => connector.show()}>Connect Wallet</button>
}

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error)
}

export { main }
