# 3. Making Transactions

The `near.transaction()` builder is the heart of `near-kit`. It provides a fluent, chainable API to construct and send transactions with one or more actions.

## The Fluent API

You start a transaction by specifying the **signer account ID**—the account that will sign the transaction and pay for the gas fees.

```typescript
near.transaction("signer.near") // 'signer.near' pays for this transaction
```

From there, you chain one or more **actions**.

### Atomic by Nature

All actions added to a single transaction are **atomic**. This is a critical concept: they either **all succeed** or **all fail** together. If any single action fails, the entire transaction is reverted, and no state is changed.

## Common Actions

Here are the most common actions you can add to a transaction.

### `transfer()`

Send NEAR tokens from the signer to a receiver.

```typescript
await near
  .transaction("alice.near")
  .transfer("bob.near", "10.5 NEAR") // Alice sends 10.5 NEAR to Bob
  .send()
```

### `functionCall()`

Call a method on a smart contract.

- `contractId`: The contract account to call.
- `methodName`: The method to execute.
- `args`: A JSON-serializable object of arguments.
- `options`: Optional `gas` and `attachedDeposit`.

```typescript
await near
  .transaction("alice.near")
  .functionCall(
    "market.near",
    "buy_nft",
    { token_id: "token-1" },
    {
      gas: "50 Tgas",
      attachedDeposit: "10 NEAR", // Alice attaches 10 NEAR to the call
    }
  )
  .send()
```

### `createAccount()`

Create a new NEAR account. This new account ID becomes the receiver of subsequent actions in the same transaction.

```typescript
await near.transaction("alice.near").createAccount("new-account.near").send()
```

### `deployContract()`

Deploy Wasm bytecode to an account, turning it into a smart contract.

```typescript
import { readFileSync } from "fs"

const contractWasm = readFileSync("path/to/contract.wasm")

await near
  .transaction("my-contract.near")
  .deployContract("my-contract.near", contractWasm)
  .send()
```

### `addKey()`

Add a new access key to an account.

- **Full Access Key:** Can sign any transaction on behalf of the account.
- **Function Call Key:** Limited to calling specific methods on a specific contract.

```typescript
import { generateKey } from "near-kit"

const newKey = generateKey()

// Add a full access key
await near
  .transaction("alice.near")
  .addKey(newKey.publicKey.toString(), { type: "fullAccess" })
  .send()

// Add a limited function call key
await near
  .transaction("alice.near")
  .addKey(newKey.publicKey.toString(), {
    type: "functionCall",
    receiverId: "some-contract.near", // The contract this key can call
    methodNames: ["some_method"], // The specific methods allowed
    allowance: "0.25 NEAR", // Optional allowance for gas/deposits
  })
  .send()
```

## Chaining Multiple Actions

The real power comes from combining actions. This example creates a new sub-account, transfers funds to it, and adds a full access key, all in one atomic transaction.

```typescript
const newAccount = `sub.${YOUR_ACCOUNT_ID}`
const newKey = generateKey()

const result = await near
  .transaction(YOUR_ACCOUNT_ID)
  .createAccount(newAccount)
  .transfer(newAccount, "5 NEAR")
  .addKey(newKey.publicKey.toString(), { type: "fullAccess" })
  .send()

console.log(`${newAccount} created successfully!`)
```

## What's Next?

Now that you can build any transaction, let's see how `near-kit` can make your contract interactions safer and more developer-friendly with TypeScript.

- **Next Guide:** [04 - Type-Safe Contracts](./04-type-safe-contracts.md)
