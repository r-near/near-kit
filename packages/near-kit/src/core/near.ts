/**
 * Main NEAR client class
 */

import { base64 } from "@scure/base"
import type { ContractMethods } from "../contracts/contract.js"
import { createContract } from "../contracts/contract.js"
import {
  AccountDoesNotExistError,
  ExternalCallRefusedError,
  ExternalCallTimeoutError,
  GlobalContractNotFoundError,
  NearError,
  ShardUnavailableError,
  UnknownTransactionError,
} from "../errors/index.js"
import { InMemoryKeyStore } from "../keys/index.js"
import { formatAmount } from "../utils/amount.js"
import { parseKey } from "../utils/key.js"
import { generateNonce } from "../utils/nep413.js"
import type { Amount, Gas } from "../utils/validation.js"
import {
  type BlockReference,
  type NearConfig,
  NearConfigSchema,
  resolveNetworkConfig,
} from "./config-schemas.js"
import { STORAGE_AMOUNT_PER_BYTE } from "./constants.js"
import {
  type ExternalCall,
  externalCallHash,
  externalCallUniqueId,
} from "./external-call.js"
import { RpcClient, type ViewFunctionOptions } from "./rpc/rpc.js"
import {
  type AccessKeyListResponse,
  type AccessKeyView,
  type ExternalCallOutcomeMap,
  ExternalCallOutcomeSchema,
  type ExternalCallOutcomeWithReceiptsMap,
  type FinalExecutionOutcome,
  type FinalExecutionOutcomeWithReceiptsMap,
  type ProtocolConfigResponse,
  type StateItem,
  type StatusResponse,
  type ViewStateResult,
} from "./rpc/rpc-schemas.js"
import { TransactionBuilder } from "./transaction.js"
import type {
  AccountState,
  CallOptions,
  ContractCodeResult,
  GlobalContractReference,
  KeyStore,
  SignedMessage,
  Signer,
  SignMessageParams,
  TxExecutionStatus,
  WalletConnection,
} from "./types.js"

/**
 * Main client for interacting with the NEAR blockchain.
 *
 * Wraps RPC access, key management, wallet integrations, and the fluent
 * transaction builder. Most applications create one `Near` instance per
 * network and reuse it for all operations.
 *
 * @remarks
 * Configure the client with {@link NearConfig} to choose networks, key stores,
 * wallets, and retry behavior. For a guided overview see
 * `docs/01-getting-started.md` and `docs/02-core-concepts.md`.
 */
export class Near {
  private _rpc!: RpcClient
  private keyStore!: KeyStore
  private signer?: Signer
  private wallet?: WalletConnection
  private defaultSignerId?: string
  private defaultWaitUntil: TxExecutionStatus
  private pendingKeyStoreInit?: Promise<void>

  constructor(config: NearConfig = {}) {
    const validatedConfig = NearConfigSchema.parse(config)

    this._initializeRpc(validatedConfig)
    this._resolveKeyStore(validatedConfig)
    this._resolveSigner(validatedConfig, config)

    if (validatedConfig.defaultSignerId) {
      this.defaultSignerId = validatedConfig.defaultSignerId
    }
    this.defaultWaitUntil =
      validatedConfig.defaultWaitUntil || "EXECUTED_OPTIMISTIC"
    this.wallet = validatedConfig.wallet
  }

  /**
   * The configured low-level JSON-RPC client.
   *
   * Use this as an escape hatch for advanced or low-level RPC calls that are
   * not wrapped by convenience methods on `Near` — for example
   * {@link RpcClient.receiptToTx}, {@link RpcClient.getBlock}, or
   * {@link RpcClient.getGasPrice}. The returned client is already configured
   * with this instance's network URL, headers, and retry settings.
   *
   * @example
   * ```typescript
   * const { transaction_hash, sender_account_id } =
   *   await near.rpc.receiptToTx("9ADoP8t3kRkV6JqYy3a6mJZ1uXuJ4Z3o2bF7tQwErTy")
   * ```
   */
  get rpc(): RpcClient {
    return this._rpc
  }

  /**
   * Initialize RPC client from configuration
   * @internal
   */
  private _initializeRpc(
    validatedConfig: ReturnType<typeof NearConfigSchema.parse>,
  ): void {
    const networkConfig = resolveNetworkConfig(validatedConfig.network)
    const rpcUrl = validatedConfig.rpcUrl || networkConfig.rpcUrl
    this._rpc = new RpcClient(
      rpcUrl,
      validatedConfig.headers,
      validatedConfig.retryConfig,
    )
  }

  /**
   * Resolve and initialize keystore from configuration
   * @internal
   */
  private _resolveKeyStore(
    validatedConfig: ReturnType<typeof NearConfigSchema.parse>,
  ): void {
    this.keyStore = this.resolveKeyStore(validatedConfig.keyStore)
  }

  /**
   * Resolve and initialize signer from configuration
   * Handles privateKey, custom signer, and sandbox root key auto-detection
   * @internal
   */
  private _resolveSigner(
    validatedConfig: ReturnType<typeof NearConfigSchema.parse>,
    originalConfig: NearConfig,
  ): void {
    const signer = validatedConfig.signer
    const privateKey = validatedConfig.privateKey

    if (signer) {
      // Custom signer function (e.g., hardware wallet)
      this.signer = signer
    } else if (privateKey) {
      // When privateKey is provided, add it to keyStore instead of creating a signer wrapper
      // This ensures consistent behavior - all key-based operations go through keyStore
      const keyPair =
        typeof privateKey === "string"
          ? parseKey(privateKey)
          : parseKey(privateKey.toString())

      // Determine which account ID to use for storing the key
      let accountId: string | undefined

      // If network is a Sandbox-like object with rootAccount, use that
      const network = originalConfig.network as unknown
      if (network && typeof network === "object" && "rootAccount" in network) {
        const rootAccount = (network as { rootAccount: { id: string } })
          .rootAccount
        accountId = rootAccount.id
      }

      // If defaultSignerId is provided, use that (takes precedence)
      if (validatedConfig.defaultSignerId) {
        accountId = validatedConfig.defaultSignerId
      }

      // Add the key to keyStore if we have an account ID
      // Store the promise to ensure async keystores complete initialization
      if (accountId) {
        this.pendingKeyStoreInit = this.keyStore.add(accountId, keyPair)
      }
    }

    // Auto-add sandbox root key to keyStore if available and no explicit signer/privateKey
    // This enables simple usage like: new Near({ network: sandbox })
    // while still allowing multi-account scenarios via keyStore
    if (!signer && !privateKey) {
      const network = originalConfig.network as unknown
      if (network && typeof network === "object" && "rootAccount" in network) {
        const rootAccount = network as {
          rootAccount: { id?: string; secretKey?: string }
        }
        // Guard: only auto-add if both id and secretKey are non-empty strings
        if (
          rootAccount.rootAccount?.id &&
          rootAccount.rootAccount?.secretKey &&
          typeof rootAccount.rootAccount.secretKey === "string"
        ) {
          const keyPair = parseKey(rootAccount.rootAccount.secretKey)
          // Store the promise to ensure async keystores complete initialization
          this.pendingKeyStoreInit = this.keyStore.add(
            rootAccount.rootAccount.id,
            keyPair,
          )
        }
      }
    }
  }

  /**
   * Ensure any pending keystore initialization is complete
   * @internal
   */
  private async ensureKeyStoreReady(): Promise<void> {
    if (this.pendingKeyStoreInit) {
      await this.pendingKeyStoreInit
      delete this.pendingKeyStoreInit
    }
  }

  /**
   * Resolve key store from config input
   * @internal
   */
  private resolveKeyStore(
    keyStoreConfig?: KeyStore | string | Record<string, string>,
  ): KeyStore {
    if (!keyStoreConfig) {
      return new InMemoryKeyStore()
    }

    if (typeof keyStoreConfig === "string") {
      // Import FileKeyStore dynamically to avoid bundling in browser
      // For now, return in-memory
      return new InMemoryKeyStore()
    }

    if ("add" in keyStoreConfig && "get" in keyStoreConfig) {
      return keyStoreConfig as KeyStore
    }

    // Record of account -> key mappings
    return new InMemoryKeyStore(keyStoreConfig as Record<string, string>)
  }

  /**
   * Get signer ID from options, default, or wallet
   * @internal
   */
  private async getSignerId(signerId?: string): Promise<string> {
    if (signerId) return signerId
    if (this.defaultSignerId) return this.defaultSignerId

    // Get from wallet if available
    if (this.wallet) {
      const accounts = await this.wallet.getAccounts()
      if (accounts.length === 0) {
        throw new NearError(
          "No accounts connected to wallet",
          "NO_WALLET_ACCOUNTS",
        )
      }
      // Safe to use non-null assertion after length check
      // biome-ignore lint/style/noNonNullAssertion: verified accounts[0] exists above
      return accounts[0]!.accountId
    }

    throw new NearError(
      "No signer ID provided. Set signerId in options or config.",
      "MISSING_SIGNER",
    )
  }

  /**
   * Call a view function on a contract (read-only, no gas).
   *
   * @param contractId - Target contract account ID.
   * @param methodName - Name of the view method to call.
   * @param args - Arguments object or raw bytes; defaults to `{}`.
   * @param options - Optional {@link BlockReference} to specify finality or block.
   *
   * @returns Parsed JSON result when the contract returns JSON, otherwise the
   * raw string value typed as `T`. Returns `undefined` when the contract returns
   * an empty response.
   *
   * @remarks
   * - View calls are free and do not require a signer or gas.
   * - Errors thrown by the contract surface as {@link ContractExecutionError}.
   * - The generic type `T` is a type assertion for convenience; no runtime
   *   validation is performed against `T`.
   *
   * @see NearConfig.defaultWaitUntil
   */
  async view<T = unknown>(
    contractId: string,
    methodName: string,
    args: object | Uint8Array = {},
    options?: ViewFunctionOptions,
  ): Promise<T | undefined> {
    const result = await this._rpc.viewFunction(
      contractId,
      methodName,
      args,
      options,
    )
    return decodeViewResult<T>(result.result)
  }

  /**
   * Send an external contract call (NEP-667, nearcore >= 2.15).
   *
   * An external call has no signer, key or nonce: the contract authorizes it
   * in its `__external_call` method, which gets `payload` as its input, and
   * pays for it from its own balance. A refused call is rolled back and nobody
   * pays. Because nobody signs it, the contract must check the payload itself
   * (typically a signature over a nonce, an expiry, the chain id and the
   * contract id).
   *
   * @param contractId - The contract the call goes to.
   * @param payload - The payload: raw bytes, or an object sent as JSON.
   * @param options - The universal account state init the call carries, and
   * the wait level (defaults to the client's `defaultWaitUntil`).
   *
   * @returns The outcome of the copy that landed. Its
   * `transaction_outcome.id` is the copy's unique id. At `"NONE"` there is no
   * outcome.
   *
   * @throws {ContractNotDeployedError} If the account has no contract or does not exist.
   * @throws {ExternalCallRefusedError} If the copy was refused at execution.
   * @throws {ExternalCallTimeoutError} If no copy was found before the node
   * timed out. Use {@link findExternalCall} with its `sentAtHeight` to look
   * for one.
   *
   * @example
   * ```typescript
   * const outcome = await near.externalCall("wallet.near", signedPayload)
   * console.log("unique id:", outcome.transaction_outcome.id)
   * ```
   */
  async externalCall<
    W extends keyof ExternalCallOutcomeMap = "EXECUTED_OPTIMISTIC",
  >(
    contractId: string,
    payload: object | Uint8Array,
    options: { stateInit?: Uint8Array; waitUntil?: W } = {},
  ): Promise<ExternalCallOutcomeMap[W]> {
    const call = toExternalCall(contractId, payload, options.stateInit)
    const waitUntil = (options.waitUntil ?? this.defaultWaitUntil) as W
    return this._rpc.sendExternalCall(call, waitUntil)
  }

  /**
   * Run an external call as the chunk producer's dry run would, without
   * sending it: a view call of `__external_call` (nearcore >= 2.15).
   *
   * @param contractId - The contract the call goes to.
   * @param payload - The payload: raw bytes, or an object sent as JSON.
   * @param options - Block reference (default: optimistic), and the
   * universal account state init the call carries, as for {@link externalCall}.
   *
   * @returns The run's decoded return value, as for {@link view}.
   *
   * @throws {ExternalCallRefusedError} If the contract would refuse the call,
   * with the reason and the run's logs.
   */
  async viewExternalCall<T = unknown>(
    contractId: string,
    payload: object | Uint8Array,
    options: BlockReference & { stateInit?: Uint8Array } = {},
  ): Promise<T | undefined> {
    const call = toExternalCall(contractId, payload, options.stateInit)
    const result = await this._rpc.viewExternalCall(call, options)
    return decodeViewResult<T>(result.result)
  }

  /**
   * Get the outcome and receipts of an external call's copy by its unique id
   * (nearcore >= 2.15).
   *
   * @param uniqueId - The copy's unique id.
   * @param contractId - The contract the call went to.
   * @param waitUntil - Execution status level to wait for.
   */
  async getExternalCallStatus<
    W extends keyof ExternalCallOutcomeWithReceiptsMap = "EXECUTED_OPTIMISTIC",
  >(
    uniqueId: string,
    contractId: string,
    waitUntil?: W,
  ): Promise<ExternalCallOutcomeWithReceiptsMap[W]> {
    return this._rpc.getExternalCallStatus(uniqueId, contractId, waitUntil)
  }

  /**
   * Find the copy of an external call the contract accepted, for example
   * after {@link externalCall} timed out (nearcore >= 2.15).
   *
   * A copy's unique id is the call hash combined with the height of the block
   * that includes it, so each height has one candidate id. The search tries
   * them from `fromHeight` up and returns the first accepted copy, skipping
   * copies refused when they ran. Without `toHeight` it stops at the current
   * head. With it, it waits for new blocks until the head passes `toHeight`:
   * pass the payload's expiry, after which the contract accepts no copy.
   *
   * With `resend`, the call is first sent again. A node that saw a copy land
   * returns it at once, and a call that never landed may land now. If that
   * finds no accepted copy, the search runs as above.
   *
   * @param contractId - The contract the call went to.
   * @param payload - The payload, exactly as sent.
   * @param options - `fromHeight` (e.g. `ExternalCallTimeoutError.sentAtHeight`),
   * `toHeight`, `resend`, the state init to resend with, and the wait level
   * of the returned outcome.
   *
   * @returns The outcome and receipts of the first accepted copy, or
   * `undefined` if no copy landed in the range.
   *
   * @throws {ExternalCallRefusedError} If every copy in the range was refused.
   * @throws {ShardUnavailableError} If the node does not track the contract's shard.
   *
   * @example
   * ```typescript
   * try {
   *   await near.externalCall("wallet.near", payload)
   * } catch (e) {
   *   if (e instanceof ExternalCallTimeoutError) {
   *     const found = await near.findExternalCall("wallet.near", payload, {
   *       fromHeight: e.sentAtHeight,
   *       toHeight: expiryHeight,
   *       resend: true,
   *     })
   *   }
   * }
   * ```
   */
  async findExternalCall<
    W extends keyof ExternalCallOutcomeWithReceiptsMap = "EXECUTED_OPTIMISTIC",
  >(
    contractId: string,
    payload: object | Uint8Array,
    options: {
      fromHeight: number
      toHeight?: number
      resend?: boolean
      stateInit?: Uint8Array
      waitUntil?: W
    },
  ): Promise<ExternalCallOutcomeWithReceiptsMap[W] | undefined> {
    const call = toExternalCall(contractId, payload, options.stateInit)
    const waitUntil = (options.waitUntil ?? "EXECUTED_OPTIMISTIC") as W
    const statusOf = (uniqueId: string) =>
      this._rpc.getExternalCallStatus(uniqueId, contractId, waitUntil)
    let refusal: ExternalCallRefusedError | undefined

    if (options.resend) {
      const landed = await this.resendExternalCall(call, waitUntil)
      if (landed instanceof ExternalCallRefusedError) {
        refusal = landed
      } else if (landed !== undefined) {
        return await statusOf(landed)
      }
    }

    const callHash = externalCallHash(call)
    let height = options.fromHeight
    for (;;) {
      const head = (await this._rpc.getBlock({ finality: "optimistic" })).header
        .height
      const end =
        options.toHeight === undefined ? head : Math.min(options.toHeight, head)
      while (height <= end) {
        const heights: number[] = []
        for (let h = height; h <= end && heights.length < 8; h++) {
          heights.push(h)
        }
        const probes = await Promise.all(
          heights.map((h) =>
            this.probeExternalCall(
              externalCallUniqueId(callHash, h),
              contractId,
            ),
          ),
        )
        for (const probe of probes) {
          if (probe instanceof ExternalCallRefusedError) {
            refusal = probe
          } else if (probe !== undefined) {
            return await statusOf(probe)
          }
        }
        height += heights.length
      }
      if (options.toHeight === undefined || height > options.toHeight) {
        if (refusal) throw refusal
        return undefined
      }
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }

  /**
   * Send a call again for {@link findExternalCall}: the unique id of the copy
   * the node found, its refusal, or `undefined` if the node can't tell.
   */
  private async resendExternalCall(
    call: ExternalCall,
    waitUntil: TxExecutionStatus,
  ): Promise<string | ExternalCallRefusedError | undefined> {
    try {
      const outcome = await this._rpc.sendExternalCall(
        call,
        waitUntil === "NONE" ? "INCLUDED" : waitUntil,
      )
      return outcome.transaction_outcome?.id
    } catch (error) {
      if (error instanceof ExternalCallRefusedError) return error
      if (error instanceof ExternalCallTimeoutError) return error.uniqueId
      if (error instanceof ShardUnavailableError && !error.retryable) {
        return undefined
      }
      throw error
    }
  }

  /**
   * Whether a copy with this unique id landed: its id if the contract
   * accepted it, its refusal if it was refused when it ran, `undefined` if
   * the node doesn't know it.
   */
  private async probeExternalCall(
    uniqueId: string,
    contractId: string,
  ): Promise<string | ExternalCallRefusedError | undefined> {
    let result: unknown
    try {
      result = await this._rpc.call("tx", {
        tx_hash: uniqueId,
        sender_account_id: contractId,
        wait_until: "NONE",
      })
    } catch (error) {
      if (error instanceof UnknownTransactionError) return undefined
      throw error
    }
    const copy = ExternalCallOutcomeSchema.parse(result).transaction_outcome
    const status = copy?.outcome.status
    if (copy && typeof status === "object" && "Failure" in status) {
      return new ExternalCallRefusedError(
        contractId,
        status.Failure,
        copy.outcome.logs,
        { uniqueId, blockHash: copy.block_hash },
      )
    }
    return uniqueId
  }

  /**
   * Get the protocol config (`EXPERIMENTAL_protocol_config`), including the
   * external call limits of nearcore 2.15.
   *
   * @param options - Block reference. Defaults to the latest final block.
   */
  async getProtocolConfig(
    options?: BlockReference,
  ): Promise<ProtocolConfigResponse> {
    return this._rpc.getProtocolConfig(options)
  }

  /**
   * Call a change function on a contract (requires signature and gas).
   *
   * Uses the connected wallet when available, otherwise falls back to the
   * configured signer / private key / key store.
   *
   * @param contractId - Target contract account ID.
   * @param methodName - Name of the change method to call.
   * @param args - Arguments object or raw bytes; defaults to `{}`.
   * @param options - Call options such as gas, attached deposit, signerId and wait level.
   *
   * @returns The decoded contract return value typed as `T`.
   *
   * @throws {NearError} If no signer can be resolved.
   * @throws {FunctionCallError} If the contract panics or returns an error.
   * @throws {InvalidTransactionError} If the transaction itself is invalid.
   * @throws {NetworkError} If the RPC request fails after retries.
   *
   * @example
   * ```typescript
   * await near.call(
   *   "contract.near",
   *   "increment",
   *   { by: 1 },
   *   { attachedDeposit: "1 yocto", gas: "30 Tgas" },
   * )
   * ```
   */
  async call<T = FinalExecutionOutcome>(
    contractId: string,
    methodName: string,
    args: object | Uint8Array = {},
    options: CallOptions = {},
  ): Promise<T> {
    const signerId = await this.getSignerId(options.signerId)

    const functionCallOptions: {
      gas?: Gas
      attachedDeposit?: Amount
    } = {}
    if (options.gas !== undefined) {
      functionCallOptions.gas = options.gas
    }
    if (options.attachedDeposit !== undefined) {
      functionCallOptions.attachedDeposit = options.attachedDeposit
    }

    const sendOptions = options.waitUntil
      ? { waitUntil: options.waitUntil }
      : {}

    const result = await this.transaction(signerId)
      .functionCall(contractId, methodName, args, functionCallOptions)
      .send(sendOptions)

    return result as T
  }

  /**
   * Send NEAR tokens to an account.
   *
   * @param receiverId - Account ID that will receive the tokens.
   * @param amount - Amount to send, expressed as {@link Amount} (e.g. `"10 NEAR"` or `"1 yocto"`).
   *
   * @returns The final transaction outcome from the wallet or RPC.
   *
   * @throws {NearError} If no signer can be resolved.
   * @throws {InvalidTransactionError} If the transfer transaction is invalid.
   * @throws {NetworkError} If the RPC request fails after retries.
   *
   * @remarks
   * This is a convenience wrapper over {@link Near.transaction} with a single
   * `transfer` action.
   */
  async send(
    receiverId: string,
    amount: Amount,
  ): Promise<FinalExecutionOutcome> {
    const signerId = await this.getSignerId()

    return await this.transaction(signerId).transfer(receiverId, amount).send()
  }

  /**
   * Sign a message using NEP-413 standard.
   *
   * NEP-413 enables off-chain message signing for authentication and ownership verification
   * without gas fees or blockchain transactions. Useful for:
   * - Login/authentication flows
   * - Proving account ownership
   * - Signing intents for meta-transactions
   * - Off-chain authorization
   *
   * @param params - Message signing parameters
   * @param options - Optional signer ID (defaults to first account)
   * @returns Signed message with account ID, public key, and signature
   *
   * @throws {NearError} If no wallet or keystore is configured
   * @throws {NearError} If the key doesn't support NEP-413 signing
   *
   * @see https://github.com/near/NEPs/blob/master/neps/nep-0413.md
   *
   * @example
   * ```typescript
   * // Sign a message for authentication
   * const signedMessage = await near.signMessage({
   *   message: "Login to MyApp",
   *   recipient: "myapp.near",
   *   nonce: crypto.getRandomValues(new Uint8Array(32)),
   * })
   *
   * // Send to backend for verification
   * await fetch("/api/auth", {
   *   method: "POST",
   *   body: JSON.stringify(signedMessage),
   * })
   * ```
   */
  async signMessage(
    params: SignMessageParams | Omit<SignMessageParams, "nonce">,
    options?: { signerId?: string },
  ): Promise<SignedMessage> {
    const signerId = await this.getSignerId(options?.signerId)

    // Add nonce if not provided
    const fullParams: SignMessageParams = {
      ...params,
      nonce: "nonce" in params ? params.nonce : generateNonce(),
    }

    // Try wallet first if available
    if (this.wallet?.signMessage) {
      try {
        return await this.wallet.signMessage(fullParams)
      } catch (error) {
        // Fall through to keystore if wallet doesn't support it
        console.warn("Wallet signMessage failed, trying keystore:", error)
      }
    }

    // Use keystore approach
    // Ensure any pending keystore initialization is complete
    await this.ensureKeyStoreReady()

    const keyPair = await this.keyStore.get(signerId)
    if (!keyPair) {
      throw new NearError(
        `No key found for account ${signerId}. Add a key using keyStore.add() or configure a wallet.`,
        "NO_KEY_FOUND",
      )
    }

    if (!keyPair.signNep413Message) {
      throw new NearError(
        "Key pair does not support NEP-413 message signing",
        "UNSUPPORTED_OPERATION",
      )
    }

    return keyPair.signNep413Message(signerId, fullParams)
  }

  /**
   * Calculate available balance from account data.
   *
   * The available balance accounts for the protocol rule that staked tokens
   * count towards the storage requirement:
   * - available = amount - max(0, storageRequired - locked)
   *
   * @internal
   */
  private calculateAvailableBalance(
    amount: string,
    locked: string,
    storageUsage: number,
  ): bigint {
    const amountBigInt = BigInt(amount)
    const lockedBigInt = BigInt(locked)
    const storageRequired = STORAGE_AMOUNT_PER_BYTE * BigInt(storageUsage)

    // If staked >= storage requirement, all liquid balance is available
    if (lockedBigInt >= storageRequired) {
      return amountBigInt
    }

    // Otherwise, some liquid balance is reserved for storage
    const reservedForStorage = storageRequired - lockedBigInt
    if (reservedForStorage >= amountBigInt) {
      return BigInt(0)
    }

    return amountBigInt - reservedForStorage
  }

  /**
   * Get the available (spendable) balance for an account in NEAR.
   *
   * This returns the amount that can actually be spent or transferred,
   * accounting for storage requirements. Staked tokens count towards
   * the storage requirement, so:
   * - If staked >= storage cost: all liquid balance is available
   * - If staked < storage cost: some liquid balance is reserved for storage
   *
   * @param accountId - Account ID to query.
   * @param options - Optional {@link BlockReference} to control finality or block.
   *
   * @returns Available balance formatted as a decimal string (e.g., "98.50").
   *
   * @throws {AccountDoesNotExistError} If the account does not exist.
   * @throws {NetworkError} If the RPC request fails.
   *
   * @remarks
   * For the full account state including all balance fields, use {@link getAccount}.
   *
   * @example
   * ```typescript
   * const available = await near.getBalance("alice.near")
   * console.log(`Can spend: ${available} NEAR`)
   * ```
   */
  async getBalance(
    accountId: string,
    options?: BlockReference,
  ): Promise<string> {
    const account = await this._rpc.getAccount(accountId, options)

    const available = this.calculateAvailableBalance(
      account.amount,
      account.locked,
      account.storage_usage,
    )

    return formatAmount(available.toString(), {
      precision: 2,
      includeSuffix: false,
    })
  }

  /**
   * Get complete account state including all balance information.
   *
   * Returns a user-friendly object with computed fields like `available`
   * (the actually spendable balance) and `storageUsage` (NEAR reserved for storage).
   *
   * @param accountId - Account ID to query.
   * @param options - Optional {@link BlockReference} to control finality or block.
   *
   * @returns Complete account state with all balance fields.
   *
   * @throws {AccountDoesNotExistError} If the account does not exist.
   * @throws {NetworkError} If the RPC request fails.
   *
   * @example
   * ```typescript
   * const account = await near.getAccount("alice.near")
   * console.log(`Balance: ${account.balance} NEAR`)
   * console.log(`Available to spend: ${account.available} NEAR`)
   * console.log(`Staked: ${account.staked} NEAR`)
   * console.log(`Storage: ${account.storageUsage} NEAR (${account.storageBytes} bytes)`)
   * console.log(`Has contract: ${account.hasContract}`)
   * ```
   */
  async getAccount(
    accountId: string,
    options?: BlockReference,
  ): Promise<AccountState> {
    const account = await this._rpc.getAccount(accountId, options)

    const available = this.calculateAvailableBalance(
      account.amount,
      account.locked,
      account.storage_usage,
    )

    const storageRequired =
      STORAGE_AMOUNT_PER_BYTE * BigInt(account.storage_usage)

    // Code hash for accounts without contracts
    const emptyCodeHash = "11111111111111111111111111111111"

    return {
      balance: formatAmount(account.amount, {
        precision: 2,
        includeSuffix: false,
      }),
      available: formatAmount(available.toString(), {
        precision: 2,
        includeSuffix: false,
      }),
      staked: formatAmount(account.locked, {
        precision: 2,
        includeSuffix: false,
      }),
      storageUsage: formatAmount(storageRequired.toString(), {
        precision: 4,
        includeSuffix: false,
      }),
      storageBytes: account.storage_usage,
      hasContract:
        account.code_hash !== emptyCodeHash ||
        account.global_contract_hash != null ||
        account.global_contract_account_id != null,
      codeHash: account.code_hash,
    }
  }

  /**
   * Check if an account exists.
   *
   * @param accountId - Account ID to check.
   * @param options - Optional {@link BlockReference} to control finality or block.
   *
   * @returns `true` if the account exists, `false` otherwise.
   *
   * @remarks
   * This method swallows all errors and returns `false` on failure. Use
   * {@link RpcClient.getAccount} if you need to distinguish error causes.
   */
  async accountExists(
    accountId: string,
    options?: BlockReference,
  ): Promise<boolean> {
    try {
      await this._rpc.getAccount(accountId, options)
      return true
    } catch {
      return false
    }
  }

  /**
   * Get access key information for an account.
   *
   * @param accountId - Account ID to check.
   * @param publicKey - Public key string (e.g., "ed25519:...").
   * @param options - Optional {@link BlockReference} to control finality or block.
   *
   * @returns Access key information if it exists, `null` otherwise.
   *
   * @remarks
   * This method retrieves detailed information about a specific access key,
   * including its nonce and permission type (FullAccess or FunctionCall).
   *
   * @example
   * ```typescript
   * const accessKey = await near.getAccessKey("alice.near", "ed25519:...")
   * if (accessKey && accessKey.permission === "FullAccess") {
   *   console.log("Key is a full access key")
   * }
   * ```
   */
  async getAccessKey(
    accountId: string,
    publicKey: string,
    options?: BlockReference,
  ): Promise<AccessKeyView | null> {
    try {
      return await this._rpc.getAccessKey(accountId, publicKey, options)
    } catch {
      return null
    }
  }

  /**
   * Get all access keys for an account.
   *
   * @param accountId - Account ID to list keys for.
   * @param options - Optional {@link BlockReference} to control finality or block.
   *
   * @returns List of access keys with their public keys and permissions.
   *
   * @remarks
   * This method retrieves all access keys associated with an account,
   * including both full access keys and function call keys.
   *
   * @example
   * ```typescript
   * const keys = await near.getAccessKeys("alice.near")
   * for (const key of keys.keys) {
   *   console.log(key.public_key, key.access_key.permission)
   * }
   * ```
   */
  async getAccessKeys(
    accountId: string,
    options?: BlockReference,
  ): Promise<AccessKeyListResponse> {
    return this._rpc.getAccessKeys(accountId, options)
  }

  /**
   * Get the WASM code deployed on a contract account.
   *
   * @param accountId - Account whose contract code to fetch.
   * @param options - Optional {@link BlockReference} to control finality or block.
   *
   * @returns The contract's WASM bytecode and its base58-encoded SHA-256 hash.
   *
   * @throws {ContractNotDeployedError} If the account has no contract deployed.
   * @throws {AccountDoesNotExistError} If the account does not exist.
   * @throws {NetworkError} If the RPC request fails.
   *
   * @remarks
   * If you only need the code hash, {@link getAccount} returns it without
   * downloading the code itself.
   *
   * @example
   * ```typescript
   * const { code, hash } = await near.getContractCode("contract.near")
   * console.log(`${code.length} bytes, hash ${hash}`)
   * ```
   */
  async getContractCode(
    accountId: string,
    options?: BlockReference,
  ): Promise<ContractCodeResult> {
    const view = await this._rpc.viewCode(accountId, options)
    return { code: base64.decode(view.code_base64), hash: view.hash }
  }

  /**
   * Get a contract published in the global contract registry.
   *
   * Accepts the same reference shape as
   * {@link TransactionBuilder.deployFromPublished}: `{ codeHash }` for
   * immutable contracts or `{ accountId }` for updatable ones.
   *
   * @param contract - {@link GlobalContractReference} identifying the published contract.
   * @param options - Optional {@link BlockReference} to control finality or block.
   *
   * @returns The published WASM bytecode and its base58-encoded SHA-256 hash.
   *
   * @throws {GlobalContractNotFoundError} If no code is published under the identifier.
   * @throws {NetworkError} If the RPC request fails.
   *
   * @remarks
   * Requires a nearcore >= 2.7 node. For updatable contracts (`{ accountId }`),
   * the returned `hash` is the current version's code hash — compare it against
   * a locally computed hash to detect upstream updates.
   *
   * @example
   * ```typescript
   * // Current code published by a factory (updatable)
   * const { code, hash } = await near.getGlobalContract({
   *   accountId: "factory.near",
   * })
   *
   * // Immutable contract by its code hash
   * const published = await near.getGlobalContract({ codeHash: "9wa3..." })
   * ```
   */
  async getGlobalContract(
    contract: GlobalContractReference,
    options?: BlockReference,
  ): Promise<ContractCodeResult> {
    const view = await this._rpc.viewGlobalContractCode(contract, options)
    return { code: base64.decode(view.code_base64), hash: view.hash }
  }

  /**
   * Check whether a contract is published in the global contract registry.
   *
   * @param contract - {@link GlobalContractReference} identifying the published contract.
   * @param options - Optional {@link BlockReference} to control finality or block.
   *
   * @returns `true` if code is published under the identifier, `false` otherwise.
   *
   * @remarks
   * Only "not found" results map to `false`; other failures (network errors,
   * unsupported node version) are re-thrown. The underlying RPC returns the
   * full WASM code — there is no lighter hash-only query — so prefer caching
   * the result over calling this in a hot path.
   *
   * @example
   * ```typescript
   * if (await near.globalContractExists({ accountId: "factory.near" })) {
   *   // safe to deployFromPublished
   * }
   * ```
   */
  async globalContractExists(
    contract: GlobalContractReference,
    options?: BlockReference,
  ): Promise<boolean> {
    try {
      await this._rpc.viewGlobalContractCode(contract, options)
      return true
    } catch (error) {
      // Current nodes answer a global-contract query for a nonexistent
      // account with NO_GLOBAL_CONTRACT_CODE (the lookup is by identifier,
      // not account), but treat UNKNOWN_ACCOUNT as "not published" too.
      if (
        error instanceof GlobalContractNotFoundError ||
        error instanceof AccountDoesNotExistError
      ) {
        return false
      }
      throw error
    }
  }

  /**
   * Get transaction status with detailed receipt information
   *
   * Queries the status of a transaction by hash using the EXPERIMENTAL_tx_status RPC method,
   * returning the final transaction result with detailed receipt information.
   *
   * @param txHash - Transaction hash to query
   * @param senderAccountId - Account ID that sent the transaction (used to determine shard)
   * @param waitUntil - Optional execution level to wait for (default: "EXECUTED_OPTIMISTIC")
   *
   * @returns Transaction status with receipts, typed based on waitUntil parameter
   *
   * @throws {InvalidTransactionError} If transaction execution failed
   * @throws {NetworkError} If network request failed
   *
   * @example
   * ```typescript
   * // Get transaction status with default wait level
   * const status = await near.getTransactionStatus(
   *   '7AfonAhbK4ZbdBU9VPcQdrTZVZBXE25HmZAMEABs9To1',
   *   'alice.near'
   * )
   *
   * // Wait for full finality
   * const finalStatus = await near.getTransactionStatus(
   *   '7AfonAhbK4ZbdBU9VPcQdrTZVZBXE25HmZAMEABs9To1',
   *   'alice.near',
   *   'FINAL'
   * )
   *
   * // Access receipt details
   * console.log('Receipts:', finalStatus.receipts)
   * ```
   *
   * @see {@link https://docs.near.org/api/rpc/transactions#transaction-status-with-receipts NEAR RPC Documentation}
   */
  async getTransactionStatus<
    W extends
      | "NONE"
      | "INCLUDED"
      | "EXECUTED_OPTIMISTIC"
      | "INCLUDED_FINAL"
      | "EXECUTED"
      | "FINAL" = "EXECUTED_OPTIMISTIC",
  >(
    txHash: string,
    senderAccountId: string,
    waitUntil?: W,
  ): Promise<
    W extends keyof FinalExecutionOutcomeWithReceiptsMap
      ? FinalExecutionOutcomeWithReceiptsMap[W]
      : never
  > {
    return this._rpc.getTransactionStatus(
      txHash,
      senderAccountId,
      waitUntil,
    ) as Promise<
      W extends keyof FinalExecutionOutcomeWithReceiptsMap
        ? FinalExecutionOutcomeWithReceiptsMap[W]
        : never
    >
  }

  /**
   * Get network status information.
   *
   * @returns The full network status response from the RPC.
   */
  async getStatus(): Promise<StatusResponse> {
    return this._rpc.getStatus()
  }

  /**
   * Read a single page of a contract's state via `view_state`.
   *
   * Returns base64-encoded key/value entries. Use `options.afterKey` (the
   * `last_key` from a previous page) to paginate, or {@link viewStateAll} to
   * iterate everything.
   *
   * @param accountId - Account whose contract state to read.
   * @param options - Optional `prefix`, `afterKey`, `limit`, `includeProof`, and block reference.
   */
  async viewState(
    accountId: string,
    options?: BlockReference & {
      prefix?: string
      afterKey?: string
      limit?: number
      includeProof?: boolean
    },
  ): Promise<ViewStateResult> {
    return this._rpc.viewState(accountId, options)
  }

  /**
   * Iterate every entry of a contract's state via `view_state`, following the
   * pagination cursor across pages.
   *
   * @param accountId - Account whose contract state to read.
   * @param options - Optional `prefix`, per-request `limit`, and block reference.
   *
   * @example
   * ```typescript
   * for await (const { key, value } of near.viewStateAll("contract.near")) {
   *   // process each entry
   * }
   * ```
   */
  viewStateAll(
    accountId: string,
    options?: BlockReference & { prefix?: string; limit?: number },
  ): AsyncGenerator<StateItem> {
    return this._rpc.viewStateAll(accountId, options)
  }

  /**
   * Batch multiple read operations.
   *
   * @param promises - Promises to execute in parallel.
   *
   * @returns A tuple of resolved values preserving the input order.
   *
   * @remarks
   * This is a thin wrapper over `Promise.all` with a tuple-friendly signature.
   * It does not perform any RPC-level batching.
   */
  async batch<T extends unknown[]>(
    ...promises: Array<Promise<T[number]>>
  ): Promise<T> {
    return Promise.all(promises) as Promise<T>
  }

  /**
   * Create a transaction builder for the specified signer account.
   *
   * The `signerId` determines which account will sign and send this transaction.
   * This account must have keys available in the configured keyStore, privateKey,
   * custom signer, or be connected via wallet.
   *
   * @param signerId - The account ID that will sign and pay for this transaction
   *
   * @returns A transaction builder for chaining actions
   *
   * @example
   * ```typescript
   * // Alice sends NEAR to Bob
   * await near.transaction('alice.near')
   *   .transfer('bob.near', '10 NEAR')
   *   .send()
   *
   * // Alice calls a contract and creates a new account
   * await near.transaction('alice.near')
   *   .functionCall('market.near', 'buy', { id: 123 })
   *   .createAccount('sub.alice.near')
   *   .transfer('sub.alice.near', '5 NEAR')
   *   .send()
   * ```
   *
   * @see {@link TransactionBuilder} for available actions
   */
  transaction(signerId: string): TransactionBuilder {
    return new TransactionBuilder(
      signerId,
      this._rpc,
      this.keyStore,
      this.signer,
      this.defaultWaitUntil,
      this.wallet,
      this.pendingKeyStoreInit ? () => this.ensureKeyStoreReady() : undefined,
    )
  }

  /**
   * Create a type-safe contract interface.
   *
   * @param contractId - Account ID of the target contract.
   *
   * @returns A proxy implementing your {@link ContractMethods} interface.
   *
   * @example
   * ```typescript
   * type Counter = Contract<{
   *   view: { get_count: () => Promise<number> }
   *   call: { increment: () => Promise<void> }
   * }>
   *
   * const counter = near.contract<Counter>("counter.near")
   * ```
   */
  contract<T extends ContractMethods>(contractId: string): T {
    return createContract<T>(this, contractId)
  }
}

/**
 * Decode a view call's return bytes: JSON if it parses, else the string, or
 * `undefined` for an empty result.
 * @internal
 */
function decodeViewResult<T>(bytes: number[]): T | undefined {
  const resultString = new TextDecoder().decode(new Uint8Array(bytes))
  if (!resultString) {
    return undefined
  }
  try {
    return JSON.parse(resultString) as T
  } catch {
    return resultString as T
  }
}

/**
 * Build an {@link ExternalCall}, sending an object payload as JSON.
 * @internal
 */
function toExternalCall(
  contractId: string,
  payload: object | Uint8Array,
  stateInit?: Uint8Array,
): ExternalCall {
  const bytes =
    payload instanceof Uint8Array
      ? payload
      : new TextEncoder().encode(JSON.stringify(payload))
  return stateInit === undefined
    ? { contractId, payload: bytes }
    : { contractId, payload: bytes, stateInit }
}
