---
"@near-kit/react": minor
---

Initial release of @near-kit/react - React bindings for near-kit.

**Hooks included:**
- `NearProvider` / `useNear()` - Context management
- `useView()` - Contract view calls with loading/error state
- `useCall()` - Contract change calls with mutation state
- `useSend()` - NEAR token transfers
- `useBalance()` - Account balance fetching
- `useAccountExists()` - Account existence checks
- `useAccount()` - Current connected account state
- `useContract()` - Typed contract instances

**Philosophy:**
- Thin wrappers around near-kit, not a separate abstraction
- Simple loading/error/data state management
- No caching - use React Query or SWR for advanced features
- Full TypeScript support

**Documentation:**
- README includes React Query and SWR integration examples
- SSR/Next.js guidance included
