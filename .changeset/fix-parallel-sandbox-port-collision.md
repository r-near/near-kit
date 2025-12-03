---
"near-kit": patch
---

Fix port collision when running sandboxes in parallel

When multiple sandboxes start simultaneously, assigning network port as `rpcPort + 1` caused conflicts. Sandbox A's network port would collide with Sandbox B's RPC port, preventing the second sandbox from binding successfully on macOS.
