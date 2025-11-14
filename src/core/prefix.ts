/**
 * NEP-461 prefix support for signed messages
 * See: https://github.com/near/NEPs/pull/461
 *
 * Prefixes ensure that different message types (transactions vs delegate actions)
 * never have identical binary representations, preventing signature confusion attacks.
 */

/**
 * Base offset for actionable (on-chain) messages
 * Messages < 2^30 are classic transactions
 * Messages >= 2^30 are NEP-prefixed actionable messages
 */
const ACTIONABLE_MESSAGE_BASE = Math.pow(2, 30)

/**
 * NEP numbers for messages requiring NEP-461 prefixes
 */
const NEP = {
  MetaTransactions: 366,
}

/**
 * Prefix for delegate actions (NEP-366 meta transactions)
 * Value: 2^30 + 366 = 1073742190
 *
 * This prefix is prepended to DelegateAction when serializing for signing,
 * ensuring delegate action signatures are always distinguishable from
 * transaction signatures.
 */
export class DelegateActionPrefix {
  prefix: number

  constructor() {
    this.prefix = ACTIONABLE_MESSAGE_BASE + NEP.MetaTransactions
  }
}
