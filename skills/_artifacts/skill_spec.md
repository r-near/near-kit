# near-kit — Skill Spec

A TypeScript SDK for NEAR Protocol that makes blockchain interactions feel like `fetch`. Provides human-readable unit strings, a fluent transaction builder, type-safe contract interfaces, and a single `Near` entry point that works across backend scripts, browser dApps, and integration tests.

## Domains

| Domain | Description | Skills |
| ------ | ----------- | ------ |
| client-setup | Initializing and configuring the Near client | client-setup, migration |
| data-access | Reading blockchain state | reading-data |
| transactions | Building and sending transactions | writing-data, transaction-builder |
| contracts | Type-safe contract interfaces | type-safe-contracts |
| key-management | Storing and rotating private keys | key-management |
| wallets | Connecting browser wallets | wallet-integration |
| authentication | Off-chain signing and verification | meta-transactions, message-signing |
| errors | Typed error hierarchy and retry logic | error-handling |
| testing | Local integration testing with Sandbox | testing |
| react | React provider, hooks, and data-fetching | react-provider, react-hooks |

## Skill Inventory

| Skill | Type | Domain | What it covers | Failure modes |
| ----- | ---- | ------ | -------------- | ------------- |
| client-setup | core | client-setup | Near constructor, config, network presets, credential resolution | 4 |
| reading-data | core | data-access | view methods, balances, accounts, access keys, parallel reads | 3 |
| writing-data | core | transactions | near.send(), near.call(), CallOptions, result inspection | 3 |
| transaction-builder | core | transactions | Fluent builder, factory pattern, access keys, global contracts, nonce | 4 |
| type-safe-contracts | core | contracts | Contract<T>, typed proxies, view/call namespaces | 2 |
| key-management | core | key-management | KeyStore implementations, subpath imports, rotating keys | 2 |
| wallet-integration | core | wallets | NEAR Connect adapter, wallet lifecycle | 1 |
| meta-transactions | core | authentication | NEP-366 delegate, relayer pattern, security checks | 3 |
| message-signing | core | authentication | NEP-413 signing, verification, nonce, replay protection | 2 |
| error-handling | core | errors | NearError subclasses, retryable flag, instanceof checks | 2 |
| testing | lifecycle | testing | Sandbox setup, state manipulation, snapshots, block control | 2 |
| migration | lifecycle | client-setup | near-api-js to near-kit conversion, side-by-side patterns | 2 |
| react-provider | framework | react | NearProvider, useNear, Next.js setup, wallet-connected provider | 2 |
| react-hooks | framework | react | useView, useCall, useSend, useBalance, useAccount, React Query | 2 |

## Failure Mode Inventory

### client-setup (4 failure modes)

| # | Mistake | Priority | Source | Cross-skill? |
|---|---------|----------|--------|--------------|
| 1 | Passing raw number instead of unit string | CRITICAL | docs/start-here/mental-model.mdx | writing-data, transaction-builder |
| 2 | Using near-api-js API patterns | CRITICAL | docs/reference/ai-integration.mdx | migration |
| 3 | Not providing credentials for write operations | HIGH | packages/near-kit/src/core/near.ts | — |
| 4 | Creating multiple Near instances in React dev mode | HIGH | packages/react/src/provider.tsx | react-provider |

### reading-data (3 failure modes)

| # | Mistake | Priority | Source | Cross-skill? |
|---|---------|----------|--------|--------------|
| 1 | Confusing available balance with total balance | HIGH | docs/essentials/reading-data.mdx | — |
| 2 | Calling near.view without generic type | MEDIUM | docs/essentials/reading-data.mdx | — |
| 3 | Not passing args object for no-arg methods | MEDIUM | packages/near-kit/src/core/near.ts | — |

### writing-data (3 failure modes)

| # | Mistake | Priority | Source | Cross-skill? |
|---|---------|----------|--------|--------------|
| 1 | Forgetting attached deposit for storage | HIGH | docs/essentials/writing-data.mdx | transaction-builder |
| 2 | Using INCLUDED and reading return value | MEDIUM | docs/in-depth/advanced-transactions.mdx | transaction-builder |
| 3 | Not specifying gas for complex calls | MEDIUM | docs/essentials/writing-data.mdx | transaction-builder |

### transaction-builder (4 failure modes)

| # | Mistake | Priority | Source | Cross-skill? |
|---|---------|----------|--------|--------------|
| 1 | Deploying without initializing (security) | CRITICAL | docs/in-depth/advanced-transactions.mdx | — |
| 2 | Concurrent transactions without RotatingKeyStore | HIGH | docs/in-depth/key-management.mdx | key-management |
| 3 | Assuming cross-contract rollback | HIGH | docs/in-depth/advanced-transactions.mdx | — |
| 4 | Wrong deleteAccount argument shape | MEDIUM | docs/in-depth/advanced-transactions.mdx | — |

### type-safe-contracts (2 failure modes)

| # | Mistake | Priority | Source | Cross-skill? |
|---|---------|----------|--------|--------------|
| 1 | Putting methods in wrong namespace | HIGH | docs/essentials/type-safe-contracts.mdx | — |
| 2 | Adding CallOptions to call method type | MEDIUM | packages/near-kit/src/contracts/contract.ts | — |

### key-management (2 failure modes)

| # | Mistake | Priority | Source | Cross-skill? |
|---|---------|----------|--------|--------------|
| 1 | Importing FileKeyStore from main entry | CRITICAL | packages/near-kit/package.json | — |
| 2 | Trying to list keys with NativeKeyStore | MEDIUM | packages/near-kit/src/keys/native-keystore.ts | — |

### wallet-integration (1 failure mode)

| # | Mistake | Priority | Source | Cross-skill? |
|---|---------|----------|--------|--------------|
| 1 | Using fromWalletSelector instead of fromNearConnect | MEDIUM | packages/near-kit/src/wallets/adapters.ts | — |

### meta-transactions (3 failure modes)

| # | Mistake | Priority | Source | Cross-skill? |
|---|---------|----------|--------|--------------|
| 1 | Relayer not whitelisting receivers | CRITICAL | docs/in-depth/meta-transactions.mdx | — |
| 2 | Not whitelisting method names | HIGH | docs/in-depth/meta-transactions.mdx | — |
| 3 | Confusing delegate() result as tx outcome | HIGH | packages/near-kit/src/core/transaction.ts | — |

### message-signing (2 failure modes)

| # | Mistake | Priority | Source | Cross-skill? |
|---|---------|----------|--------|--------------|
| 1 | Not storing nonces for replay prevention | CRITICAL | docs/in-depth/message-signing.mdx | — |
| 2 | Not hex-encoding nonce for JSON transport | MEDIUM | docs/in-depth/message-signing.mdx | — |

### error-handling (2 failure modes)

| # | Mistake | Priority | Source | Cross-skill? |
|---|---------|----------|--------|--------------|
| 1 | Catching generic Error instead of NearError | HIGH | docs/in-depth/error-handling.mdx | — |
| 2 | Not checking retryable flag | MEDIUM | packages/near-kit/src/errors/index.ts | — |

### testing (2 failure modes)

| # | Mistake | Priority | Source | Cross-skill? |
|---|---------|----------|--------|--------------|
| 1 | Not increasing test timeout for Sandbox | HIGH | CLAUDE.md | — |
| 2 | Using duplicate account names across tests | MEDIUM | CLAUDE.md | — |

### migration (2 failure modes)

| # | Mistake | Priority | Source | Cross-skill? |
|---|---------|----------|--------|--------------|
| 1 | Trying to use Account class | CRITICAL | docs/start-here/migration.mdx | client-setup |
| 2 | Using parseNearAmount/formatNearAmount | CRITICAL | docs/start-here/migration.mdx | writing-data, transaction-builder |

### react-provider (2 failure modes)

| # | Mistake | Priority | Source | Cross-skill? |
|---|---------|----------|--------|--------------|
| 1 | Using NearProvider in Server Components | CRITICAL | packages/react/README.md | — |
| 2 | Nesting NearProvider components | MEDIUM | packages/react/src/provider.tsx | — |

### react-hooks (2 failure modes)

| # | Mistake | Priority | Source | Cross-skill? |
|---|---------|----------|--------|--------------|
| 1 | Using refetch() after mutation | HIGH | docs/react/data-fetching.mdx | — |
| 2 | Inline object args causing infinite re-renders | HIGH | docs/react/hooks.mdx | — |

## Tensions

| Tension | Skills | Agent implication |
| ------- | ------ | ----------------- |
| Getting-started simplicity vs production safety | client-setup ↔ key-management | Agents default to simplest config (privateKey in code) even for production |
| Built-in hook simplicity vs production data-fetching | react-hooks ↔ react-provider | Agents use built-in hooks for production instead of React Query/SWR |
| Concurrent throughput vs single-key simplicity | transaction-builder ↔ key-management | Agents send concurrent transactions with single key and hit InvalidNonceError |

## Cross-References

| From | To | Reason |
| ---- | -- | ------ |
| client-setup | key-management | Choosing a KeyStore is part of client setup |
| client-setup | wallet-integration | Browser apps use wallet adapters in Near config |
| writing-data | transaction-builder | Shortcuts are syntax sugar over the builder |
| transaction-builder | meta-transactions | Builder .delegate() creates delegate actions |
| meta-transactions | message-signing | Both are off-chain signing patterns |
| react-provider | react-hooks | Hooks require NearProvider context |
| react-hooks | reading-data | useView wraps near.view |
| migration | client-setup | Migration starts with understanding new Near config |
| testing | client-setup | Sandbox is configured via network option |

## Subsystems & Reference Candidates

| Skill | Subsystems | Reference candidates |
| ----- | ---------- | -------------------- |
| key-management | InMemoryKeyStore, FileKeyStore, NativeKeyStore, RotatingKeyStore | — |
| transaction-builder | — | Actions reference (>10 distinct action methods) |
| react-hooks | useView, useCall, useSend, useBalance, useAccountExists, useAccount, useContract, useNear | — |

## Remaining Gaps

| Skill | Question | Status |
| ----- | --------- | ------ |
| meta-transactions | What blockHeightOffset should developers use? | open |
| testing | Recommended pattern for Sandbox in CI? | open |
| react-hooks | Does useAccount work with all wallet types? | open |

## Recommended Skill File Structure

- **Core skills:** client-setup, reading-data, writing-data, transaction-builder, type-safe-contracts, key-management, wallet-integration, meta-transactions, message-signing, error-handling
- **Framework skills:** react-provider, react-hooks
- **Lifecycle skills:** migration, testing
- **Composition skills:** none (no external library composition warrants separate skills)
- **Reference files:** transaction-builder (dense action surface)

## Composition Opportunities

| Library | Integration points | Composition skill needed? |
| ------- | ------------------ | ------------------------ |
| @hot-labs/near-connect | Wallet adapter via fromHotConnect() | No — covered in wallet-integration skill |
| @near-wallet-selector/core | Legacy wallet adapter via fromWalletSelector() | No — covered in wallet-integration skill |
| @tanstack/react-query | Data-fetching with useNear() | No — covered in react-hooks skill |
| swr | Data-fetching with useNear() | No — covered in react-hooks skill |
