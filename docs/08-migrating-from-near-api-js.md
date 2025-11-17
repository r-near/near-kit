# 8. Migrating from near-api-js

If you're coming from `near-api-js`, you'll find that `near-kit` accomplishes the same tasks with a more modern and streamlined API. This guide highlights the key differences to help you migrate quickly.

## Philosophy Shift

- **`near-kit`**: Focuses on a simple, `fetch`-like developer experience with human-readable units and a fluent transaction builder.
- **`near-api-js`**: A more verbose, object-oriented library that often requires manual unit conversion.

## Side-by-Side Comparison

### Initialization

**near-api-js:**

```typescript
const { connect, keyStores } = require("near-api-js");

const keyStore = new keyStores.InMemoryKeyStore();
keyStore.setKey("testnet", "alice.testnet", ...);

const config = {
  networkId: "testnet",
  keyStore,
  nodeUrl: "https://rpc.testnet.near.org",
  walletUrl: "https://wallet.testnet.near.org",
};
const near = await connect(config);
const account = await near.account("alice.testnet");
```

**near-kit:**

```typescript
import { Near } from "near-kit"

const near = new Near({
  network: "testnet",
  privateKey: "ed25519:...",
})
```

### Viewing a Contract

**near-api-js:**

```typescript
const response = await account.viewFunction({
  contractId: "guest-book.testnet",
  methodName: "get_messages",
  args: {},
})
```

**near-kit:**

````typescript
const response = await near.view('guest-book.testnet', 'get_messages', {});```

### Sending NEAR

**near-api-js:**
```typescript
const { utils } = require("near-api-js");

await account.sendMoney(
  "bob.testnet",
  utils.format.parseNearAmount("10.5") // Manual unit conversion
);
````

**near-kit:**```typescript
await near.transaction('alice.testnet')
.transfer('bob.testnet', '10.5 NEAR') // Human-readable units
.send();

````

### Calling a Contract Method

**near-api-js:**
```typescript
await account.functionCall({
  contractId: "market.near",
  methodName: "buy_nft",
  args: { token_id: "token-1" },
  gas: "50000000000000", // Manual gas calculation
  attachedDeposit: utils.format.parseNearAmount("10"),
});
````

**near-kit:**

```typescript
await near
  .transaction("alice.testnet")
  .functionCall(
    "market.near",
    "buy_nft",
    { token_id: "token-1" },
    { gas: "50 Tgas", attachedDeposit: "10 NEAR" } // Human-readable units
  )
  .send()
```

### Multi-Action Transactions

**near-api-js:**

```typescript
const { transactions } = require("near-api-js")

await account.signAndSendTransaction({
  receiverId: "new-account.near",
  actions: [
    transactions.createAccount(),
    transactions.transfer(utils.format.parseNearAmount("5")),
    transactions.deployContract(contractWasm),
  ],
})
```

**near-kit:**

```typescript
await near
  .transaction("alice.testnet")
  .createAccount("new-account.near")
  .transfer("new-account.near", "5 NEAR")
  .deployContract("new-account.near", contractWasm)
  .send()
```

The `near-kit` approach is more readable, less error-prone due to human-readable units, and uses a fluent API that is easier to compose.
