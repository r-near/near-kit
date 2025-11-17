# 5. Browser Wallets

While server-side applications use private keys, decentralized applications (dApps) in the browser need to interact with a user's wallet. `near-kit` provides simple adapters to integrate with the most popular wallet connection libraries.

## The Universal Code Pattern

A key design principle of `near-kit` is that your **business logic should not change** whether you are running on a server or in a browser. The way you build a transaction is always the same.

```typescript
// This function works anywhere!
async function addGuestbookMessage(
  near: Near,
  signerId: string,
  message: string
) {
  return await near
    .transaction(signerId)
    .functionCall(
      "guest-book.testnet",
      "add_message",
      { text: message },
      { gas: "30 Tgas" }
    )
    .send()
}
```

The only difference is how you initialize the `Near` class.

- **Server:** `new Near({ privateKey: '...' })`
- **Browser:** `new Near({ wallet: fromWalletAdapter(...) })`

## Integrating with Wallet Selector

`@near-wallet-selector` is a popular library for providing a modal that lets users choose from many different wallets.

### Step 1: Install Dependencies

```bash
npm install near-kit @near-wallet-selector/core @near-wallet-selector/modal-ui @near-wallet-selector/my-near-wallet
```

### Step 2: Set up Wallet Selector and `near-kit`

The `fromWalletSelector()` adapter makes integration seamless.

```typescript
import { Near, fromWalletSelector } from "near-kit"
import { setupWalletSelector } from "@near-wallet-selector/core"
import { setupModal } from "@near-wallet-selector/modal-ui"
import { setupMyNearWallet } from "@near-wallet-selector/my-near-wallet"

// 1. Set up Wallet Selector
const selector = await setupWalletSelector({
  network: "testnet",
  modules: [setupMyNearWallet()],
})

// 2. Set up the modal UI
const modal = setupModal(selector, {
  contractId: "guest-book.testnet",
})

// Show the modal when the user clicks a "Connect" button
// modal.show();

// 3. Listen for sign-in and initialize near-kit
selector.store.observable.subscribe(async (state) => {
  if (state.accounts.length > 0) {
    const wallet = await selector.wallet()
    const accountId = state.accounts.accountId

    // 4. Create a Near instance using the wallet adapter
    const near = new Near({
      network: "testnet",
      wallet: fromWalletSelector(wallet),
    })

    // 5. Now use the universal code pattern!
    await addGuestbookMessage(near, accountId, "Hello from my dApp!")
  }
})
```

When `addGuestbookMessage` is called, `near-kit` will automatically delegate the signing request to the user's connected wallet, prompting them to approve the transaction.

## What's Next?

A critical part of development is testing. Learn how to use the built-in Sandbox for fast, reliable, and free testing.

- **Next Guide:** [06 - Testing with Sandbox](./06-testing-with-sandbox.md)
