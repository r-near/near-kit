/** Native validation for SDK helpers. Composable Zod schemas live at near-kit/schemas. */
import * as Schema from "effect/Schema"
import {
  ACCOUNT_ID_REGEX,
  ED25519_KEY_PREFIX,
  MAX_ACCOUNT_ID_LENGTH,
  MIN_ACCOUNT_ID_LENGTH,
  ML_DSA_65_HASH_PREFIX,
  ML_DSA_65_KEY_PREFIX,
  SECP256K1_KEY_PREFIX,
} from "../core/constants.js"
import { type AmountInput, parseAmount } from "./amount.js"
import { type GasInput, parseGas } from "./gas.js"

const AccountIdSchema = Schema.String.check(
  Schema.isMinLength(MIN_ACCOUNT_ID_LENGTH),
  Schema.isMaxLength(MAX_ACCOUNT_ID_LENGTH),
  Schema.isPattern(ACCOUNT_ID_REGEX),
)
const base58Pattern =
  /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/
const privatePrefixes = [
  ML_DSA_65_KEY_PREFIX,
  ED25519_KEY_PREFIX,
  SECP256K1_KEY_PREFIX,
]
// Match the longer view-handle prefix before the full-key prefix.
const publicPrefixes = [ML_DSA_65_HASH_PREFIX, ...privatePrefixes]

function keySchema(prefixes: readonly string[]) {
  return Schema.String.check(
    Schema.makeFilter((key) => {
      const prefix = prefixes.find((prefix) => key.startsWith(prefix))
      return (
        (prefix !== undefined &&
          base58Pattern.test(key.slice(prefix.length))) ||
        "Expected a NEAR key prefix followed by base58 data"
      )
    }),
  )
}
const PublicKeySchema = keySchema(publicPrefixes)
const PrivateKeySchema = keySchema(privatePrefixes)
const decodeAccount = Schema.decodeSync(AccountIdSchema)
const decodePublicKey = Schema.decodeSync(PublicKeySchema)
const decodePrivateKey = Schema.decodeSync(PrivateKeySchema)
const acceptsAccount = Schema.is(AccountIdSchema)
const acceptsPublicKey = Schema.is(PublicKeySchema)
const acceptsPrivateKey = Schema.is(PrivateKeySchema)
const decodeAmountInput = Schema.decodeSync(
  Schema.Union([Schema.String, Schema.BigInt]),
)
const decodeGasInput = Schema.decodeSync(Schema.String)

export type AccountId = typeof AccountIdSchema.Type
export type PublicKeyString = typeof PublicKeySchema.Type
export type PrivateKeyString = typeof PrivateKeySchema.Type
export type PrivateKey =
  | `ed25519:${string}`
  | `secp256k1:${string}`
  | `ml-dsa-65:${string}`
export type Amount = AmountInput
export type Gas = GasInput

/** Validate account syntax, throwing SchemaError for an invalid ID. */
export function validateAccountId(accountId: string): string {
  return decodeAccount(accountId)
}
export function isValidAccountId(accountId: string): boolean {
  return acceptsAccount(accountId)
}

/** Validate public-key syntax, including post-quantum view handles. */
export function validatePublicKey(key: string): string {
  return decodePublicKey(key)
}
export function isValidPublicKey(key: string): boolean {
  return acceptsPublicKey(key)
}

/** Validate prefix/base58 syntax; cryptographic key length is checked by parseKey. */
export function validatePrivateKey(key: string): string {
  return decodePrivateKey(key)
}
export function isPrivateKey(key: string): boolean {
  return acceptsPrivateKey(key)
}

/** Normalize accepted string/bigint input with the canonical amount algorithm. */
export function normalizeAmount(amount: Amount): string {
  decodeAmountInput(amount)
  return parseAmount(amount)
}

/** The normalization helper accepts strings, even though parseGas also accepts numbers. */
export function normalizeGas(gas: Gas): string {
  decodeGasInput(gas)
  return parseGas(gas)
}
