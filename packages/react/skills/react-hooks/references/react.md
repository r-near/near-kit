# React Bindings Reference (@near-kit/react)

React hooks and providers for near-kit.

## Table of Contents

- [Installation](#installation)
- [Provider & Context](#provider--context)
- [View Hooks](#view-hooks)
- [Mutation Hooks](#mutation-hooks)
- [Account & Contract Hooks](#account--contract-hooks)
- [React Query Integration](#react-query-integration)
- [SWR Integration](#swr-integration)
- [Wallet Integration](#wallet-integration)
- [SSR / Next.js](#ssr--nextjs)

---

## Installation

```bash
npm install @near-kit/react
```

---

## Provider & Context

### NearProvider

Wrap your app to provide a Near client to all components. Accepts either a `config` object (creates Near internally) or an existing `near` instance — mutually exclusive.

```tsx
import { NearProvider } from "@near-kit/react"

// With configuration — NearProvider creates the instance
<NearProvider config={{ network: "testnet" }}>
  <App />
</NearProvider>

// With existing Near instance
const near = new Near({ network: "testnet", privateKey: "..." })
<NearProvider near={near}>
  <App />
</NearProvider>
```

`NearProviderProps` is a discriminated union:

```typescript
type NearProviderProps =
  | { config: NearConfig; near?: never; children: ReactNode }
  | { near: Near; config?: never; children: ReactNode }
```

`NearProvider` throws an error if nested inside another `NearProvider`.

### useNear

Access the Near client for direct API calls or library integration:

```tsx
function MyComponent() {
  const near = useNear()
  // near.view(), near.call(), near.send(), near.transaction()
}
```

`useNear()` throws an error if called outside a `NearProvider`.

---

## View Hooks

All view hooks return `ViewResult<T>`: `{ data, error, isLoading, refetch }`.

### useView

Call view methods on contracts:

```tsx
interface Message { id: string; sender: string; text: string }

const { data, isLoading, error, refetch } = useView<{ limit: number }, Message[]>({
  contractId: "guestbook.near",
  method: "get_messages",
  args: { limit: 10 },
  enabled: true, // optional, default true
})
```

Accepts `enabled` flag for conditional fetching. Use generics for type safety: `useView<TArgs, TResult>(params)`.

**Important:** Object `args` create new references every render. Use `useMemo` to prevent infinite re-fetches:

```tsx
const args = useMemo(() => ({ account_id: accountId }), [accountId])
const { data } = useView({
  contractId: "token.near",
  method: "ft_balance_of",
  args,
})
```

### useBalance

Fetch account NEAR balance as a formatted string:

```tsx
const { data: balance, isLoading } = useBalance({
  accountId: "alice.near",
})
// balance is a string like "10.50"
```

### useAccountExists

Check if an account exists:

```tsx
const { data: exists } = useAccountExists({
  accountId: input,
  enabled: input.length > 0, // avoid fetching for empty input
})
```

---

## Mutation Hooks

All mutation hooks return `UseCallResult` or `UseSendResult` with `{ mutate, error, isPending, isSuccess, isError, reset }`.

### useCall

Call change methods on contracts. Default options set via params, override per-call via second argument to `mutate()`.

```tsx
const { mutate, isPending, isError, error } = useCall({
  contractId: "counter.testnet",
  method: "increment",
  options: { gas: "30 Tgas", attachedDeposit: "0.01 NEAR" },
})

// Call with args
await mutate({ text: "Hello" })

// Override options per-call
await mutate({ token_id: "1" }, { attachedDeposit: "0.1 NEAR" })
```

### useSend

Send NEAR tokens. `mutate` signature: `(to: string, amount: AmountInput)`.

```tsx
const { mutate: send, isPending } = useSend()
await send("bob.near", "5 NEAR")
```

`AmountInput` accepts `"${number} NEAR"`, `"${bigint} yocto"`, or `bigint`.

---

## Account & Contract Hooks

### useAccount

Get current connected account state:

```tsx
const { accountId, isConnected, isLoading, refetch } = useAccount()
```

### useContract

Get typed contract instance with full TypeScript inference. Returns the same proxy as `near.contract<T>()`:

```tsx
import type { Contract } from "near-kit"
import { useContract } from "@near-kit/react"

type MyContract = Contract<{
  view: {
    get_balance: (args: { account_id: string }) => Promise<string>
  }
  call: {
    transfer: (args: { receiver_id: string; amount: string }) => Promise<void>
  }
}>

function TokenBalance() {
  const contract = useContract<MyContract>("token.testnet")

  // View (no options needed)
  const balance = await contract.view.get_balance({ account_id: "..." })

  // Call (options as second arg)
  await contract.call.transfer(
    { receiver_id: "bob.near", amount: "1000" },
    { attachedDeposit: "0.00001 NEAR" }
  )
}
```

`Contract<T>` automatically adds the options parameter to call methods. Do not add `CallOptions` to the type definition manually.

---

## React Query Integration

For caching, polling, background refetching, use React Query with `useNear()`:

```tsx
import { QueryClient, QueryClientProvider, useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { NearProvider, useNear } from "@near-kit/react"

const queryClient = new QueryClient()
const near = new Near({ network: "mainnet" })

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <NearProvider near={near}>
        <YourApp />
      </NearProvider>
    </QueryClientProvider>
  )
}
```

Custom hooks with caching and invalidation:

```tsx
function useMessages() {
  const near = useNear()
  return useQuery({
    queryKey: ["guestbook", "messages"],
    queryFn: () => near.view<Message[]>("guestbook.near", "get_messages", { limit: 50 }),
    staleTime: 10_000,
  })
}

function useAddMessage() {
  const near = useNear()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (text: string) => near.call("guestbook.near", "add_message", { text }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["guestbook", "messages"] }),
  })
}
```

### Optimistic Updates

```tsx
return useMutation({
  mutationFn: (text: string) => near.call("guestbook.near", "add_message", { text }),
  onMutate: async (text) => {
    await queryClient.cancelQueries({ queryKey: ["messages"] })
    const previous = queryClient.getQueryData(["messages"])
    queryClient.setQueryData(["messages"], (old: Message[]) => [...(old ?? []), { id: Date.now(), sender: "you", text }])
    return { previous }
  },
  onError: (_err, _text, context) => queryClient.setQueryData(["messages"], context?.previous),
  onSettled: () => queryClient.invalidateQueries({ queryKey: ["messages"] }),
})
```

### With Polling

```tsx
const { data: balance } = useQuery({
  queryKey: ["near", "balance", accountId],
  queryFn: () => near.getBalance(accountId),
  refetchInterval: 5000,
})
```

---

## SWR Integration

Lighter alternative (~4KB). Use `useSWR` and `useSWRMutation` with `useNear()`.

```tsx
import useSWR from "swr"
import useSWRMutation from "swr/mutation"
import { mutate as globalMutate } from "swr"

function useMessages() {
  const near = useNear()
  return useSWR("messages", () =>
    near.view<Message[]>("guestbook.near", "get_messages", { limit: 50 })
  )
}

function useAddMessage() {
  const near = useNear()
  return useSWRMutation(
    "messages",
    async (_, { arg: text }: { arg: string }) => near.call("guestbook.near", "add_message", { text }),
    { onSuccess: () => globalMutate("messages") }
  )
}
```

Conditional fetching (pass `null` key to skip): `useSWR(accountId ? ["profile", accountId] : null, fetcher)`.

### Data-Fetching Comparison

| Feature | Built-in Hooks | React Query | SWR |
|---------|---------------|-------------|-----|
| Caching/Deduplication | No | Yes | Yes |
| Background refetch | No | Yes | Yes |
| Optimistic updates | No | Yes | Yes |
| DevTools | No | Yes | No |
| Bundle size | 0 KB | ~13 KB | ~4 KB |

For production apps, integrate React Query or SWR using `useNear()` instead of relying solely on built-in hooks.

---

## Wallet Integration

### With NEAR Connect (Recommended)

```tsx
import { NearConnector } from "@hot-labs/near-connect"
import { Near, fromNearConnect } from "near-kit"

const connector = await setupNearConnect({ network: "testnet" })

<NearProvider
  config={{
    network: "testnet",
    wallet: fromNearConnect(connector),
  }}
>
  <App />
</NearProvider>
```

### Dynamic Wallet-Connected Provider

For dApps where users connect wallets, create the Near instance dynamically after connection:

```tsx
"use client"

import { useState, useEffect } from "react"
import { Near, fromNearConnect } from "near-kit"
import { NearProvider } from "@near-kit/react"
import { NearConnector } from "@hot-labs/near-connect"

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [near, setNear] = useState<Near | null>(null)

  useEffect(() => {
    const connector = new NearConnector({ network: "mainnet" })

    connector.on("wallet:signIn", async () => {
      setNear(new Near({
        network: "mainnet",
        wallet: fromNearConnect(connector),
      }))
    })

    connector.on("wallet:signOut", () => {
      setNear(null)
    })

    connector.connect()
  }, [])

  if (!near) {
    return <ConnectWalletButton />
  }

  return <NearProvider near={near}>{children}</NearProvider>
}
```

### With Wallet Selector (Legacy)

```tsx
import { setupWalletSelector } from "@near-wallet-selector/core"
import { fromWalletSelector } from "near-kit"

const selector = await setupWalletSelector({
  network: "testnet",
  modules: [/* wallet modules */],
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

`fromWalletSelector` is deprecated and does not support `signDelegateActions` for meta-transactions.

---

## SSR / Next.js

The entire `@near-kit/react` package is marked with `"use client"`. All source files include the directive. Wrap the provider in a client component for Next.js App Router:

```tsx
// app/providers.tsx
"use client"

import { NearProvider } from "@near-kit/react"

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <NearProvider config={{ network: "testnet" }}>
      {children}
    </NearProvider>
  )
}
```

Use the wrapper in your root layout (a Server Component):

```tsx
// app/layout.tsx
import { Providers } from "@/providers"

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
```

For Pages Router, set up in `_app.tsx`:

```tsx
// pages/_app.tsx
import type { AppProps } from "next/app"
import { Near } from "near-kit"
import { NearProvider } from "@near-kit/react"

const near = new Near({ network: "mainnet" })

export default function App({ Component, pageProps }: AppProps) {
  return (
    <NearProvider near={near}>
      <Component {...pageProps} />
    </NearProvider>
  )
}
```

### React StrictMode

Create the `Near` instance outside the component tree to avoid duplicate instances in development:

```tsx
// CORRECT — outside component tree
const near = new Near({ network: "testnet" })

function App() {
  return <NearProvider near={near}><Content /></NearProvider>
}

// Or use the config prop, which handles memoization internally
```
