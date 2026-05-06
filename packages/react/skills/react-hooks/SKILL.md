---
name: react-hooks
description: Use view, mutation, and account hooks in React components — useView for contract reads, useCall for change methods, useSend for NEAR transfers, useBalance, useAccountExists, useAccount for connection state, useContract for typed interfaces. Covers React Query and SWR integration for production data-fetching.
type: framework
library: near-kit
framework: react
library_version: "0.14.0"
sources:
  - r-near/near-kit:docs/react/hooks.mdx
  - r-near/near-kit:docs/react/data-fetching.mdx
  - r-near/near-kit:packages/react/src/hooks.tsx
  - r-near/near-kit:packages/react/src/mutations.tsx
requires:
  - react-provider
  - reading-data
  - writing-data
---

This skill builds on near-kit/react-provider and near-kit/reading-data. Read them first for foundational concepts before applying React-specific patterns.

# Setup

All hooks require being inside a `NearProvider`.

```tsx
import { useView } from "@near-kit/react"

interface Message { id: string; sender: string; text: string }

function Messages() {
  const { data, isLoading, error, refetch } = useView<{ limit: number }, Message[]>({
    contractId: "guestbook.near",
    method: "get_messages",
    args: { limit: 10 },
  })

  if (isLoading) return <p>Loading...</p>
  if (error) return <p>Error: {error.message}</p>

  return (
    <div>
      {data?.map((msg) => <p key={msg.id}>{msg.text}</p>)}
      <button onClick={refetch}>Refresh</button>
    </div>
  )
}
```

View hooks return `ViewResult<T>`: `{ data, error, isLoading, refetch }`.

Mutation hooks return `MutationResult<TArgs, TResult>`: `{ mutate, data, error, isPending, isSuccess, isError, reset }`.

# Core Patterns

## 1) View hooks

### useView

Call any view method. Accepts `enabled` flag for conditional fetching. Use generics for type safety: `useView<TArgs, TResult>(params)`.

```tsx
function UserProfile({ userId }: { userId?: string }) {
  const { data: profile, isLoading } = useView({
    contractId: "profiles.near",
    method: "get_profile",
    args: { user_id: userId },
    enabled: !!userId,
  })

  if (!userId) return <p>Select a user</p>
  if (isLoading) return <p>Loading...</p>
  return <p>{profile?.name}</p>
}
```

### useBalance

Fetch an account's NEAR balance as a formatted string (e.g., `"10.50"`). For raw BigInt, use `useNear()` with `near.getAccount()`.

```tsx
import { useBalance } from "@near-kit/react"

function WalletBalance({ accountId }: { accountId: string }) {
  const { data: balance, isLoading } = useBalance({ accountId })
  if (isLoading) return <span>...</span>
  return <span>{balance} NEAR</span>
}
```

### useAccountExists

Check if an account exists. Use `enabled` to avoid fetching for empty input.

```tsx
const { data: exists } = useAccountExists({
  accountId: input,
  enabled: input.length > 0,
})
```

### useAccount

Get connected account state. Returns `{ accountId, isConnected, isLoading, refetch }`.

```tsx
const { accountId, isConnected } = useAccount()
```

## 2) Mutation hooks

### useCall

Call a change method on a contract. Default options set via params, override per-call via second argument to `mutate()`.

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

### useContract

Get a typed contract interface via `near.contract<T>()`.

```tsx
import type { Contract } from "near-kit"
import { useContract } from "@near-kit/react"

type FungibleToken = Contract<{
  view: {
    ft_balance_of: (args: { account_id: string }) => Promise<string>
  }
  call: {
    ft_transfer: (args: { receiver_id: string; amount: string }) => Promise<void>
  }
}>

const token = useContract<FungibleToken>("usdt.tether-token.near")
const balance = await token.view.ft_balance_of({ account_id: "alice.near" })
await token.call.ft_transfer({ receiver_id: "bob.near", amount: "1000" }, { attachedDeposit: "0.00001 NEAR" })
```

## 3) React Query integration

Built-in hooks are intentionally thin — no caching, deduplication, or background refetching. For production, use `useNear()` with React Query.

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

Optimistic updates:

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

## 4) SWR integration

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

| Feature | Built-in Hooks | React Query | SWR |
|---------|---------------|-------------|-----|
| Caching/Deduplication | No | Yes | Yes |
| Background refetch | No | Yes | Yes |
| Optimistic updates | No | Yes | Yes |
| DevTools | No | Yes | No |
| Bundle size | 0 KB | ~13 KB | ~4 KB |

# Common Mistakes

### HIGH Using refetch() immediately after mutation for data refresh

After a mutation, calling `refetch()` from a `useView` hook may use stale parameters because React batches state updates. Use React Query's `invalidateQueries()` instead.

Wrong:

```tsx
const { refetch: refetchMessages } = useView({ contractId: "guestbook.near", method: "get_messages", args: {} })
const { mutate } = useCall({ contractId: "guestbook.near", method: "add_message" })

await mutate({ text: "Hello" })
await refetchMessages()
```

Correct:

```tsx
const queryClient = useQueryClient()
const { mutate } = useMutation({
  mutationFn: (text: string) => near.call("guestbook.near", "add_message", { text }),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ["guestbook", "messages"] }),
})
```

Source: r-near/near-kit:docs/react/data-fetching.mdx

### HIGH Creating object args inline causing infinite re-renders

When `args` is an object literal, it creates a new reference every render, potentially triggering infinite re-fetches. Use `useMemo` for stable references.

Wrong:

```tsx
const { data } = useView({
  contractId: "token.near",
  method: "ft_balance_of",
  args: { account_id: accountId },
})
```

Correct:

```tsx
const args = useMemo(() => ({ account_id: accountId }), [accountId])
const { data } = useView({
  contractId: "token.near",
  method: "ft_balance_of",
  args,
})
```

Source: r-near/near-kit:docs/react/hooks.mdx

**Built-in hook simplicity vs production data-fetching** — built-in hooks lack caching/deduplication. For production apps, integrate React Query or SWR using `useNear()`. Agents optimizing for simplicity will use built-in hooks in production, causing poor UX. See react-provider skill.

See also: react-provider, reading-data, writing-data
