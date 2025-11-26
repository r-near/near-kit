---
"near-kit": minor
---

Add sandbox improvements for testing:
- `patchState()` - Directly modify blockchain state including account balances, access keys, contract code, and contract storage
- `fastForward()` - Advance the sandbox blockchain by a number of blocks for testing time-dependent logic
- `dumpState()` / `restoreState()` - Save and restore state snapshots for test isolation
- `saveSnapshot()` / `loadSnapshot()` - Persist snapshots to files for reuse across test runs
- `restart()` - Restart the sandbox with optional state snapshot for complete state reset
