# TransactionBuilder Action Reference

Complete reference for all methods available on the TransactionBuilder, created via `near.transaction(signerId)`.

## Token Operations

### `.transfer(receiverId, amount)`

Send NEAR tokens. Amount accepts human-readable strings.

```typescript
.transfer("bob.near", "10 NEAR")
.transfer("alice.near", Amount.NEAR(10.5))
.transfer("charlie.near", Amount.yocto(1000000n))
```

### `.stake(publicKey, amount)`

Stake NEAR with a validator. The publicKey is the validator's public key.

```typescript
.stake("ed25519:VALIDATOR_KEY...", "100 NEAR")
```

To unstake, call the staking pool contract's `unstake` method via `.functionCall()`.

## Contract Operations

### `.functionCall(contractId, methodName, args, options?)`

Call a smart contract method. The 4th argument is optional.

```typescript
.functionCall("counter.near", "increment", {})
.functionCall("token.near", "transfer", { receiver_id: "bob.near" }, {
  gas: "50 Tgas",
  attachedDeposit: "0.1 NEAR",
})
```

Options: `gas` (default 30 Tgas), `attachedDeposit` (default 0), `signerId`, `waitUntil`.

### `.deployContract(accountId, code)`

Deploy compiled Wasm bytecode to an account.

```typescript
.deployContract("contract.alice.near", wasmBuffer)
```

### `.publishContract(code, options?)`

Publish Wasm to the global contract registry.

```typescript
.publishContract(wasmBuffer)
.publishContract(wasmBuffer, { identifiedBy: "hash" })
```

Options: `identifiedBy` — `"account"` (updatable, default) or `"hash"` (immutable).

### `.deployFromPublished(reference)`

Deploy a contract from the global registry by referencing its code.

```typescript
.deployFromPublished({ accountId: "factory.near" })
.deployFromPublished({ codeHash: "5FzD8..." })
```

### `.stateInit(stateInit, options?)`

NEP-616 deterministic account deployment. Creates account at a predictable address derived from initialization state.

```typescript
import { createStateInit, deriveAccountId } from "near-kit"

const stateInit = createStateInit({
  code: { accountId: "publisher.near" },
  data: new Map([[encoder.encode("owner"), encoder.encode("alice.near")]]),
  deposit: "1 NEAR",
})

.stateInit(stateInit)
```

## Account Management

### `.createAccount(accountId)`

Create a new account. The new account ID must end with the signer's account ID (e.g., `bob.alice.near`).

```typescript
.createAccount("bob.alice.near")
```

### `.deleteAccount({ beneficiary })`

Delete an account and send remaining balance to beneficiary.

```typescript
.deleteAccount({ beneficiary: "alice.near" })
```

## Access Key Management

### `.addKey(publicKey, permission)`

Add an access key to an account.

Full access key:

```typescript
.addKey("ed25519:NEW_KEY...", { type: "fullAccess" })
```

Function call access key (restricted):

```typescript
.addKey("ed25519:APP_KEY...", {
  type: "functionCall",
  receiverId: "game.near",
  methodNames: ["move", "attack"],
  allowance: "0.25 NEAR",
})
```

`methodNames`: empty array `[]` allows any method. `allowance`: max gas fees this key can spend.

### `.deleteKey(accountId, publicKey)`

Remove an access key from an account.

```typescript
.deleteKey("alice.near", "ed25519:OLD_KEY...")
```

## Meta-Transaction Actions

### `.delegate(options?)`

Sign the transaction off-chain as a delegate action (NEP-366). Returns `{ signedDelegateAction, payload }`. No network activity occurs.

```typescript
const { signedDelegateAction, payload } = near
  .transaction("user.near")
  .functionCall("game.near", "move", { x: 1 })
  .delegate()
```

Options: `blockHeightOffset` (expiration window in blocks), `payloadFormat` ("base64" default).

### `.signedDelegateAction(signedDelegate)`

Include a user's signed delegate action in the relayer's transaction.

```typescript
.signedDelegateAction(decodedAction)
```

## Signing Override

### `.signWith(key)`

Override the signer for this specific transaction. Accepts a private key string or a custom signer function.

```typescript
.signWith("ed25519:OTHER_KEY...")
.signWith(async (hash) => ({ signature: await kmsSign(hash), publicKey: "ed25519:..." }))
```

## Pipeline Methods

### `.build()`

Construct the unsigned transaction object.

### `.sign()`

Sign the built transaction with the configured signer.

### `.send(options?)`

Sign and broadcast the transaction. Returns `FinalExecutionOutcome`.

```typescript
.send()
.send({ waitUntil: "FINAL" })
```

`waitUntil` options:
- `"INCLUDED"` — Transaction in a block, no return data yet
- `"EXECUTED_OPTIMISTIC"` (default) — Execution complete, return data available
- `"FINAL"` — BFT finality, 100% irreversible
