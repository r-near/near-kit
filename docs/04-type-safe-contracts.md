# 4. Type-Safe Contracts

While `near.view()` and `near.call()` are powerful, they are not type-safe out of the box. You can pass any method name or arguments, and TypeScript won't catch mistakes.

`near-kit` solves this with a `near.contract<T>()` interface that gives you full type safety and IDE autocompletion for your contract interactions.

## The Problem: No Type Safety

Consider this standard `near.call()`:

```typescript
// What if the method is misspelled? 'nft_tranfer' instead of 'nft_transfer'?
// What if 'token_id' should be a number instead of a string?
// TypeScript can't help you here.
await near.call("nft.near", "nft_tranfer", {
  reciever_id: "bob.near", // Another typo!
  token_id: "token-1",
})
```

These errors will only be discovered at runtime, which is slow and frustrating.

## The Solution: `near.contract<T>()`

With `near.contract()`, you define a TypeScript `interface` that describes your contract's methods. `near-kit` then uses this interface to create a fully typed contract object.

### Step 1: Define Your Contract Interface

Create an interface that matches the methods on your smart contract. Separate them into `view` (read-only) and `call` (change) methods.

```typescript
// Define the structure of your contract's public methods
interface NftContract {
  view: {
    // view methods return a Promise with the expected data type
    nft_token(args: {
      token_id: string
    }): Promise<{ owner_id: string; metadata: object }>
  }
  call: {
    // call methods usually return a Promise<void> or the final transaction result
    nft_transfer(args: { receiver_id: string; token_id: string }): Promise<void>
  }
}
```

### Step 2: Create a Typed Contract Instance

Use `near.contract<T>()` with your interface and the contract's account ID.

```typescript
const contract = near.contract<NftContract>("paras-token-v2.testnet")
```

### Step 3: Enjoy Type Safety and Autocompletion!

Now, when you use the `contract` object, your IDE will provide autocompletion, and TypeScript will enforce correct method names and argument types.

```typescript
// ✅ Correct and autocompleted!
const nft = await contract.view.nft_token({ token_id: "2318:2" })
console.log("Owner:", nft.owner_id)

// ❌ Examples of invalid code that TypeScript will reject:
//
// await contract.call.nft_tranfer({ ... })
//
// await contract.call.nft_transfer({
//   reciever_id: "bob.near",
//   token_id: "2318:2",
// })
```

This simple pattern catches bugs before you even run your code, dramatically speeding up development and increasing the reliability of your application.

## What's Next?

So far, we've focused on server-side interactions. Let's explore how to use `near-kit` in the browser to interact with user wallets.

- **Next Guide:** [05 - Browser Wallets](./05-browser-wallets.md)
