# 7. Handling Errors

When you're interacting with a decentralized network, a lot can go wrong: a user might not have enough funds, a contract might have a bug, or the network itself could be slow. `near-kit` provides a set of typed errors to help you handle these cases gracefully.

## The `try...catch` Pattern

All `near-kit` errors extend the base JavaScript `Error`, so you can use a standard `try...catch` block. The real power comes from using `instanceof` to check for specific error types.

```typescript
import {
  Near,
  FunctionCallError,
  AccountDoesNotExistError,
  NetworkError,
} from "near-kit"

const near = new Near({ network: "testnet", privateKey: "..." })

try {
  const result = await near
    .transaction("signer.testnet")
    .functionCall("some-contract.testnet", "some_method", {})
    .send()
} catch (error) {
  // Check the error's type
  if (error instanceof FunctionCallError) {
    // The smart contract itself panicked.
    console.error(`Contract Error in ${error.contractId}:`)
    console.error(`- Method: ${error.methodName}`)
    console.error(`- Panic Message: ${error.panic}`)
    console.error(`- Logs:`, error.logs)
  } else if (error instanceof AccountDoesNotExistError) {
    // The target account doesn't exist.
    console.error(`Account ${error.accountId} does not exist.`)
  } else if (error instanceof NetworkError) {
    // The RPC request failed.
    console.error(`Network Error: ${error.message}`)
    if (error.retryable) {
      console.log("This error is retryable. Please try again later.")
    }
  } else {
    // Handle other potential errors.
    console.error("An unknown error occurred:", error.message)
  }
}
```

## Most Common Errors

- **`FunctionCallError`**: The most common error. It means your transaction was valid, but the smart contract code failed (panicked) during execution.

  - `error.panic`: Contains the actual panic message from the contract (e.g., "ERR_NOT_ENOUGH_FUNDS"). This is extremely useful for debugging.
  - `error.logs`: Contains any log messages the contract emitted before it failed.

- **`InvalidTransactionError`**: The transaction itself was rejected by the network before it could even get to the contract. This often happens due to:

  - An invalid account ID (`AccountAlreadyExists`).
  - Trying to use an access key with insufficient permissions.
  - An invalid nonce (often handled automatically by `near-kit`).

- **`AccountDoesNotExistError`**: You tried to interact with an account that hasn't been created yet.

- **`NetworkError`**: The RPC node failed to respond. This can happen if the node is down or your connection is interrupted.
  - `error.retryable`: A boolean indicating if you can safely retry the same operation.

By handling these typed errors, you can build a much more robust and user-friendly application.

- **Next Guide:** [08 - Migrating from `near-api-js`](./08-migrating-from-near-api-js.md)
