/** Internal evidence shared by RPC submission and the transaction owner. */
import { InvalidNonceError, NearError } from "../../errors/index.js"

const definitiveNonceRejection = Symbol("near-kit/definitiveNonceRejection")

/** Only the decoded send_tx error-envelope boundary may establish this evidence. */
export function markDefinitiveNonceRejection(
  error: InvalidNonceError,
): InvalidNonceError {
  Object.defineProperty(error, definitiveNonceRejection, { value: true })
  return error
}

export function isDefinitiveNonceRejection(
  error: unknown,
): error is InvalidNonceError {
  return (
    error instanceof InvalidNonceError &&
    Object.hasOwn(error, definitiveNonceRejection)
  )
}

/** An uncertain submission must not authorize a newly signed transaction. */
export function transactionOutcomeUnknown(
  cause: unknown,
  details?: Record<string, unknown>,
): NearError & { readonly retryable: false } {
  return Object.assign(
    new NearError(
      "Transaction submission outcome is unknown; check its status before creating a new transaction",
      "TRANSACTION_OUTCOME_UNKNOWN",
      { ...details, cause },
    ),
    { retryable: false as const },
  )
}
