/**
 * Example: Using near-ts with @near-wallet-selector
 *
 * This example demonstrates how to integrate near-ts with NEAR Wallet Selector
 * to enable browser wallet support in your dApp.
 *
 * Install dependencies:
 * npm install @near-wallet-selector/core @near-wallet-selector/modal-ui
 * npm install @near-wallet-selector/my-near-wallet
 */

import { fromWalletSelector, Near } from "../src/index.js"

// Uncomment to use in a real project:
// import { setupWalletSelector } from "@near-wallet-selector/core"
// import { setupModal } from "@near-wallet-selector/modal-ui"
// import { setupMyNearWallet } from "@near-wallet-selector/my-near-wallet"

async function main() {
  // 1. Setup wallet selector with your preferred wallets
  const selector = await (setupWalletSelector as any)({
    network: "testnet",
    modules: [
      // Add wallet modules you want to support
      (setupMyNearWallet as any)(),
      // setupMeteorWallet(),
      // setupHereWallet(),
      // etc.
    ],
  })

  // 2. Setup modal UI (optional but recommended)
  const modal = (setupModal as any)(selector, {
    contractId: "guest-book.testnet",
  })

  // 3. Show modal to let user select and connect their wallet
  modal.show()

  // 4. Wait for user to sign in
  const unsubscribe = selector.store.observable.subscribe(
    async (state: any) => {
      if (state.accounts.length > 0) {
        console.log("User signed in:", state.accounts[0].accountId)

        // 5. Get the wallet instance
        const wallet = await selector.wallet()

        // 6. Create Near client with wallet adapter
        const near = new Near({
          network: "testnet",
          wallet: fromWalletSelector(wallet),
        })

        // 7. Now use near-ts API - same as server-side!
        // The wallet will handle signing and sending

        // Call a contract method
        const result = await near.call(
          "guest-book.testnet",
          "add_message",
          { text: "Hello from near-ts!" },
          { gas: "30 Tgas" },
        )
        console.log("Message added:", result)

        // Send NEAR tokens
        await near.send("receiver.testnet", "1 NEAR")

        // Use transaction builder for complex transactions
        await near
          .transaction(state.accounts[0].accountId)
          .transfer("receiver.testnet", "0.5 NEAR")
          .functionCall("contract.testnet", "method", { arg: "value" })
          .send()

        unsubscribe()
      }
    },
  )
}

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error)
}

export { main }
