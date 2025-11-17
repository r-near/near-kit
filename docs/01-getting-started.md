# 1. Getting Started with near-kit

Welcome to `near-kit`! This guide will walk you through the initial setup and your first real transaction, explaining each step along the way. By the end, you'll have a solid understanding of how to interact with the NEAR blockchain using this library.

## Philosophy

`near-kit` is designed to be simple and intuitive. If you know how to use a `fetch` API, you'll feel right at home. We handle the complex parts of blockchain interaction so you can focus on building your application.

## Prerequisites

1.  **Node.js or Bun:** This library works in both server-side and browser environments. For this guide, we'll use a Node.js/Bun environment.
2.  **A NEAR Testnet Account:** You'll need an account to sign and send transactions. If you don't have one, you can create one at [NEAR Wallets (Testnet)](https://wallet.testnet.near.org/).
3.  **A Private Key:** To sign transactions, you need a private key. After creating a testnet account, you can find your key in your browser's local storage or in the `~/.near-credentials/` directory if you've used `near-cli`.

## Installation

First, add `near-kit` to your project:

```bash
npm install near-kit
```

## Your First Script

Let's write a script that connects to the testnet, reads data from a contract, and then sends a transaction to it.

Create a file named `index.ts`:

```typescript
import { Near } from "near-kit"

// --- 1. Set up your credentials ---
// NOTE: Do not hardcode private keys in production! Use environment variables.
const YOUR_ACCOUNT_ID = "your-account.testnet"
const YOUR_PRIVATE_KEY = "ed25519:...." // Your testnet private key

async function main() {
  if (YOUR_ACCOUNT_ID === "your-account.testnet") {
    console.warn(
      "Please replace YOUR_ACCOUNT_ID and YOUR_PRIVATE_KEY in this example."
    )
    return
  }

  // --- 2. Initialize the client ---
  // Connect to the testnet and provide your private key for signing.
  const near = new Near({
    network: "testnet",
    privateKey: YOUR_PRIVATE_KEY,
  })

  console.log(`Initialized client for account [${YOUR_ACCOUNT_ID}]`)

  // --- 3. View a contract (read-only, no cost) ---
  // Let's check the total messages on the guest book contract.
  const totalMessages = await near.view(
    "guest-book.testnet",
    "total_messages",
    {}
  )
  console.log(
    `There are a total of ${totalMessages} messages on the guest book.`
  )

  // --- 4. Send a transaction (write) ---
  // Now, let's add our own message to the guest book.
  console.log("Sending a transaction to add a message...")

  const result = await near
    .transaction(YOUR_ACCOUNT_ID)
    .functionCall(
      "guest-book.testnet",
      "add_message",
      { text: "Hello from near-kit!" },
      { gas: "30 Tgas" } // Attach 30 Tgas to the call
    )
    .send() // Signs and sends the transaction

  console.log("✅ Transaction sent successfully!")
  console.log("Transaction Hash:", result.transaction.hash)
}

main().catch(console.error)
```

### Running the Script

Replace the placeholder credentials and run the file:

```bash
bun run index.ts
```

You should see output confirming the client initialization, the number of messages, and finally the success message with your transaction hash. Congratulations, you've just interacted with the NEAR blockchain!

## What's Next?

Now that you've sent your first transaction, let's dive into the core concepts that make `near-kit` powerful and easy to use.

- **Next Guide:** [02 - Core Concepts](./02-core-concepts.md)
