---
"near-kit": minor
---

Support nearcore 2.15 (protocol version 89):

- `Sandbox.start()` defaults to nearcore 2.15.0-rc.1.
- External contract calls (NEP-667): `near.externalCall()`, `near.viewExternalCall()` (dry run), `near.getExternalCallStatus()` and `near.findExternalCall()`, the wire codec (`encodeExternalCall`, `decodeExternalCall`, `externalCallHash`, `externalCallUniqueId`), and `ExternalCallRefusedError` and `ExternalCallTimeoutError`.
- Transaction views with `kind`, receipts with `authorization_context` and `creation_protocol_version`, the `external_call_processing` state change cause, and `near.getProtocolConfig()` with the external call limits.
- New typed errors: `ReservedMethodNameError`, `UninitializedAccountError`, `InvalidStateInitError` and `UnknownTransactionError`. `UNKNOWN_TRANSACTION` and `DOES_NOT_TRACK_SHARD` were `NetworkError`s before; `DOES_NOT_TRACK_SHARD` is now a non-retryable `ShardUnavailableError`.
- A `stateInit` option on view calls, and `state` and `bootstrap_nonce` on account views of uninitialized universal accounts.
- A JSON-RPC error sent with a non-2xx status, such as `TIMEOUT_ERROR` with HTTP 408, is now parsed into its typed error instead of a generic `NetworkError`.
- On nearcore 2.15, `getAccessKeys()` for a missing account throws `AccountDoesNotExistError` instead of returning no keys.
