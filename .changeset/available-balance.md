---
"near-kit": minor
---

Add `getAccount()` method and fix `getBalance()` to return available balance

- **`getBalance()`** now returns the **available** (spendable) balance, accounting for storage costs. Previously it returned the raw `amount` field which didn't account for tokens reserved for storage.

- **`getAccount()`** is a new method that returns complete account state including:
  - `balance` - liquid balance (amount field)
  - `available` - actually spendable balance
  - `staked` - locked/staked balance
  - `storageUsage` - NEAR reserved for storage
  - `storageBytes` - raw storage in bytes
  - `hasContract` - whether a contract is deployed
  - `codeHash` - code hash of deployed contract

- **`STORAGE_AMOUNT_PER_BYTE`** constant is now exported for custom calculations

The available balance calculation follows the NEAR protocol rule that staked tokens count towards storage requirements:
- If staked ≥ storage cost → all liquid balance is available  
- If staked < storage cost → some liquid balance is reserved for storage
