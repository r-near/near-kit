# Manual Wallet Testing Guide

This guide explains how to test the wallet integration in a real browser environment with actual wallets.

## Quick Start

### Option 1: Test with Wallet Selector

1. **Create a simple HTML page:**

```html
<!DOCTYPE html>
<html>
<head>
  <title>near-ts Wallet Test</title>
</head>
<body>
  <h1>near-ts Wallet Integration Test</h1>
  <button id="connect">Connect Wallet</button>
  <button id="sendTokens" disabled>Send 0.1 NEAR</button>
  <button id="callContract" disabled>Call Contract</button>
  <div id="status"></div>

  <script type="module">
    import { setupWalletSelector } from "https://esm.sh/@near-wallet-selector/core"
    import { setupModal } from "https://esm.sh/@near-wallet-selector/modal-ui"
    import { setupMyNearWallet } from "https://esm.sh/@near-wallet-selector/my-near-wallet"
    import { Near, fromWalletSelector } from "./path/to/near-ts/dist/index.js"

    let near

    // Setup wallet selector
    const selector = await setupWalletSelector({
      network: "testnet",
      modules: [setupMyNearWallet()]
    })

    const modal = setupModal(selector, {
      contractId: "guestbook.near-examples.testnet"
    })

    // Connect button
    document.getElementById("connect").onclick = async () => {
      modal.show()
    }

    // Listen for wallet connection
    selector.store.observable.subscribe(async (state) => {
      if (state.accounts.length > 0) {
        document.getElementById("status").textContent =
          `Connected: ${state.accounts[0].accountId}`

        // Enable buttons
        document.getElementById("sendTokens").disabled = false
        document.getElementById("callContract").disabled = false

        // Create Near client with wallet
        const wallet = await selector.wallet()
        near = new Near({
          network: "testnet",
          wallet: fromWalletSelector(wallet)
        })
      }
    })

    // Send tokens button
    document.getElementById("sendTokens").onclick = async () => {
      try {
        document.getElementById("status").textContent = "Sending..."
        await near.send("receiver.testnet", "0.1 NEAR")
        document.getElementById("status").textContent = "✅ Sent!"
      } catch (error) {
        document.getElementById("status").textContent = `❌ Error: ${error.message}`
      }
    }

    // Call contract button
    document.getElementById("callContract").onclick = async () => {
      try {
        document.getElementById("status").textContent = "Calling contract..."
        await near.call("guestbook.near-examples.testnet", "add_message", {
          text: "Hello from near-ts!"
        }, { gas: "30 Tgas" })
        document.getElementById("status").textContent = "✅ Message added!"
      } catch (error) {
        document.getElementById("status").textContent = `❌ Error: ${error.message}`
      }
    }
  </script>
</body>
</html>
```

2. **Serve the HTML file:**

```bash
# Using Python
python3 -m http.server 8000

# Using Node.js
npx serve .

# Using Bun
bun --hot index.html
```

3. **Open in browser:** `http://localhost:8000`

4. **Test the flow:**
   - Click "Connect Wallet"
   - Select your wallet (MyNearWallet, Meteor, etc.)
   - Authorize the connection
   - Try sending tokens or calling a contract

### Option 2: Test with HOT Connect

```html
<!DOCTYPE html>
<html>
<head>
  <title>near-ts HOT Connect Test</title>
</head>
<body>
  <h1>near-ts HOT Connect Test</h1>
  <button id="connect">Connect Wallet</button>
  <button id="sendTokens" disabled>Send 0.1 NEAR</button>
  <div id="status"></div>

  <script type="module">
    import { NearConnector } from "https://esm.sh/@hot-labs/near-connect"
    import { Near, fromHotConnect } from "./path/to/near-ts/dist/index.js"

    let near

    // Setup HOT Connect
    const connector = new NearConnector({
      network: "testnet"
    })

    // Listen for wallet events
    connector.on("wallet:signIn", async (event) => {
      document.getElementById("status").textContent =
        `Connected: ${event.accounts[0].accountId}`

      document.getElementById("sendTokens").disabled = false

      // Create Near client with wallet
      near = new Near({
        network: "testnet",
        wallet: fromHotConnect(connector)
      })
    })

    connector.on("wallet:signOut", () => {
      document.getElementById("status").textContent = "Disconnected"
      document.getElementById("sendTokens").disabled = true
    })

    // Connect button - HOT Connect will show its own modal
    document.getElementById("connect").onclick = () => {
      // HOT Connect handles the connection UI
      document.getElementById("status").textContent = "Opening wallet selector..."
    }

    // Send tokens button
    document.getElementById("sendTokens").onclick = async () => {
      try {
        document.getElementById("status").textContent = "Sending..."
        await near.send("receiver.testnet", "0.1 NEAR")
        document.getElementById("status").textContent = "✅ Sent!"
      } catch (error) {
        document.getElementById("status").textContent = `❌ Error: ${error.message}`
      }
    }
  </script>
</body>
</html>
```

## Testing Checklist

### Basic Functionality
- [ ] Wallet connection works
- [ ] Account detection works
- [ ] Wallet modal/UI appears correctly

### Transaction Types
- [ ] Simple transfer (`near.send()`)
- [ ] Function call (`near.call()`)
- [ ] Multi-action transaction (`near.transaction()...`)

### Error Handling
- [ ] User rejects transaction
- [ ] Insufficient balance
- [ ] Invalid contract/method
- [ ] Network errors

### Edge Cases
- [ ] Multiple accounts in wallet
- [ ] Switching accounts
- [ ] Disconnecting and reconnecting
- [ ] Page refresh with active connection

## Example Test Scenarios

### Scenario 1: Send NEAR Tokens

```javascript
// This should work with ANY wallet!
const near = new Near({
  network: "testnet",
  wallet: fromWalletSelector(wallet) // or fromHotConnect(connector)
})

await near.send("receiver.testnet", "1 NEAR")
```

**Expected:** Wallet prompts user to approve, transaction succeeds, balance updates.

### Scenario 2: Call Contract Method

```javascript
await near.call(
  "guestbook.near-examples.testnet",
  "add_message",
  { text: "Hello from near-ts!" },
  { gas: "30 Tgas" }
)
```

**Expected:** Wallet prompts user, transaction executes, state changes.

### Scenario 3: Complex Multi-Action Transaction

```javascript
await near.transaction(accountId)
  .transfer("receiver.testnet", "0.5 NEAR")
  .functionCall(
    "contract.testnet",
    "method",
    { arg: "value" },
    { gas: "50 Tgas", attachedDeposit: "0.1 NEAR" }
  )
  .send()
```

**Expected:** Wallet shows both actions, user approves, both actions execute.

### Scenario 4: Universal Code Pattern

```javascript
// Write once, works with wallet OR private key
async function addGuestbookMessage(near, signerId, message) {
  return await near.call(
    "guestbook.near-examples.testnet",
    "add_message",
    { text: message },
    { signerId, gas: "30 Tgas" }
  )
}

// Browser with wallet
const nearBrowser = new Near({
  network: "testnet",
  wallet: fromWalletSelector(wallet)
})
await addGuestbookMessage(nearBrowser, "alice.testnet", "Hello!")

// Server with private key
const nearServer = new Near({
  network: "testnet",
  privateKey: process.env.PRIVATE_KEY,
  signerId: "bot.testnet"
})
await addGuestbookMessage(nearServer, "bot.testnet", "Hello!")
```

**Expected:** Same code works in both environments!

## Supported Wallets

### Via Wallet Selector
- MyNearWallet
- Meteor Wallet
- HERE Wallet
- Sender Wallet
- Nightly Wallet
- Ledger
- And more...

### Via HOT Connect
- HOT Wallet
- Meteor Wallet
- Intear Wallet
- MyNearWallet
- Any WalletConnect wallet
- And more...

## Troubleshooting

### Wallet doesn't connect
- Check network matches (testnet vs mainnet)
- Verify wallet extension is installed
- Try different wallet

### Transactions fail
- Check account has sufficient balance
- Verify gas amount is sufficient
- Check contract/method exists
- Review wallet console for errors

### TypeScript errors
- Ensure near-ts types are properly imported
- Check wallet types match expected interface
- Verify all required parameters are provided

## Performance Testing

### Load Test
Test with many rapid transactions:

```javascript
for (let i = 0; i < 10; i++) {
  await near.call("contract.testnet", "increment", {})
  console.log(`Transaction ${i + 1} complete`)
}
```

**Expected:** All transactions complete, wallet handles queue properly.

### Concurrent Actions
Test multiple operations:

```javascript
await Promise.all([
  near.view("contract.testnet", "get_value", {}),
  near.view("contract.testnet", "get_balance", { account_id: "alice.testnet" }),
  near.view("contract.testnet", "get_status", {})
])
```

**Expected:** All view calls succeed (these don't use wallet).

## Reporting Issues

If you find issues during testing:

1. Note the wallet used (MyNearWallet, Meteor, etc.)
2. Capture the error message/console output
3. Note the transaction that failed
4. Check if it works with a different wallet
5. Report to: https://github.com/r-near/near-ts/issues

Include:
- Browser and version
- Wallet and version
- Network (testnet/mainnet)
- Code snippet that reproduces the issue
- Expected vs actual behavior
