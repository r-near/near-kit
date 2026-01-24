/**
 * Mock wallet implementations for testing
 *
 * These mocks are structurally compatible with wallet-selector and HOT Connect
 * wallet interfaces. We use type assertions to bridge the nominal vs structural
 * typing gap.
 */

import type {
  FinalExecutionOutcome,
  SignedMessage,
  WalletAccount,
} from "../../src/core/types.js"

type TransactionParams = {
  signerId?: string
  receiverId: string
  actions: unknown[]
}

type CallLogEntry =
  | { method: "getAccounts"; params: Record<string, never> }
  | { method: "signAndSendTransaction"; params: TransactionParams }
  | {
      method: "signMessage"
      params: { message: string; recipient: string; nonce: Uint8Array }
    }
  | { method: "wallet"; params: Record<string, never> }

/**
 * Mock wallet that simulates @near-wallet-selector/core behavior
 */
export class MockWalletSelector {
  private accounts: WalletAccount[]
  private callLog: CallLogEntry[] = []

  constructor(accounts: WalletAccount[] = []) {
    this.accounts = accounts
  }

  async getAccounts(): Promise<WalletAccount[]> {
    this.callLog.push({ method: "getAccounts", params: {} })
    return this.accounts
  }

  async signAndSendTransaction(params: {
    signerId?: string
    receiverId: string
    actions: unknown[]
  }): Promise<FinalExecutionOutcome> {
    this.callLog.push({ method: "signAndSendTransaction", params })

    // Return a mock successful outcome in RPC format
    return {
      final_execution_status: "FINAL",
      status: { SuccessValue: "" },
      transaction: {
        signer_id:
          params.signerId || this.accounts[0]?.accountId || "test.near",
        public_key: "ed25519:...",
        nonce: 1,
        receiver_id: params.receiverId,
        // biome-ignore lint/suspicious/noExplicitAny: RPC schema expects any[] for transaction actions
        actions: params.actions as any,
        signature: "ed25519:...",
        hash: "mock-tx-hash",
      },
      transaction_outcome: {
        id: "mock-tx-id",
        outcome: {
          logs: [],
          receipt_ids: [],
          gas_burnt: 1000000,
          tokens_burnt: "0",
          executor_id: params.signerId || this.accounts[0]?.accountId || "",
          status: { SuccessValue: "" },
        },
        block_hash: "mock-block-hash",
        proof: [],
      },
      receipts_outcome: [],
    }
  }

  async signMessage(params: {
    message: string
    recipient: string
    nonce: Uint8Array
  }): Promise<SignedMessage> {
    this.callLog.push({ method: "signMessage", params })

    return {
      accountId: this.accounts[0]?.accountId || "test.near",
      publicKey: this.accounts[0]?.publicKey || "ed25519:...",
      signature: "mock-signature",
    }
  }

  // Test helpers
  getCallLog() {
    return this.callLog
  }

  clearCallLog() {
    this.callLog = []
  }

  setAccounts(accounts: WalletAccount[]) {
    this.accounts = accounts
  }
}

/**
 * Mock wallet that simulates @hot-labs/near-connect behavior
 */
export class MockHotConnect {
  private _wallet: MockHotConnectWallet
  private callLog: CallLogEntry[] = []

  constructor(accounts: WalletAccount[] = []) {
    this._wallet = new MockHotConnectWallet(accounts)
  }

  async wallet(): Promise<MockHotConnectWallet> {
    this.callLog.push({ method: "wallet", params: {} })
    return this._wallet
  }

  // Event handlers (simplified for testing)
  on(_event: string, _callback: (...args: never[]) => unknown) {
    // Mock implementation - not used in tests
  }

  // Test helpers
  getCallLog() {
    return [...this.callLog, ...this._wallet.getCallLog()]
  }

  clearCallLog() {
    this.callLog = []
    this._wallet.clearCallLog()
  }

  setAccounts(accounts: WalletAccount[]) {
    this._wallet.setAccounts(accounts)
  }
}

/**
 * Mock wallet instance returned by HOT Connect
 * HOT Connect requires publicKey to always be present
 */
class MockHotConnectWallet {
  private accounts: Array<{ accountId: string; publicKey: string }>
  private callLog: CallLogEntry[] = []

  constructor(accounts: WalletAccount[] = []) {
    // HOT Connect requires publicKey - ensure all accounts have it
    this.accounts = accounts.map((acc) => ({
      accountId: acc.accountId,
      publicKey: acc.publicKey || "ed25519:default",
    }))
  }

  async getAccounts(): Promise<
    Array<{ accountId: string; publicKey: string }>
  > {
    this.callLog.push({ method: "getAccounts", params: {} })
    return this.accounts
  }

  async signAndSendTransaction(params: {
    signerId?: string
    receiverId: string
    actions: unknown[]
  }): Promise<FinalExecutionOutcome> {
    this.callLog.push({ method: "signAndSendTransaction", params })

    // Return a mock successful outcome in RPC format
    return {
      final_execution_status: "FINAL",
      status: { SuccessValue: "" },
      transaction: {
        signer_id:
          params.signerId || this.accounts[0]?.accountId || "test.near",
        public_key: "ed25519:...",
        nonce: 1,
        receiver_id: params.receiverId,
        // biome-ignore lint/suspicious/noExplicitAny: RPC schema expects any[] for transaction actions
        actions: params.actions as any,
        signature: "ed25519:...",
        hash: "mock-tx-hash",
      },
      transaction_outcome: {
        id: "mock-tx-id",
        outcome: {
          logs: [],
          receipt_ids: [],
          gas_burnt: 1000000,
          tokens_burnt: "0",
          executor_id: params.signerId || this.accounts[0]?.accountId || "",
          status: { SuccessValue: "" },
        },
        block_hash: "mock-block-hash",
        proof: [],
      },
      receipts_outcome: [],
    }
  }

  async signMessage(params: {
    message: string
    recipient: string
    nonce: Uint8Array
  }): Promise<SignedMessage> {
    this.callLog.push({ method: "signMessage", params })

    return {
      accountId: this.accounts[0]?.accountId || "test.near",
      publicKey: this.accounts[0]?.publicKey || "ed25519:...",
      signature: "mock-signature",
    }
  }

  getCallLog() {
    return this.callLog
  }

  clearCallLog() {
    this.callLog = []
  }

  setAccounts(accounts: WalletAccount[]) {
    // HOT Connect requires publicKey - ensure all accounts have it
    this.accounts = accounts.map((acc) => ({
      accountId: acc.accountId,
      publicKey: acc.publicKey || "ed25519:default",
    }))
  }
}

/**
 * Mock wallet that doesn't support signMessage
 */
export class MockWalletWithoutSignMessage {
  private accounts: WalletAccount[]

  constructor(accounts: WalletAccount[] = []) {
    this.accounts = accounts
  }

  async getAccounts(): Promise<WalletAccount[]> {
    return this.accounts
  }

  async signAndSendTransaction(params: {
    signerId?: string
    receiverId: string
    actions: unknown[]
  }): Promise<FinalExecutionOutcome> {
    // Return a mock successful outcome in RPC format
    return {
      final_execution_status: "FINAL",
      status: { SuccessValue: "" },
      transaction: {
        signer_id:
          params.signerId || this.accounts[0]?.accountId || "test.near",
        public_key: "ed25519:...",
        nonce: 1,
        receiver_id: params.receiverId,
        // biome-ignore lint/suspicious/noExplicitAny: RPC schema expects any[] for transaction actions
        actions: params.actions as any,
        signature: "ed25519:...",
        hash: "mock-tx-hash",
      },
      transaction_outcome: {
        id: "mock-tx-id",
        outcome: {
          logs: [],
          receipt_ids: [],
          gas_burnt: 1000000,
          tokens_burnt: "0",
          executor_id: params.signerId || this.accounts[0]?.accountId || "",
          status: { SuccessValue: "" },
        },
        block_hash: "mock-block-hash",
        proof: [],
      },
      receipts_outcome: [],
    }
  }

  // Note: No signMessage method
}
