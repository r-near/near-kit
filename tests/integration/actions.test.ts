/**
 * Integration tests for transaction actions
 *
 * Tests actions with low coverage:
 * - deleteAccount
 * - stake/unstake
 * - addKey/deleteKey
 * - deployContract
 * - publishContract/deployFromPublished
 * - delegate actions (meta-transactions)
 */

import { readFileSync } from "node:fs"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { Near } from "../../src/core/near.js"
import { decodeSignedDelegateAction } from "../../src/core/schema.js"
import { Sandbox } from "../../src/sandbox/sandbox.js"
import { generateKey } from "../../src/utils/key.js"

describe("Transaction Actions - Integration Tests", () => {
  let sandbox: Sandbox
  let near: Near
  let rootKey: string

  beforeAll(async () => {
    sandbox = await Sandbox.start()
    rootKey = sandbox.rootAccount.secretKey

    near = new Near({
      network: sandbox,
      keyStore: {
        [sandbox.rootAccount.id]: rootKey,
      },
    })

    console.log(`✓ Sandbox started: ${sandbox.rootAccount.id}`)
  }, 120000)

  afterAll(async () => {
    if (sandbox) {
      await sandbox.stop()
    }
  })

  describe("deleteAccount action", () => {
    test("should delete account and transfer remaining balance to beneficiary", async () => {
      const accountKey = generateKey()
      const accountId = `deleteme-${Date.now()}.${sandbox.rootAccount.id}`
      const beneficiaryKey = generateKey()
      const beneficiaryId = `beneficiary-${Date.now()}.${
        sandbox.rootAccount.id
      }`

      // Create the account to be deleted
      await near
        .transaction(sandbox.rootAccount.id)
        .createAccount(accountId)
        .transfer(accountId, "5 NEAR")
        .addKey(accountKey.publicKey.toString(), {
          type: "fullAccess",
        })
        .send()

      // Create beneficiary account
      await near
        .transaction(sandbox.rootAccount.id)
        .createAccount(beneficiaryId)
        .transfer(beneficiaryId, "1 NEAR")
        .addKey(beneficiaryKey.publicKey.toString(), {
          type: "fullAccess",
        })
        .send()

      console.log(`✓ Created accounts: ${accountId}, ${beneficiaryId}`)

      // Get beneficiary balance before deletion
      const balanceBefore = await near.getBalance(beneficiaryId)
      const balanceBeforeNum = Number.parseFloat(balanceBefore)

      // Add the new account key to keyStore so we can sign transactions from it
      const nearWithNewKey = new Near({
        network: sandbox,
        keyStore: {
          [accountId]: accountKey.secretKey,
        },
      })

      // Delete the account
      await nearWithNewKey
        .transaction(accountId)
        .deleteAccount({ beneficiary: beneficiaryId })
        .send()

      console.log(`✓ Account deleted: ${accountId}`)

      // Verify account no longer exists
      const exists = await near.accountExists(accountId)
      expect(exists).toBe(false)

      // Verify beneficiary received the balance (or at least didn't lose any)
      // Note: Balance may not increase much due to transaction fees and storage costs
      const balanceAfter = await near.getBalance(beneficiaryId)
      const balanceAfterNum = Number.parseFloat(balanceAfter)
      expect(balanceAfterNum).toBeGreaterThanOrEqual(balanceBeforeNum)

      console.log(
        `✓ Beneficiary balance after deletion: ${balanceBefore} → ${balanceAfter} NEAR`,
      )
    }, 30000)

    test("should throw error when trying to delete non-existent account", async () => {
      const fakeAccountId = `fake-${Date.now()}.${sandbox.rootAccount.id}`

      await expect(async () => {
        await near
          .transaction(fakeAccountId)
          .deleteAccount({ beneficiary: sandbox.rootAccount.id })
          .send()
      }).rejects.toThrow()
    }, 30000)
  })

  describe("stake action", () => {
    test("should stake NEAR tokens", async () => {
      // Note: Staking requires a validator node setup, which sandbox may not fully support
      // This test verifies the transaction is constructed and sent correctly
      const validatorKey = generateKey()
      const validatorId = `validator-${Date.now()}.${sandbox.rootAccount.id}`

      // Create validator account with enough balance for minimum stake
      // Sandbox minimum stake is ~800,128 NEAR
      await near
        .transaction(sandbox.rootAccount.id)
        .createAccount(validatorId)
        .transfer(validatorId, "1000000 NEAR")
        .addKey(validatorKey.publicKey.toString(), {
          type: "fullAccess",
        })
        .send()

      console.log(`✓ Created validator account: ${validatorId}`)

      // Add validator key to keyStore
      const nearWithValidatorKey = new Near({
        network: sandbox,
        keyStore: {
          [validatorId]: validatorKey.secretKey,
        },
      })

      // Stake with the validator public key
      await nearWithValidatorKey
        .transaction(validatorId)
        .stake(validatorKey.publicKey.toString(), "900000 NEAR")
        .send()
      console.log(`✓ Stake transaction sent successfully`)
    }, 30000)
  })

  describe("addKey and deleteKey actions", () => {
    test("should add a full access key to an account", async () => {
      const accountKey = generateKey()
      const accountId = `keytest-${Date.now()}.${sandbox.rootAccount.id}`

      // Create account
      await near
        .transaction(sandbox.rootAccount.id)
        .createAccount(accountId)
        .transfer(accountId, "5 NEAR")
        .addKey(accountKey.publicKey.toString(), {
          type: "fullAccess",
        })
        .send()

      console.log(`✓ Account created with initial key: ${accountId}`)

      // Add a second key
      const secondKey = generateKey()

      const nearWithAccountKey = new Near({
        network: sandbox,
        keyStore: {
          [accountId]: accountKey.secretKey,
        },
      })

      await nearWithAccountKey
        .transaction(accountId)
        .addKey(secondKey.publicKey.toString(), {
          type: "fullAccess",
        })
        .send()

      console.log(`✓ Second key added: ${secondKey.publicKey.toString()}`)

      // Verify the new key works by making a transaction with it
      const nearWithSecondKey = new Near({
        network: sandbox,
        keyStore: {
          [accountId]: secondKey.secretKey,
        },
      })

      // Use the second key to make a simple transfer
      const balanceBefore = await near.getBalance(sandbox.rootAccount.id)

      await nearWithSecondKey
        .transaction(accountId)
        .transfer(sandbox.rootAccount.id, "0.1 NEAR")
        .send()

      const balanceAfter = await near.getBalance(sandbox.rootAccount.id)
      expect(Number.parseFloat(balanceAfter)).toBeGreaterThan(
        Number.parseFloat(balanceBefore),
      )

      console.log(`✓ Second key successfully used for transaction`)
    }, 30000)

    test("should add a function call access key", async () => {
      const accountKey = generateKey()
      const accountId = `funckey-${Date.now()}.${sandbox.rootAccount.id}`

      // Create account
      await near
        .transaction(sandbox.rootAccount.id)
        .createAccount(accountId)
        .transfer(accountId, "5 NEAR")
        .addKey(accountKey.publicKey.toString(), {
          type: "fullAccess",
        })
        .send()

      // Add a function call access key
      const functionKey = generateKey()

      const nearWithAccountKey = new Near({
        network: sandbox,
        keyStore: {
          [accountId]: accountKey.secretKey,
        },
      })

      await nearWithAccountKey
        .transaction(accountId)
        .addKey(functionKey.publicKey.toString(), {
          type: "functionCall",
          receiverId: "contract.near",
          methodNames: ["method1", "method2"],
          allowance: "1 NEAR",
        })
        .send()

      console.log(
        `✓ Function call key added: ${functionKey.publicKey.toString()}`,
      )
    }, 30000)

    test("should delete a key from an account", async () => {
      const accountKey = generateKey()
      const accountId = `delkey-${Date.now()}.${sandbox.rootAccount.id}`
      const keyToDelete = generateKey()

      // Create account with two keys
      await near
        .transaction(sandbox.rootAccount.id)
        .createAccount(accountId)
        .transfer(accountId, "5 NEAR")
        .addKey(accountKey.publicKey.toString(), {
          type: "fullAccess",
        })
        .send()

      const nearWithAccountKey = new Near({
        network: sandbox,
        keyStore: {
          [accountId]: accountKey.secretKey,
        },
      })

      // Add second key
      await nearWithAccountKey
        .transaction(accountId)
        .addKey(keyToDelete.publicKey.toString(), {
          type: "fullAccess",
        })
        .send()

      console.log(`✓ Added key to delete: ${keyToDelete.publicKey.toString()}`)

      // Delete the key
      await nearWithAccountKey
        .transaction(accountId)
        .deleteKey(accountId, keyToDelete.publicKey.toString())
        .send()

      console.log(`✓ Key deleted: ${keyToDelete.publicKey.toString()}`)

      // Verify the deleted key no longer works
      const nearWithDeletedKey = new Near({
        network: sandbox,
        keyStore: {
          [accountId]: keyToDelete.secretKey,
        },
      })

      await expect(async () => {
        await nearWithDeletedKey
          .transaction(accountId)
          .transfer(sandbox.rootAccount.id, "1 NEAR")
          .send()
      }).rejects.toThrow()

      console.log(`✓ Deleted key cannot sign transactions`)
    }, 30000)
  })

  describe("deployContract action", () => {
    test("should deploy a contract to an account", async () => {
      const accountKey = generateKey()
      const accountId = `contract-${Date.now()}.${sandbox.rootAccount.id}`

      // Create account
      await near
        .transaction(sandbox.rootAccount.id)
        .createAccount(accountId)
        .transfer(accountId, "10 NEAR")
        .addKey(accountKey.publicKey.toString(), {
          type: "fullAccess",
        })
        .send()

      console.log(`✓ Account created: ${accountId}`)

      // Load contract code
      const contractPath = `${import.meta.dirname}/../contracts/guestbook.wasm`
      const contractCode = readFileSync(contractPath)

      // Deploy contract
      const nearWithAccountKey = new Near({
        network: sandbox,
        keyStore: {
          [accountId]: accountKey.secretKey,
        },
      })

      await nearWithAccountKey
        .transaction(accountId)
        .deployContract(accountId, contractCode)
        .send({ waitUntil: "FINAL" })

      console.log(`✓ Contract deployed to: ${accountId}`)

      // Verify contract is deployed by calling a view method

      const messages = await near.view(accountId, "get_messages", {})
      expect(messages).toBeDefined()
      expect(Array.isArray(messages)).toBe(true)
      console.log(
        `✓ Contract is callable - get_messages returned ${
          (messages as unknown[]).length
        } messages`,
      )
    }, 30000)

    test("should deploy contract in same transaction as account creation", async () => {
      const accountKey = generateKey()
      const accountId = `deploy-${Date.now()}.${sandbox.rootAccount.id}`

      // Load contract
      const contractPath = `${import.meta.dirname}/../contracts/guestbook.wasm`
      const contractCode = readFileSync(contractPath)

      // Create account and deploy contract in one transaction
      await near
        .transaction(sandbox.rootAccount.id)
        .createAccount(accountId)
        .transfer(accountId, "10 NEAR")
        .addKey(accountKey.publicKey.toString(), {
          type: "fullAccess",
        })
        .deployContract(accountId, contractCode)
        .send()

      console.log(`✓ Account created and contract deployed: ${accountId}`)

      // Verify account exists
      const exists = await near.accountExists(accountId)
      expect(exists).toBe(true)
    }, 30000)
  })

  describe("publishContract and deployFromPublished actions", () => {
    test("should publish a contract to global registry", async () => {
      // Note: Global contracts require NEP-0516 support which may not be in all sandbox versions
      const publisherKey = generateKey()
      const publisherId = `publisher-${Date.now()}.${sandbox.rootAccount.id}`

      // Create publisher account
      await near
        .transaction(sandbox.rootAccount.id)
        .createAccount(publisherId)
        .transfer(publisherId, "20 NEAR")
        .addKey(publisherKey.publicKey.toString(), {
          type: "fullAccess",
        })
        .send()

      console.log(`✓ Publisher account created: ${publisherId}`)

      // Load contract
      const contractPath = `${import.meta.dirname}/../contracts/guestbook.wasm`
      const contractCode = readFileSync(contractPath)

      const nearWithPublisherKey = new Near({
        network: sandbox,
        keyStore: {
          [publisherId]: publisherKey.secretKey,
        },
      })

      // Publish contract (mutable, identified by publisher account)
      await nearWithPublisherKey
        .transaction(publisherId)
        .publishContract(contractCode, { identifiedBy: "account" })
        .send()

      console.log(`✓ Contract published by: ${publisherId}`)
    }, 30000)

    test("should deploy contract from published code by account ID", async () => {
      const publisherKey = generateKey()
      const publisherId = `pub2-${Date.now()}.${sandbox.rootAccount.id}`
      const deployerKey = generateKey()
      const deployerId = `deployer-${Date.now()}.${sandbox.rootAccount.id}`

      // Create publisher account
      await near
        .transaction(sandbox.rootAccount.id)
        .createAccount(publisherId)
        .transfer(publisherId, "20 NEAR")
        .addKey(publisherKey.publicKey.toString(), {
          type: "fullAccess",
        })
        .send()

      // Create deployer account
      await near
        .transaction(sandbox.rootAccount.id)
        .createAccount(deployerId)
        .transfer(deployerId, "10 NEAR")
        .addKey(deployerKey.publicKey.toString(), {
          type: "fullAccess",
        })
        .send()

      console.log(`✓ Created publisher and deployer accounts`)

      // Load and publish contract
      const contractPath = `${import.meta.dirname}/../contracts/guestbook.wasm`
      const contractCode = readFileSync(contractPath)

      const nearWithPublisherKey = new Near({
        network: sandbox,
        keyStore: {
          [publisherId]: publisherKey.secretKey,
        },
      })

      await nearWithPublisherKey
        .transaction(publisherId)
        .publishContract(contractCode, { identifiedBy: "account" })
        .send()

      console.log(`✓ Contract published`)

      // Deploy from published code by account ID
      const nearWithDeployerKey = new Near({
        network: sandbox,
        keyStore: {
          [deployerId]: deployerKey.secretKey,
        },
      })

      await nearWithDeployerKey
        .transaction(deployerId)
        .deployFromPublished({ accountId: publisherId })
        .send({ waitUntil: "FINAL" })

      console.log(`✓ Contract deployed from published code`)

      // Verify deployment
      const messages = await near.view(deployerId, "get_messages", {})
      expect(Array.isArray(messages)).toBe(true)
      console.log(`✓ Deployed contract is functional`)
    }, 30000)
  })

  describe("delegate actions (meta-transactions)", () => {
    test("should create and execute a signed delegate action", async () => {
      // Execute a delegate action (meta-transaction) where a relayer submits a signed request
      // Create sender account (who wants to perform actions)
      const senderKey = generateKey()
      const senderId = `sender-${Date.now()}.${sandbox.rootAccount.id}`

      await near
        .transaction(sandbox.rootAccount.id)
        .createAccount(senderId)
        .transfer(senderId, "5 NEAR")
        .addKey(senderKey.publicKey.toString(), {
          type: "fullAccess",
        })
        .send()

      // Create relayer account (who will actually submit the transaction)
      const relayerKey = generateKey()
      const relayerId = `relayer-${Date.now()}.${sandbox.rootAccount.id}`

      await near
        .transaction(sandbox.rootAccount.id)
        .createAccount(relayerId)
        .transfer(relayerId, "5 NEAR")
        .addKey(relayerKey.publicKey.toString(), {
          type: "fullAccess",
        })
        .send()

      // Create recipient for the delegated transfer
      const recipientKey = generateKey()
      const recipientId = `delegate-rcpt-${Date.now()}.${
        sandbox.rootAccount.id
      }`

      await near
        .transaction(sandbox.rootAccount.id)
        .createAccount(recipientId)
        .transfer(recipientId, "1 NEAR")
        .addKey(recipientKey.publicKey.toString(), {
          type: "fullAccess",
        })
        .send()

      console.log(
        `✓ Created accounts: sender=${senderId}, relayer=${relayerId}, recipient=${recipientId}`,
      )

      // Get sender's nonce and current block height
      const nearWithSenderKey = new Near({
        network: sandbox,
        keyStore: {
          [senderId]: senderKey.secretKey,
        },
      })

      const delegateResult = await nearWithSenderKey
        .transaction(senderId)
        .transfer(recipientId, "1 NEAR")
        .delegate({ blockHeightOffset: 100 })

      console.log(`✓ Signed delegate action`)

      // Relayer sends the transaction with the signed delegate
      const nearWithRelayerKey = new Near({
        network: sandbox,
        keyStore: {
          [relayerId]: relayerKey.secretKey,
        },
      })

      const recipientBalanceBefore = await near.getBalance(recipientId)

      // The relayer submits the delegate action on behalf of the sender
      const decodedDelegate = decodeSignedDelegateAction(delegateResult.payload)

      await nearWithRelayerKey
        .transaction(relayerId)
        .signedDelegateAction(decodedDelegate)
        .send({ waitUntil: "EXECUTED" })

      console.log(`✓ Relayer submitted delegate action`)

      // Verify the transfer happened
      const recipientBalanceAfter = await near.getBalance(recipientId)
      expect(Number.parseFloat(recipientBalanceAfter)).toBeGreaterThan(
        Number.parseFloat(recipientBalanceBefore),
      )

      console.log(
        `✓ Delegate action executed: ${recipientBalanceBefore} → ${recipientBalanceAfter} NEAR`,
      )
    }, 30000)
  })
})
