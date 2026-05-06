---
name: react-provider
description: Set up NearProvider in React and Next.js apps — configure Near client via config or existing instance, handle SSR with "use client" directive, integrate wallet-connected providers with dynamic Near creation, and access the client with useNear(). Covers Next.js App Router and Pages Router setup.
type: framework
library: near-kit
framework: react
library_version: "0.14.0"
sources:
  - r-near/near-kit:docs/react/provider.mdx
  - r-near/near-kit:packages/react/src/provider.tsx
requires:
  - client-setup
  - wallet-integration
see_also:
  - react-hooks
  - wallet-integration
---

This skill builds on near-kit/client-setup. Read it first for foundational concepts before applying React-specific patterns.

# Setup

NearProvider makes a Near client instance available to all child components via React Context. Accepts either a `config` object (creates Near internally) or an existing `near` instance.

```tsx
import { Near } from "near-kit"
import { NearProvider } from "@near-kit/react"

const near = new Near({ network: "mainnet" })

function App() {
  return (
    <NearProvider near={near}>
      <YourApp />
    </NearProvider>
  )
}
```

Or use config prop to let NearProvider create the instance:

```tsx
import { NearProvider } from "@near-kit/react"

function App() {
  return (
    <NearProvider config={{ network: "mainnet" }}>
      <YourApp />
    </NearProvider>
  )
}
```

`NearProviderProps` is a discriminated union — pass `near` XOR `config`:

```typescript
type NearProviderProps =
  | { config: NearConfig; near?: never; children: ReactNode }
  | { near: Near; config?: never; children: ReactNode }
```

# Core Patterns

## 1) Basic provider setup

Create the Near instance outside the component tree, wrap with NearProvider, and use hooks in child components.

```tsx
import { Near } from "near-kit"
import { NearProvider, useBalance } from "@near-kit/react"

const near = new Near({ network: "mainnet" })

function WalletDisplay({ accountId }: { accountId: string }) {
  const { data: balance, isLoading } = useBalance({ accountId })
  if (isLoading) return <p>Loading...</p>
  return <p>Balance: {balance}</p>
}

function App() {
  return (
    <NearProvider near={near}>
      <WalletDisplay accountId="alice.near" />
    </NearProvider>
  )
}
```

Access the raw Near client with `useNear()`:

```tsx
import { useNear } from "@near-kit/react"

function AdvancedComponent() {
  const near = useNear()

  const handleComplex = async () => {
    await near
      .transaction("alice.near")
      .functionCall("contract.near", "method", { arg: "value" })
      .transfer("bob.near", "1 NEAR")
      .send()
  }

  return <button onClick={handleComplex}>Complex Transaction</button>
}
```

`useNear()` throws an error if called outside a `NearProvider`.

## 2) Next.js App Router (client component wrapper)

The `NearProvider` requires client-side React features (context, hooks). In Next.js App Router, wrap it in a client component.

```tsx
// providers/near-provider.tsx
"use client"

import { Near } from "near-kit"
import { NearProvider } from "@near-kit/react"

const near = new Near({ network: "mainnet" })

export function NearProviderWrapper({ children }: { children: React.ReactNode }) {
  return <NearProvider near={near}>{children}</NearProvider>
}
```

Use the wrapper in your root layout (a Server Component):

```tsx
// app/layout.tsx
import { NearProviderWrapper } from "@/providers/near-provider"

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        <NearProviderWrapper>{children}</NearProviderWrapper>
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

For Vite or CRA, wrap in the entry point:

```tsx
import React from "react"
import ReactDOM from "react-dom/client"
import { Near } from "near-kit"
import { NearProvider } from "@near-kit/react"
import App from "./App"

const near = new Near({ network: "mainnet" })

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <NearProvider near={near}>
      <App />
    </NearProvider>
  </React.StrictMode>
)
```

## 3) Wallet-connected dynamic provider

For dApps where users connect wallets, create the Near instance dynamically after wallet connection. The NearProvider is conditionally rendered — show a connect button when no wallet is connected.

```tsx
"use client"

import { useState, useEffect } from "react"
import { Near, fromHotConnect } from "near-kit"
import { NearProvider } from "@near-kit/react"
import { NearConnector } from "@hot-labs/near-connect"

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [near, setNear] = useState<Near | null>(null)

  useEffect(() => {
    const connector = new NearConnector({ network: "mainnet" })

    connector.on("wallet:signIn", async () => {
      setNear(
        new Near({
          network: "mainnet",
          wallet: fromHotConnect(connector),
        })
      )
    })

    connector.connect()
  }, [])

  if (!near) {
    return <ConnectWalletButton />
  }

  return <NearProvider near={near}>{children}</NearProvider>
}
```

When using `NearProvider` with the `config` prop and React StrictMode, the Near instance is memoized via `useMemo` with a serialized config key, so only one instance is created per unique config.

# Common Mistakes

## CRITICAL: Using NearProvider in Next.js Server Components

`NearProvider` uses React Context, which only works in client components. Using it in a Server Component causes a runtime error.

```tsx
// WRONG — Server Component (no "use client")
// app/layout.tsx
import { NearProvider } from "@near-kit/react"

export default function Layout({ children }) {
  return <NearProvider config={{ network: "mainnet" }}>{children}</NearProvider>
}

// CORRECT — wrap in a client component
// providers/near-provider.tsx
"use client"

import { Near } from "near-kit"
import { NearProvider } from "@near-kit/react"

const near = new Near({ network: "mainnet" })

export function NearProviderWrapper({ children }: { children: React.ReactNode }) {
  return <NearProvider near={near}>{children}</NearProvider>
}
```

## MEDIUM: Nesting NearProvider components

`NearProvider` throws an error if nested inside another `NearProvider`. This prevents accidental context shadowing.

```tsx
// WRONG — nested providers throw
<NearProvider near={near1}>
  <NearProvider near={near2}>
    <App />
  </NearProvider>
</NearProvider>

// CORRECT — single root provider
<NearProvider near={near}>
  <App />
</NearProvider>
```

If you need multiple Near clients (e.g., mainnet + testnet), manage them outside of context:

```typescript
const mainnetNear = new Near({ network: "mainnet" })
const testnetNear = new Near({ network: "testnet" })

const balance = await testnetNear.getBalance("alice.testnet")
```

## HIGH: Multiple Near instances in React StrictMode dev mode

React StrictMode mounts components twice in development. If you create a `Near` instance inline (inside a component body or `useMemo` without a stable key), you may get duplicate instances that compete for the same keystore or wallet connection.

```tsx
// RISKY — may create duplicate instances in StrictMode
function App() {
  const near = new Near({ network: "testnet" })
  return <NearProvider near={near}><Content /></NearProvider>
}

// CORRECT — create outside component tree
const near = new Near({ network: "testnet" })

function App() {
  return <NearProvider near={near}><Content /></NearProvider>
}
```

Or use the `config` prop, which handles memoization internally via `useMemo` with a serialized config key.
