# @near-kit/react

React bindings for [near-kit](https://github.com/r-near/near-kit) - a simple, intuitive TypeScript library for interacting with NEAR Protocol.

## Installation

```bash
npm install @near-kit/react near-kit
# or
bun add @near-kit/react near-kit
```

## Quick Start

```tsx
import { NearProvider, useNear, useView, useCall } from "@near-kit/react"

// Wrap your app with NearProvider
function App() {
  return (
    <NearProvider config={{ network: "testnet" }}>
      <Counter />
    </NearProvider>
  )
}

// Use hooks to interact with NEAR
function Counter() {
  const { data: count, isLoading } = useView<{}, number>({
    contractId: "counter.testnet",
    method: "get_count",
  })

  const { mutate: increment, isPending } = useCall({
    contractId: "counter.testnet",
    method: "increment",
  })

  if (isLoading) return <div>Loading...</div>

  return (
    <div>
      <p>Count: {count}</p>
      <button onClick={() => increment({})} disabled={isPending}>
        {isPending ? "Incrementing..." : "Increment"}
      </button>
    </div>
  )
}
```

## API Reference

### Provider & Context

#### `NearProvider`

Provides a Near client instance to all child components.

```tsx
// Using configuration
<NearProvider config={{ network: "testnet" }}>
  <App />
</NearProvider>

// Using an existing Near instance
const near = new Near({ network: "testnet" })
<NearProvider near={near}>
  <App />
</NearProvider>
```

#### `useNear()`

Returns the Near client instance from context.

```tsx
function MyComponent() {
  const near = useNear()
  // Use near.view(), near.call(), near.transaction(), etc.
}
```

### Account Hooks

#### `useAccount()`

Returns the current account state.

```tsx
const { accountId, isConnected, isLoading, refetch } = useAccount()
```

#### `useBalance({ accountId })`

Fetches the balance for an account.

```tsx
const { data: balance, isLoading, error, refetch } = useBalance({
  accountId: "alice.testnet",
})
```

### Data Fetching Hooks

#### `useView<TArgs, TResult>(params)`

Calls a view function on a contract.

```tsx
const { data, isLoading, error, refetch } = useView<
  { account_id: string },
  string
>({
  contractId: "token.testnet",
  method: "ft_balance_of",
  args: { account_id: "alice.testnet" },
  enabled: true, // optional, default: true
  watch: [accountId], // optional, re-fetch when these deps change
})
```

#### `useAccountExists({ accountId })`

Checks if an account exists.

```tsx
const { data: exists, isLoading } = useAccountExists({
  accountId: "alice.testnet",
})
```

### Mutation Hooks

#### `useCall<TArgs, TResult>(params)`

Calls a change function on a contract.

```tsx
const { mutate, isPending, isSuccess, isError, error, data, reset } = useCall<
  { amount: number },
  void
>({
  contractId: "counter.testnet",
  method: "increment",
})

// Execute the call
await mutate({ amount: 1 })
```

#### `useSend()`

Sends NEAR tokens.

```tsx
const { mutate, isPending, isSuccess, isError, error, reset } = useSend()

// Send NEAR
await mutate("bob.testnet", "1 NEAR")
```

### Typed Contract Hooks

#### `useContract<T>(contractId)`

Returns a typed contract instance.

```tsx
import type { Contract } from "near-kit"

type MyContract = Contract<{
  view: {
    get_balance: (args: { account_id: string }) => Promise<string>
  }
  call: {
    transfer: (args: { to: string; amount: string }) => Promise<void>
  }
}>

function MyComponent() {
  const contract = useContract<MyContract>("token.testnet")

  // Fully typed!
  const balance = await contract.view.get_balance({ account_id: "..." })
}
```

#### `useContractView<TArgs, TResult>(viewFn, params)`

Calls a typed view method with React state management.

```tsx
const contract = useContract<MyContract>("token.testnet")

const { data: balance, isLoading } = useContractView(
  contract.view.get_balance,
  {
    args: { account_id: accountId },
    enabled: !!accountId,
    watch: [accountId],
  }
)
```

## Wallet Integration

### With Wallet Selector

```tsx
import { setupWalletSelector } from "@near-wallet-selector/core"
import { fromWalletSelector } from "near-kit"

const selector = await setupWalletSelector({
  network: "testnet",
  modules: [
    /* your wallet modules */
  ],
})
const wallet = await selector.wallet()

<NearProvider
  config={{
    network: "testnet",
    wallet: fromWalletSelector(wallet),
  }}
>
  <App />
</NearProvider>
```

### With HOT Connect

```tsx
import { setupNearConnect } from "@hot-labs/near-connect"
import { fromHotConnect } from "near-kit"

const connect = await setupNearConnect({ network: "testnet" })

<NearProvider
  config={{
    network: "testnet",
    wallet: fromHotConnect(connect),
  }}
>
  <App />
</NearProvider>
```

## React Query Integration

While `@near-kit/react` provides built-in hooks with loading/error states, you can also use it with React Query for advanced caching:

```tsx
import { useQuery } from "@tanstack/react-query"
import { useNear } from "@near-kit/react"

function useContractData() {
  const near = useNear()

  return useQuery({
    queryKey: ["contract", "counter.testnet", "get_count"],
    queryFn: () => near.view("counter.testnet", "get_count", {}),
  })
}
```

## License

MIT
