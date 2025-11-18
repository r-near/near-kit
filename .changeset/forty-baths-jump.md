---
"near-kit": patch
---

Fix privateKey not being added to keyStore when defaultSignerId is provided without a sandbox config. This resolves "No key found for account" errors when calling delegate() or other keyStore-dependent operations.

Also fixes race condition with async keystores by properly tracking pendingKeyStoreInit promise to ensure key is written before use.
