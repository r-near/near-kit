# near-kit Examples

Minimal, copy-paste ready examples for common NEAR operations.

## Examples

### [`quickstart.ts`](./quickstart.ts)
Essential operations: view, call, send, type-safe contracts, transaction builder.
Start here if you're new to near-kit.

```bash
bun run examples/quickstart.ts
```

### [`wallet-browser.ts`](./wallet-browser.ts)
Connect to user wallets in the browser with HOT Connect or Wallet Selector.

### [`meta-transactions.ts`](./meta-transactions.ts)
Gasless transactions (NEP-366): user signs, relayer pays.
Shows both user and relayer sides.

### [`sign-in-with-near.ts`](./sign-in-with-near.ts)
Gasless authentication using message signing (NEP-413).
Client signs, server verifies.

### [`universal-code.ts`](./universal-code.ts)
Same API works everywhere: server with private keys, browser with wallets.
Write once, run anywhere.

### [`rotating-keystore.ts`](./rotating-keystore.ts)
High-throughput concurrent transactions using multiple access keys.
Send many transactions without nonce collisions.

```bash
bun run examples/rotating-keystore.ts
```

## Setup

Most examples require credentials:

```bash
export NEAR_ACCOUNT_ID=your-account.testnet
export NEAR_PRIVATE_KEY=ed25519:...
```

Get a testnet account at [wallet.testnet.near.org](https://wallet.testnet.near.org/)

## Documentation

Full docs: [kit.near.tools](https://kit.near.tools)
