# Why this shape

The SDK boundary should add protocol knowledge, exact decoding and honest lifetimes. It should not own the application's runtime, wallet selection, cache, custody or test node.

The first experiment compared a NEAR service over HttpClient, a Promise facade over Effect, an upstream-SDK adapter, and a configured method client. The expanded design also compared that method client with named module functions. It chooses module functions plus an opaque immutable endpoint value: callers pay one explicit argument, while unused operation modules can be eliminated instead of constructing a growing method closure. Actual consumer measurements must establish the size tradeoff.

HttpClient is the sole network service. Each operation owns one request and its complete response body. State traversal adds only protocol-specific pinning/progress rules around native Stream pagination. Pure public encodings and exact units use ordinary TypeScript. Contract wrappers are application functions with result schemas. No Promise mirror, generic RPC escape hatch, schema catalog, contract proxy or library runtime is added.

A modern native JSON boundary preserves source integer tokens and serializes validated heights exactly. All exposed protocol u64 values are bigint; arbitrary contract JSON deliberately retains ordinary JS semantics. Duplicate JSON member names follow native last-member-wins behavior. This raises the browser floor, rather than maintaining two parser implementations or silently rounding.

Wallet/framework examples must use actual external stores and caller-owned source identity, with cleanup, failure states and stale-result prevention. They do not turn the read client into a live wallet session. Test infrastructure owns the official pinned Docker node and static fixtures.

The candidate remains incomplete as a whole SDK while separately paused workflows and platform evidence are unresolved. API size, more Effect or test count alone do not establish that it should replace the existing library.

## Alternatives rejected

| Shape | Tradeoff |
| --- | --- |
| Direct fetch / Promise-only | Smallest for a few application reads; caller must build the selected typed-error, transport-lifetime and stream composition contract. Still a valid consumer choice |
| A public NEAR service over HttpClient | Adds a second dependency seam without a separate owned resource; named functions can borrow the standard transport directly |
| Configured method client | Convenient discovery, but constructs a growing method surface. Module functions add an explicit client argument and let realistic consumers discard unused operation modules |
| Adapter over another SDK | Inherits its parsing/retry/cancellation assumptions or duplicates them to achieve this contract |
| A library runtime, contract proxy or framework provider | Adds ownership and synchronization concepts that ordinary functions and the caller's existing Effect/query/connector tools already provide |

The remaining costs are intentional: Effect is a prerelease dependency, native JSON raises the runtime floor, and concrete wallet integration still has application/upstream complexity. Benchmarks and executable recipes expose those costs rather than making the architecture itself a performance or ease-of-use claim.
