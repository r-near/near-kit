# Effect skill provenance

Installed and inspected at the experiment author's request from Kit Langton's
Effect v4 skill, pinned to upstream commit
`22c35cb7fd29f931789253fc3c8eb142f2863a8a`:

https://github.com/kitlangton/skills/tree/22c35cb7fd29f931789253fc3c8eb142f2863a8a/skills/effect

Retrieved 2026-09-30. The skill declares the MIT license. This installation contains
only the original Markdown skill and its eight reference documents; no executable
scripts were downloaded or run. Confirm examples against the pinned Effect
`4.0.0-rc.118` source. Preserve near-kit's public API and repository-specific
verification requirements where they impose stronger compatibility constraints.

Apply its service/layer, Schema, Effect.fn, Config, Schedule, Stream, lifecycle, and
deterministic-testing guidance. Plain pure cryptographic and wire-codec operations
remain pure. Nonce allocation is reservation state, so expiring/evicting it as a
lookup cache is unsafe. Keep required Promise/class compatibility at the outside;
native implementations should own their state and dependencies with Effect.
