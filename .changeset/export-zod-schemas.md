---
"near-kit": minor
---

Add `near-kit/schemas` subpath export for Zod validation schemas

Export `AccountIdSchema`, `AmountSchema`, `GasSchema`, `PublicKeySchema`, `PrivateKeySchema` and their inferred types via `import { ... } from 'near-kit/schemas'`. Useful for composing your own validation logic without duplicating NEAR's validation rules.
