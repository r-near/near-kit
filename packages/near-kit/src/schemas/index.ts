/**
 * Zod validation schemas for NEAR types.
 *
 * Useful for composing your own validation logic — form validation,
 * API input schemas, config parsing, etc.
 *
 * @example
 * ```typescript
 * import { AccountIdSchema, AmountSchema } from 'near-kit/schemas'
 * import { z } from 'zod'
 *
 * // Compose into your own schema
 * const TransferFormSchema = z.object({
 *   senderId: AccountIdSchema,
 *   receiverId: AccountIdSchema,
 *   amount: AmountSchema,
 * })
 * ```
 */

export {
  type AccountId,
  AccountIdSchema,
  type Amount,
  AmountSchema,
  type Gas,
  GasSchema,
  type PrivateKey,
  PrivateKeySchema,
  type PrivateKeyString,
  PublicKeySchema,
  type PublicKeyString,
} from "../utils/validation.js"
