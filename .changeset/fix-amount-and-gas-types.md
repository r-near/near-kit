---
"near-kit": patch
---

Fix amount and gas schemas to use fully typesafe template literal types across `Near.call`, `CallOptions`, and helpers, ensuring `attachedDeposit` and gas options always use the `Amount` and `Gas` aliases.

