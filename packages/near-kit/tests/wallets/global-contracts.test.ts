import type { ConnectorAction } from "@hot-labs/near-connect"
import { describe, expect, it } from "vitest"
import { Near } from "../../src/core/near.js"
import { fromNearConnect } from "../../src/wallets/adapters.js"
import { MockNearConnect } from "./mock-wallets.js"

const accountId = "switch.testnet"
const codeHash = "1thX6LZfHDZZKUs92febYZhYRcXddmzfzF2NvTkPNE"

function setup() {
  const connector = new MockNearConnect([{ accountId }])
  const near = new Near({
    network: "testnet",
    wallet: fromNearConnect(connector),
  })
  return { connector, near }
}

describe("Global contracts through NEAR Connect", () => {
  it.each([
    {
      name: "publisher account",
      reference: { accountId: "publisher.testnet" },
      contractIdentifier: { accountId: "publisher.testnet" },
    },
    {
      name: "base58 code hash",
      reference: { codeHash },
      contractIdentifier: { codeHash },
    },
    {
      name: "code hash bytes",
      reference: {
        codeHash: Uint8Array.from({ length: 32 }, (_, index) => index),
      },
      contractIdentifier: { codeHash },
    },
  ])("deploys by $name and initializes in the same transaction", async ({
    reference,
    contractIdentifier,
  }) => {
    const { connector, near } = setup()
    const args = { challenge_delay_ms: 60_000, friends: [] }

    await near
      .transaction(accountId)
      .deployFromPublished(reference)
      .functionCall(accountId, "init", args, { gas: "100 Tgas" })
      .send()

    const transactions = connector
      .getCallLog()
      .filter((call) => call.method === "signAndSendTransaction")
    expect(transactions).toHaveLength(1)
    expect(transactions[0]?.params).toEqual({
      signerId: accountId,
      receiverId: accountId,
      actions: [
        { type: "UseGlobalContract", params: { contractIdentifier } },
        {
          type: "FunctionCall",
          params: {
            methodName: "init",
            args,
            gas: "100000000000000",
            deposit: "0",
          },
        },
      ] satisfies ConnectorAction[],
    })
  })

  it.each([
    { identifiedBy: "account" as const, deployMode: "AccountId" as const },
    { identifiedBy: "hash" as const, deployMode: "CodeHash" as const },
  ])("publishes code identified by $identifiedBy", async ({
    identifiedBy,
    deployMode,
  }) => {
    const { connector, near } = setup()
    const code = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])

    await near
      .transaction(accountId)
      .publishContract(code, { identifiedBy })
      .send()

    const transaction = connector
      .getCallLog()
      .find((call) => call.method === "signAndSendTransaction")
    expect(transaction?.params).toEqual({
      signerId: accountId,
      receiverId: accountId,
      actions: [
        { type: "DeployGlobalContract", params: { code, deployMode } },
      ] satisfies ConnectorAction[],
    })
  })
})
