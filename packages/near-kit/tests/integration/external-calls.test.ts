/**
 * External contract calls (NEP-667) against a nearcore 2.15 sandbox.
 *
 * tests/contracts/external-call.wat logs "checked" from `__external_call`,
 * then refuses a payload starting with 0xFF (it traps), accepts one starting
 * with "p" and makes a 1 yoctoNEAR transfer to itself, accepts one starting
 * with "f" and calls a method it doesn't have on itself, and accepts anything
 * else. An accepted call returns its payload.
 *
 * The tests skip on a node below protocol version 89, such as when
 * NEAR_SANDBOX_BIN_PATH points at a 2.14 binary; one checks that such a node
 * refuses a send at once.
 */

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { sha256 } from "@noble/hashes/sha2.js"
import { base58, base64, hex } from "@scure/base"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import {
  encodeExternalCall,
  externalCallHash,
  externalCallUniqueId,
} from "../../src/core/external-call.js"
import { Near } from "../../src/core/near.js"
import type { ReceiptView } from "../../src/core/types.js"
import {
  ContractNotDeployedError,
  ExternalCallRefusedError,
  ExternalCallTimeoutError,
  FunctionCallError,
  InvalidStateInitError,
  InvalidTransactionError,
  NearError,
  ReservedMethodNameError,
  UninitializedAccountError,
} from "../../src/errors/index.js"
import { Sandbox } from "../../src/sandbox/sandbox.js"
import {
  universalAccountId,
  universalStateInit,
} from "../helpers/universal-account.js"

const WASM = readFileSync(resolve(__dirname, "../contracts/external-call.wasm"))

let counter = 0
const unique = () => `${Date.now()}-${counter++}`
const bytes = (prefix: string | number, rest = unique()) =>
  Uint8Array.from([
    ...(typeof prefix === "number"
      ? [prefix]
      : new TextEncoder().encode(prefix)),
    ...new TextEncoder().encode(rest),
  ])

const actionOf = (receipt: ReceiptView) =>
  (receipt.receipt as { Action?: Record<string, unknown> }).Action

const isFailure = (status: unknown): status is { Failure: unknown } =>
  typeof status === "object" && status !== null && "Failure" in status

describe("external calls (nearcore 2.15)", () => {
  let sandbox: Sandbox
  let near: Near
  let supported = false
  let contract: string
  let plain: string

  beforeAll(async () => {
    sandbox = await Sandbox.start({ version: "2.15.0-rc.1" })
    near = new Near({ network: sandbox })
    supported = (await near.getStatus()).protocol_version >= 89
    if (!supported) return

    const root = sandbox.rootAccount.id
    contract = `ecc-${Date.now()}.${root}`
    plain = `plain-${Date.now()}.${root}`
    await near
      .transaction(root)
      .createAccount(contract)
      .transfer(contract, "10 NEAR")
      .deployContract(contract, WASM)
      .send({ waitUntil: "FINAL" })
    await near
      .transaction(root)
      .createAccount(plain)
      .transfer(plain, "1 NEAR")
      .send({ waitUntil: "FINAL" })
  }, 120000)

  afterAll(async () => {
    await sandbox?.stop()
  })

  const heightOf = async (blockHash: string) =>
    (await near.rpc.getBlock({ blockId: blockHash })).header.height

  test("a node without external calls refuses a send at once", async (ctx) => {
    if (supported) ctx.skip()
    await expect(
      near.externalCall(sandbox.rootAccount.id, bytes("a")),
    ).rejects.toBeInstanceOf(NearError)
  })

  describe("dry run", () => {
    test("returns an accepted call's result", async (ctx) => {
      if (!supported) ctx.skip()
      expect(await near.viewExternalCall(contract, { n: 1 })).toEqual({ n: 1 })
    })

    test("a refusal carries the reason and the run's logs", async (ctx) => {
      if (!supported) ctx.skip()
      const error = await near
        .viewExternalCall(contract, bytes(0xff))
        .catch((e: unknown) => e)
      expect(error).toBeInstanceOf(ExternalCallRefusedError)
      const refusal = error as ExternalCallRefusedError
      expect(refusal.contractId).toBe(contract)
      expect(refusal.logs).toEqual(["checked"])
      expect(refusal.blockHeight).toBeGreaterThan(0)
      expect(refusal.details).toMatchObject({
        ActionError: { kind: { FunctionCallError: {} } },
      })
    })

    test("an account without a contract is refused before any run", async (ctx) => {
      if (!supported) ctx.skip()
      const error = await near
        .viewExternalCall(plain, bytes("a"))
        .catch((e: unknown) => e)
      expect(error).toBeInstanceOf(ExternalCallRefusedError)
      expect((error as ExternalCallRefusedError).details).toEqual({
        InvalidTxError: { ContractNotFound: { contract_id: plain } },
      })
      expect((error as ExternalCallRefusedError).logs).toEqual([])
    })
  })

  describe("send", () => {
    test("lands, under the unique id of its call hash and height", async (ctx) => {
      if (!supported) ctx.skip()
      const payload = bytes("p")
      const outcome = await near.externalCall(contract, payload, {
        waitUntil: "EXECUTED_OPTIMISTIC",
      })

      expect(outcome.transaction).toMatchObject({
        kind: "external_call",
        contract_id: contract,
        state_init: null,
      })
      expect(outcome.transaction_outcome.outcome.logs).toEqual(["checked"])
      const uniqueId = outcome.transaction_outcome.id
      expect(outcome.transaction.transaction_id).toBe(uniqueId)

      const landedIn = await near.rpc.getBlock({
        blockId: outcome.transaction_outcome.block_hash,
      })
      expect(
        externalCallUniqueId(
          { contractId: contract, payload },
          landedIn.header.height,
        ),
      ).toBe(uniqueId)

      // `tx` takes the unique id, with the contract as the sender.
      const viaTx = (await near.rpc.call("tx", {
        tx_hash: uniqueId,
        sender_account_id: contract,
        wait_until: "FINAL",
      })) as { transaction: { transaction_id: string } }
      expect(viaTx.transaction.transaction_id).toBe(uniqueId)

      const status = await near.getExternalCallStatus(
        uniqueId,
        contract,
        "FINAL",
      )
      expect(status.final_execution_status).toBe("FINAL")
      expect(status.receipts.length).toBeGreaterThan(0)
      for (const receipt of status.receipts) {
        const action = actionOf(receipt)
        expect(action?.["authorization_context"]).toBe("ExternalContractCall")
        expect(action?.["signer_public_key"]).toBeUndefined()
        expect(action?.["creation_protocol_version"]).toBe(89)
      }
      const transfer = status.receipts.find(
        (receipt) => receipt.predecessor_id === contract,
      )
      expect(transfer?.receiver_id).toBe(contract)
    }, 60000)

    test("records its state changes under external_call_processing", async (ctx) => {
      if (!supported) ctx.skip()
      const outcome = await near.externalCall(contract, bytes("a"), {
        waitUntil: "FINAL",
      })
      const changes = (await near.rpc.call("EXPERIMENTAL_changes", {
        block_id: outcome.transaction_outcome.block_hash,
        changes_type: "account_changes",
        account_ids: [contract],
      })) as { changes: { cause: unknown }[] }
      expect(changes.changes.map((change) => change.cause)).toContainEqual({
        type: "external_call_processing",
        transaction_id: outcome.transaction_outcome.id,
      })
    }, 60000)

    test("a call to an account without a contract is rejected at once", async (ctx) => {
      if (!supported) ctx.skip()
      await expect(near.externalCall(plain, bytes("a"))).rejects.toBeInstanceOf(
        ContractNotDeployedError,
      )
    })

    test("succeeds when a receipt it starts fails, like a signed transaction", async (ctx) => {
      if (!supported) ctx.skip()
      const payload = bytes("f")
      const outcome = await near.externalCall(contract, payload, {
        waitUntil: "FINAL",
      })
      expect(outcome.status).toEqual({
        SuccessValue: base64.encode(payload),
      })
      const failed = outcome.receipts_outcome.filter((receipt) =>
        isFailure(receipt.outcome.status),
      )
      expect(failed).toHaveLength(1)
      expect(failed[0]?.outcome.status).toMatchObject({
        Failure: {
          ActionError: {
            kind: {
              FunctionCallError: { MethodResolveError: "MethodNotFound" },
            },
          },
        },
      })
    }, 60000)

    test("a call over max_call_size is rejected at once", async (ctx) => {
      if (!supported) ctx.skip()
      const { max_call_size: limit } = (await near.getProtocolConfig())
        .runtime_config.external_calls_config as { max_call_size: number }
      const overhead = encodeExternalCall({
        contractId: contract,
        payload: new Uint8Array(),
      }).length
      const ofSize = (size: number) =>
        Uint8Array.from({ length: size - overhead }, (_, i) =>
          i === 0 ? 0x61 : 0x30 + (i % 10),
        )

      const atLimit = ofSize(limit)
      atLimit.set(new TextEncoder().encode(unique()), 1)
      await expect(
        near.externalCall(contract, atLimit, { waitUntil: "INCLUDED" }),
      ).resolves.toHaveProperty("transaction_outcome")

      const error = await near
        .externalCall(contract, ofSize(limit + 1), { waitUntil: "INCLUDED" })
        .catch((e: unknown) => e)
      expect(error).toBeInstanceOf(InvalidTransactionError)
      expect((error as InvalidTransactionError).details).toMatchObject({
        InvalidTxError: {
          TransactionSizeExceeded: { limit, size: limit + 1 },
        },
      })
    }, 60000)

    test("parallel calls all land, each under its own unique id", async (ctx) => {
      if (!supported) ctx.skip()
      const payloads = Array.from({ length: 6 }, () => bytes("a"))
      const outcomes = await Promise.all(
        payloads.map((payload) =>
          near.externalCall(contract, payload, {
            waitUntil: "EXECUTED_OPTIMISTIC",
          }),
        ),
      )
      for (const [i, outcome] of outcomes.entries()) {
        const height = await heightOf(outcome.transaction_outcome.block_hash)
        expect(
          externalCallUniqueId(
            { contractId: contract, payload: payloads[i] as Uint8Array },
            height,
          ),
        ).toBe(outcome.transaction_outcome.id)
      }
      expect(new Set(outcomes.map((o) => o.transaction_outcome.id)).size).toBe(
        6,
      )
    }, 60000)

    test("the same call sent twice at once lands once", async (ctx) => {
      if (!supported) ctx.skip()
      const payload = bytes("a")
      const [first, second] = await Promise.all([
        near.externalCall(contract, payload),
        near.externalCall(contract, payload),
      ])
      expect(second?.transaction_outcome.id).toBe(first?.transaction_outcome.id)
    }, 60000)

    test("a refused call is never found: the send times out", async (ctx) => {
      if (!supported) ctx.skip()
      const payload = bytes(0xff)
      const error = await near
        .externalCall(contract, payload, { waitUntil: "INCLUDED" })
        .catch((e: unknown) => e)
      expect(error).toBeInstanceOf(ExternalCallTimeoutError)
      const timeout = error as ExternalCallTimeoutError
      expect(timeout.callHash).toBe(
        externalCallHash({ contractId: contract, payload }),
      )

      const head = (await near.rpc.getBlock({ finality: "optimistic" })).header
        .height
      expect(
        await near.findExternalCall(contract, payload, {
          fromHeight: timeout.sentAtHeight,
          toHeight: head,
        }),
      ).toBeUndefined()
    }, 60000)
  })

  describe("finding a copy", () => {
    test("by searching one candidate id per height", async (ctx) => {
      if (!supported) ctx.skip()
      const payload = bytes("a")
      const fromHeight = (await near.rpc.getBlock({ finality: "optimistic" }))
        .header.height
      const sent = await near.externalCall(contract, payload, {
        waitUntil: "NONE",
      })
      expect(sent).toEqual({ final_execution_status: "NONE" })

      const found = await near.findExternalCall(contract, payload, {
        fromHeight,
        toHeight: fromHeight + 20,
        waitUntil: "FINAL",
      })
      expect(found?.transaction.contract_id).toBe(contract)
      expect(found?.final_execution_status).toBe("FINAL")
    }, 60000)

    test("by sending the same call again", async (ctx) => {
      if (!supported) ctx.skip()
      const payload = bytes("a")
      const first = await near.externalCall(contract, payload, {
        waitUntil: "FINAL",
      })
      const found = await near.findExternalCall(contract, payload, {
        fromHeight: 0,
        resend: true,
        waitUntil: "FINAL",
      })
      expect(found?.transaction_outcome.id).toBe(first.transaction_outcome.id)
    }, 60000)
  })

  describe("signed transactions on 2.15", () => {
    test("receipts carry the signing key as their authorization context", async (ctx) => {
      if (!supported) ctx.skip()
      const root = sandbox.rootAccount.id
      const sent = await near
        .transaction(root)
        .transfer(plain, "1 yocto")
        .send({ waitUntil: "FINAL" })
      const status = await near.rpc.getTransactionStatus(
        sent.transaction.hash,
        root,
        "FINAL",
      )
      const action = actionOf(status.receipts[0] as ReceiptView)
      expect(action?.["authorization_context"]).toEqual({
        AccessKey: action?.["signer_public_key"],
      })
    }, 60000)

    test("a FunctionCall to __external_call is refused", async (ctx) => {
      if (!supported) ctx.skip()
      await expect(
        near
          .transaction(sandbox.rootAccount.id)
          .functionCall(contract, "__external_call", new Uint8Array([0x61]), {
            gas: "30 Tgas",
          })
          .send(),
      ).rejects.toBeInstanceOf(ReservedMethodNameError)
    }, 60000)
  })

  describe("universal account with a global contract", () => {
    let accountId: string
    let stateInit: Uint8Array

    beforeAll(async () => {
      if (!supported) return
      const root = sandbox.rootAccount.id
      await near
        .transaction(root)
        .publishContract(WASM, { identifiedBy: "hash" })
        .send({ waitUntil: "FINAL" })
      stateInit = universalStateInit(sha256(WASM))
      accountId = universalAccountId(stateInit)
      await near
        .transaction(root)
        .transfer(accountId, "5 NEAR")
        .send({ waitUntil: "FINAL" })
    }, 60000)

    test("installs on the first call that brings its state init", async (ctx) => {
      if (!supported) ctx.skip()
      expect(await near.rpc.getAccount(accountId)).toMatchObject({
        state: "uninitialized",
        bootstrap_nonce: expect.any(Number),
      })

      // A dry run needs the state init too.
      const withoutInit = await near
        .viewExternalCall(accountId, bytes("a"))
        .catch((e: unknown) => e)
      expect((withoutInit as ExternalCallRefusedError).details).toEqual({
        InvalidTxError: { ContractNotFound: { contract_id: accountId } },
      })
      expect(
        await near.viewExternalCall(accountId, { dry: true }, { stateInit }),
      ).toEqual({ dry: true })

      const payload = bytes("a")
      const installed = await near.externalCall(accountId, payload, {
        stateInit,
        waitUntil: "FINAL",
      })
      expect(installed.transaction.state_init).toBe(base64.encode(stateInit))
      expect(installed.status).toEqual({
        SuccessValue: base64.encode(payload),
      })
      // The unique id leaves the state init out.
      expect(
        externalCallUniqueId(
          { contractId: accountId, payload },
          await heightOf(installed.transaction_outcome.block_hash),
        ),
      ).toBe(installed.transaction_outcome.id)

      const account = await near.rpc.getAccount(accountId, {
        finality: "final",
      })
      expect(account.state).toBeUndefined()
      expect(account.bootstrap_nonce).toBeUndefined()
      expect(account.global_contract_hash).toBe(base58.encode(sha256(WASM)))
    }, 60000)

    test("later calls need no state init, and one sent anyway is dropped", async (ctx) => {
      if (!supported) ctx.skip()
      const plainCall = await near.externalCall(accountId, bytes("a"), {
        waitUntil: "FINAL",
      })
      expect(plainCall.transaction.state_init).toBeNull()

      const payload = bytes("a")
      const again = await near.externalCall(accountId, payload, {
        stateInit,
        waitUntil: "FINAL",
      })
      expect(again.transaction.state_init).toBeNull()
      expect(again.status).toEqual({ SuccessValue: base64.encode(payload) })

      const found = await near.findExternalCall(accountId, payload, {
        fromHeight: await heightOf(again.transaction_outcome.block_hash),
        toHeight: await heightOf(again.transaction_outcome.block_hash),
        stateInit,
      })
      expect(found?.transaction_outcome.id).toBe(again.transaction_outcome.id)
    }, 60000)
  })

  describe("uninitialized universal account", () => {
    // A key-only universal account and its state init, from the vectors
    // near-primitives produced.
    const vectors = JSON.parse(
      readFileSync(
        resolve(
          __dirname,
          "../fixtures/nearcore-2.15/near-primitives-vectors.json",
        ),
        "utf8",
      ),
    ) as {
      external_calls: {
        name: string
        contract_id: string
        state_init: string | null
      }[]
    }
    const universal = vectors.external_calls.find((v) =>
      v.name.startsWith("universal"),
    )
    const accountId = universal?.contract_id as string
    const stateInit = hex.decode(universal?.state_init as string)

    beforeAll(async () => {
      if (!supported) return
      await near
        .transaction(sandbox.rootAccount.id)
        .transfer(accountId, "1 NEAR")
        .send({ waitUntil: "FINAL" })
    }, 60000)

    test("a view needs its state init", async (ctx) => {
      if (!supported) ctx.skip()
      await expect(near.view(accountId, "anything")).rejects.toBeInstanceOf(
        UninitializedAccountError,
      )
    })

    test("a state init for another account is invalid", async (ctx) => {
      if (!supported) ctx.skip()
      const error = await near
        .view(
          accountId,
          "anything",
          {},
          {
            stateInit: { universal: new Uint8Array(10) },
          },
        )
        .catch((e: unknown) => e)
      expect(error).toBeInstanceOf(InvalidStateInitError)
      expect((error as InvalidStateInitError).details).toMatchObject({
        InvalidUniversalStateInitReceiver: { receiver_id: accountId },
      })
    })

    test("its own state init gets past validation to the missing code", async (ctx) => {
      if (!supported) ctx.skip()
      // The vector's state init installs keys only, so there is no code to run.
      const view = await near
        .view(
          accountId,
          "anything",
          {},
          { stateInit: { universal: stateInit } },
        )
        .catch((e: unknown) => e)
      expect(view).toBeInstanceOf(FunctionCallError)
      expect((view as FunctionCallError).panic).toContain("CodeDoesNotExist")
      const refusal = await near
        .viewExternalCall(accountId, Uint8Array.of(1), { stateInit })
        .catch((e: unknown) => e)
      expect((refusal as ExternalCallRefusedError).details).toEqual({
        InvalidTxError: { ContractNotFound: { contract_id: accountId } },
      })
      await expect(
        near.externalCall(accountId, Uint8Array.of(1), { stateInit }),
      ).rejects.toBeInstanceOf(ContractNotDeployedError)
    })

    test("a deterministic state init for another account is invalid", async (ctx) => {
      if (!supported) ctx.skip()
      const root = sandbox.rootAccount.id
      const error = await near
        .view(
          root,
          "anything",
          {},
          { stateInit: { code: { accountId: root } } },
        )
        .catch((e: unknown) => e)
      expect(error).toBeInstanceOf(InvalidStateInitError)
      expect((error as InvalidStateInitError).details).toMatchObject({
        InvalidDeterministicStateInitReceiver: { receiver_id: root },
      })
    })
  })

  test("protocol config reports the external call limits", async (ctx) => {
    if (!supported) ctx.skip()
    const config = await near.getProtocolConfig()
    expect(config.protocol_version).toBeGreaterThanOrEqual(89)
    expect(config.runtime_config.external_calls_config).toMatchObject({
      max_call_size: expect.any(Number),
      max_calls_per_chunk: expect.any(Number),
      chunk_compute_share: [expect.any(Number), expect.any(Number)],
    })
    expect(
      config.runtime_config.wasm_config?.limit_config?.max_gas_burnt_external,
    ).toBeGreaterThan(0)
  })
})
