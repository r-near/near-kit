# @near-kit/react

## 0.10.0

### Patch Changes

- Updated dependencies [7039bbf]
  - near-kit@0.10.0

## 0.9.0

### Minor Changes

- a42b460: Release v0.9.0

  - Move near-kit from peerDependencies to dependencies in @near-kit/react
  - This enables proper lockstep versioning with changesets

### Patch Changes

- Updated dependencies [a58fd6c]
- Updated dependencies [a42b460]
  - near-kit@0.9.0

## 0.8.3

### Patch Changes

- 8729188: Initial release of @near-kit/react - React bindings for near-kit.

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

- Updated dependencies [ef3d67f]
- Updated dependencies [78b65fd]
- Updated dependencies [c387dad]
  - near-kit@0.8.3
