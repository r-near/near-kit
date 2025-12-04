/**
 * Utility functions for the NEAR client library.
 *
 * @remarks
 * This module exposes helpers for working with human-readable amounts and gas,
 * key generation and parsing, NEP-413 message signing, NEP-616 deterministic
 * account IDs, and validation of common NEAR types (account IDs, public/private
 * keys, amounts, gas).
 */
export {
  Amount,
  type AmountInput,
  formatAmount,
  parseAmount,
} from "./amount.js"
export { formatGas, Gas, type GasInput, parseGas } from "./gas.js"
export * from "./key.js"
export {
  generateNonce,
  NEP413_TAG,
  serializeNep413Message,
  type VerifyNep413Options,
  verifyNep413Signature,
} from "./nep413.js"
export {
  type ContractCode,
  createStateInit,
  deriveAccountId,
  isDeterministicAccountId,
  type StateInit,
  type StateInitOptions,
  serializeStateInit,
  verifyDeterministicAccountId,
} from "./state-init.js"
export {
  isPrivateKey,
  isValidAccountId,
  isValidPublicKey,
  type PrivateKey,
  validateAccountId,
  validatePrivateKey,
  validatePublicKey,
} from "./validation.js"
