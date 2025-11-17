# 2. Core Concepts

Understanding a few core concepts will help you get the most out of `near-kit`.

## The `Near` Class

The `Near` class is the main entry point for all interactions. You initialize it once with your configuration.

```typescript
import { Near } from "near-kit"

// Connect to testnet with a private key
const near = new Near({
  network: "testnet",
  privateKey: "ed25519:...",
})
```

The constructor is flexible and can be configured for different networks, key management strategies, and environments.

## View vs. Call: The Two Types of Interaction

On any blockchain, there are two fundamental types of operations: reading data and writing data. `near-kit` makes this distinction clear with `view()` and `call()`/`transaction()`.

### `near.view()` - Reading Data

- **Read-only:** It cannot change anything on the blockchain.
- **Free:** It costs no gas.
- **No Signature:** It doesn't require a private key.
- **Synchronous:** It returns the data you asked for directly.

Use `near.view()` whenever you want to query a contract's state.

```typescript
const messages = await near.view(
  "guestbook.near-examples.testnet",
  "get_messages",
  {}
)
```

### `near.transaction()` - Writing Data

- **State-Changing:** This is for any action that modifies the blockchain (sending tokens, calling a change method, etc.).
- **Costs Gas:** It requires the signer to pay a transaction fee.
- **Requires Signature:** It must be signed by a private key or a wallet.
- **Asynchronous:** It returns a transaction receipt, and the final result happens on-chain.

Use `near.transaction()` for any operation that writes data.

```typescript
const result = await near
  .transaction("alice.testnet")
  .functionCall(
    "guestbook.near-examples.testnet",
    "add_message",
    { text: "Hello!" }
  )
  .send()
```

## Human-Readable Units

One of the biggest sources of bugs in blockchain development is unit conversion. NEAR's base unit is the **yoctoNEAR** (10<sup>-24</sup> NEAR), which often involves counting lots of zeros.

`near-kit` solves this by letting you use human-readable strings. The library handles the conversion for you.

### Amounts

- **Use `"10.5 NEAR"` for token amounts.**
- **Use `"1 yocto"` for the smallest unit, often required for storage deposits.**

```typescript
// Send 10.5 NEAR
await near.transaction(sender).transfer(receiver, "10.5 NEAR").send()

// Call a function and attach exactly 1 yoctoNEAR
await near
  .transaction(sender)
  .functionCall(
    contract,
    "method",
    {},
    {
      attachedDeposit: "1 yocto",
    }
  )
  .send()
```

### Gas

- **Use `"30 Tgas"` for gas amounts.** (Tgas = Tera-gas = 10<sup>12</sup> gas units).

```typescript
await near
  .transaction(sender)
  .functionCall(
    contract,
    "method",
    {},
    {
      gas: "50 Tgas", // Attach 50 Tgas
    }
  )
  .send()
```

This approach makes your code more readable and less error-prone.

## What's Next?

Now that you understand the basic building blocks, let's take a closer look at how to construct complex transactions.

- **Next Guide:** [03 - Making Transactions](./03-making-transactions.md)
