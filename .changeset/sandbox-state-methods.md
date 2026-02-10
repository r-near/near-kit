---
"near-kit": minor
---

Add sandbox state manipulation methods: patchState, fastForward, dumpState, restoreState, saveSnapshot, loadSnapshot, and restart with snapshot support. Fix race conditions in dumpState and patchState, and fix restart DbVersion crash caused by stale process handles.
