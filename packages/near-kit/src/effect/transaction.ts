import { Effect } from "effect"
import type {
  TransactionBuilder,
  TransactionError,
} from "../core/transaction.js"
import type { FinalExecutionOutcomeMap, SendOptions } from "../core/types.js"

/** Effect-native view of a transaction. Fluent edits are immediate; execution is lazy. */
export class EffectTransactionBuilder {
  private readonly builder: TransactionBuilder
  readonly delegate: TransactionBuilder["delegateEffect"]
  readonly delegateV2: TransactionBuilder["delegateV2Effect"]

  constructor(builder: TransactionBuilder) {
    this.builder = builder
    this.delegate = builder.delegateEffect.bind(builder)
    this.delegateV2 = builder.delegateV2Effect.bind(builder)
  }

  transfer(...args: Parameters<TransactionBuilder["transfer"]>): this {
    this.builder.transfer(...args)
    return this
  }

  functionCall(...args: Parameters<TransactionBuilder["functionCall"]>): this {
    this.builder.functionCall(...args)
    return this
  }

  createAccount(
    ...args: Parameters<TransactionBuilder["createAccount"]>
  ): this {
    this.builder.createAccount(...args)
    return this
  }

  deleteAccount(
    ...args: Parameters<TransactionBuilder["deleteAccount"]>
  ): this {
    this.builder.deleteAccount(...args)
    return this
  }

  deployContract(
    ...args: Parameters<TransactionBuilder["deployContract"]>
  ): this {
    this.builder.deployContract(...args)
    return this
  }

  publishContract(
    ...args: Parameters<TransactionBuilder["publishContract"]>
  ): this {
    this.builder.publishContract(...args)
    return this
  }

  deployFromPublished(
    ...args: Parameters<TransactionBuilder["deployFromPublished"]>
  ): this {
    this.builder.deployFromPublished(...args)
    return this
  }

  stateInit(...args: Parameters<TransactionBuilder["stateInit"]>): this {
    this.builder.stateInit(...args)
    return this
  }

  stake(...args: Parameters<TransactionBuilder["stake"]>): this {
    this.builder.stake(...args)
    return this
  }

  addKey(...args: Parameters<TransactionBuilder["addKey"]>): this {
    this.builder.addKey(...args)
    return this
  }

  deleteKey(...args: Parameters<TransactionBuilder["deleteKey"]>): this {
    this.builder.deleteKey(...args)
    return this
  }

  transferToGasKey(
    ...args: Parameters<TransactionBuilder["transferToGasKey"]>
  ): this {
    this.builder.transferToGasKey(...args)
    return this
  }

  withdrawFromGasKey(
    ...args: Parameters<TransactionBuilder["withdrawFromGasKey"]>
  ): this {
    this.builder.withdrawFromGasKey(...args)
    return this
  }

  signedDelegateAction(
    ...args: Parameters<TransactionBuilder["signedDelegateAction"]>
  ): this {
    this.builder.signedDelegateAction(...args)
    return this
  }

  signedDelegateActionV2(
    ...args: Parameters<TransactionBuilder["signedDelegateActionV2"]>
  ): this {
    this.builder.signedDelegateActionV2(...args)
    return this
  }

  signWith(...args: Parameters<TransactionBuilder["signWith"]>): this {
    this.builder.signWith(...args)
    return this
  }

  useGasKey(...args: Parameters<TransactionBuilder["useGasKey"]>): this {
    this.builder.useGasKey(...args)
    return this
  }

  strictNonceMode(
    ...args: Parameters<TransactionBuilder["strictNonceMode"]>
  ): this {
    this.builder.strictNonceMode(...args)
    return this
  }

  nonce(...args: Parameters<TransactionBuilder["nonce"]>): this {
    this.builder.nonce(...args)
    return this
  }

  build(): ReturnType<TransactionBuilder["buildEffect"]> {
    return this.builder.buildEffect()
  }

  sign(): Effect.Effect<this, TransactionError> {
    return this.builder.signEffect().pipe(Effect.as(this))
  }

  send(): Effect.Effect<
    FinalExecutionOutcomeMap["EXECUTED_OPTIMISTIC"],
    TransactionError
  >
  send<W extends keyof FinalExecutionOutcomeMap>(
    options: SendOptions<W>,
  ): Effect.Effect<FinalExecutionOutcomeMap[W], TransactionError>
  send<W extends keyof FinalExecutionOutcomeMap = "EXECUTED_OPTIMISTIC">(
    options?: SendOptions<W>,
  ): Effect.Effect<FinalExecutionOutcomeMap[W], TransactionError> {
    return this.builder.sendEffect(options)
  }

  getHash(): string | null {
    return this.builder.getHash()
  }
  serialize(): Uint8Array {
    return this.builder.serialize()
  }
}

/** Keep one underlying signed-state cache when moving between SDK entrypoints. */
export const transaction = (
  builder: TransactionBuilder,
): EffectTransactionBuilder => new EffectTransactionBuilder(builder)
