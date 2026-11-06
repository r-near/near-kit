# Why this shape

The useful core is a protocol-aware read boundary: exact represented values, validated responses, understandable failures and cancellation through the response body. It does not need a signer, nonce allocator, wallet observer, client runtime or process manager.

We compared four designs:

1. Effect operations behind a NEAR service/layer: composable, but adds a second replaceable service over the existing HttpClient
2. Promise-first client with Effect inside: easiest first line, but introduces an execution boundary and weakens typed composition
3. Adapter over current near-api-js: strongest breadth, but inherits upstream retry/decoding/cancellation behavior and dependency cost
4. Explicit configured client with Effect methods: one execution model, explicit multi-network values, and standard HttpClient resolved in the caller's scope

This prototype chooses 4. A configured value contains no live transport and has nothing to close. The supplied fetchLayer is a standard Effect layer with a safe redirect default. An application can provide another live HTTP layer or create its own domain service.

Contract wrappers are ordinary functions. JSON result schemas infer and validate types; binary output stays binary. Accounts return exact quantities rather than rounded display balances or spendability estimates. Account absence is derived from matching structured protocol evidence, never a catch-all.

The version and cost tradeoffs are real: Effect4 is still a release candidate, HTTP APIs are marked unstable, and standalone import/bundle overhead may outweigh convenience for small Promise applications. Measurements and packed-consumer testing determine whether to keep this design; there is no assumed speed advantage.

This is a bounded read experiment. Access-key/state/code listings, wallet-platform compatibility and state-changing workflows remain outside it. It is not a complete SDK rewrite, and it does not replace existing packages.
