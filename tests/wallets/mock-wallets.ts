/**
 * Mock wallet implementations for testing
 */

import type {
  Action,
  FinalExecutionOutcome,
  SignedMessage,
  WalletAccount,
} from "../../src/core/types.js"

/**
 * Mock wallet that simulates @near-wallet-selector/core behavior
 */
export class MockWalletSelector {
  private accounts: WalletAccount[]
  private callLog: Array<{ method: string; params: unknown }> = []

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
    actions: Action[]
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
        actions: params.actions as unknown,
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
  private callLog: Array<{ method: string; params: unknown }> = []

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
 */
class MockHotConnectWallet {
  private accounts: WalletAccount[]
  private callLog: Array<{ method: string; params: unknown }> = []

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
    actions: Action[]
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
        actions: params.actions as unknown,
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
    this.accounts = accounts
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
    actions: Action[]
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
        actions: params.actions as unknown,
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
