# Why this shape

The SDK boundary should add protocol knowledge, exact decoding and honest lifetimes. It should not own the application's runtime, wallet selection, cache, custody or test node.

The first experiment compared a NEAR service over HttpClient, a Promise facade over Effect, an upstream-SDK adapter, and a configured method client. The expanded design also compared that method client with named module functions. It chooses module functions plus an opaque immutable endpoint value: callers pay one explicit argument, while unused operation modules can be eliminated instead of constructing a growing method closure. Actual consumer measurements must establish the size tradeoff.

HttpClient is the sole network service. Each operation owns one request and its complete response body. State traversal adds only protocol-specific pinning/progress rules around native Stream pagination. Pure public encodings and exact units use ordinary TypeScript. Contract wrappers are application functions with result schemas. No Promise mirror, generic RPC escape hatch, schema catalog, contract proxy or library runtime is added.

A modern native JSON boundary preserves source integer tokens and serializes validated heights exactly. All exposed protocol u64 values are bigint; arbitrary contract JSON deliberately retains ordinary JS semantics. Duplicate JSON member names follow native last-member-wins behavior. This raises the browser floor, rather than maintaining two parser implementations or silently rounding.

Wallet/framework examples must use actual external stores and caller-owned source identity, with cleanup, failure states and stale-result prevention. They do not turn the read client into a live wallet session. Test infrastructure owns the official pinned Docker node and static fixtures.

The candidate remains incomplete as a whole SDK while separately paused workflows and platform evidence are unresolved. API size, more Effect or test count alone do not establish that it should replace the existing library.
