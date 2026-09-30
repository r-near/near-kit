/** Public fluent-builder contracts, exercised through unsigned and signed transactions. */

import { describe, expect, test } from "vitest"
import { rpcToPromises } from "../../src/core/rpc/rpc.js"
import {
  SignedTransactionSchema,
  TransactionV1Schema,
} from "../../src/core/schema.js"
import { TransactionBuilder } from "../../src/core/transaction.js"
import { InMemoryKeyStore } from "../../src/keys/index.js"
import { Amount } from "../../src/utils/amount.js"
import { Gas } from "../../src/utils/gas.js"
import { testRpcPrograms } from "../helpers/rpc.js"

// RFC 8032 section 7.1 test vector 1: a matching Ed25519 seed/public-key pair.
const TEST_PRIVATE_KEY =
  "ed25519:49W385L4rePHy6PAaQUovbD2aacgN4HsKXSMeUzRg4fmwXszN91JuMFrQRj3vMDpZuRF3ZknQBuRBoWQJEfXstMw"
const SIGNING_PUBLIC_KEY =
  "ed25519:FVen3X669xLzsi6N2V91DoiyzHzg1uAgqiT8jZ9nS96Z"
const TEST_PUBLIC_KEY = "ed25519:DcA2MzgpJbrUATQLLceocVckhhAqrkingax4oJ9kZ847"
const PUBLIC_KEY = {
  ed25519Key: {
    data: [
      187, 77, 198, 57, 178, 18, 224, 117, 167, 81, 104, 91, 38, 189, 206, 165,
      146, 10, 80, 65, 129, 255, 41, 16, 232, 84, 151, 66, 18, 112, 146, 160,
    ],
  },
}
const BLOCK_HASH = "11111111111111111111111111111111"
// Independent NEP-616 fixture: keccak256 of the manually encoded Borsh bytes
// 00010e0000007075626c69736865722e6e65617200000000, taking the last 20 bytes.
const STATE_INIT_RECEIVER = "0s2293da2d32cd0a067950616036ff973884abab0a"

function createFixture(
  options: { nonce?: bigint | null; gasKeyNonces?: number[] } = {},
) {
  const requests: Array<{ method: string; params: unknown }> = []
  const rpc = rpcToPromises(
    testRpcPrograms(
      "https://rpc.invalid",
      async (_url, init) => {
        if (typeof init.body !== "string")
          throw new Error("Expected a JSON RPC request body")
        const { method, params } = JSON.parse(init.body)
        requests.push({ method, params })
        let result: unknown
        if (method === "block") {
          result = {
            author: "validator.near",
            header: {
              height: 1000,
              epoch_id: BLOCK_HASH,
              next_epoch_id: BLOCK_HASH,
              hash: BLOCK_HASH,
              prev_hash: BLOCK_HASH,
              prev_state_root: BLOCK_HASH,
              chunk_receipts_root: BLOCK_HASH,
              chunk_headers_root: BLOCK_HASH,
              chunk_tx_root: BLOCK_HASH,
              outcome_root: BLOCK_HASH,
              chunks_included: 0,
              challenges_root: BLOCK_HASH,
              timestamp: 1,
              timestamp_nanosec: "1",
              random_value: BLOCK_HASH,
              validator_proposals: [],
              chunk_mask: [],
              gas_price: "100000000",
              total_supply: "1000000000000000000000000000",
              challenges_result: [],
              last_final_block: BLOCK_HASH,
              last_ds_final_block: BLOCK_HASH,
              next_bp_hash: BLOCK_HASH,
              block_merkle_root: BLOCK_HASH,
              approvals: [],
              signature: "ed25519:fixture",
              latest_protocol_version: 85,
            },
            chunks: [],
          }
        } else if (method === "EXPERIMENTAL_view_gas_key_nonces") {
          result = { nonces: options.gasKeyNonces ?? [10, 20, 30] }
        } else {
          throw new Error(`Unexpected RPC request: ${method}`)
        }
        return Response.json({ jsonrpc: "2.0", id: 1, result })
      },
      undefined,
      { maxRetries: 0 },
    ),
  )
  const keyStore = new InMemoryKeyStore({ "alice.near": TEST_PRIVATE_KEY })
  const builder = new TransactionBuilder("alice.near", rpc, keyStore)
  if (options.nonce !== null) builder.nonce(options.nonce ?? 42n)
  return { builder, requests }
}

function createBuilder(): TransactionBuilder {
  return createFixture().builder
}

async function signedV1(builder: TransactionBuilder) {
  await builder.sign()
  const wire = builder.serialize()
  expect(wire[0]).toBe(1)
  expect(wire[1]).toBe(10) // Length of signer ID, following the V1 tag.
  expect(wire[wire.length - 65]).toBe(0) // Ed25519 signature discriminant.
  return TransactionV1Schema.deserialize(wire.slice(1, -65))
}

describe("TransactionBuilder - Fluent API", () => {
  test("should chain transfer action", async () => {
    const builder = createBuilder().transfer("bob.near", Amount.NEAR(1))
    expect(builder).toBeInstanceOf(TransactionBuilder)
    const transaction = await builder.build()
    expect(transaction.actions).toEqual([
      { transfer: { deposit: 1000000000000000000000000n } },
    ])
    expect(transaction.signerId).toBe("alice.near")
    expect(transaction.publicKey.toString()).toBe(SIGNING_PUBLIC_KEY)
    expect(transaction.nonce).toBe(42n)
    expect(transaction.blockHash).toEqual(new Uint8Array(32))
  })

  test("should chain function call action", async () => {
    const transaction = await createBuilder()
      .functionCall("token.near", "ft_transfer", {
        receiver_id: "bob.near",
        amount: "100",
      })
      .build()
    expect(transaction.actions).toEqual([
      {
        functionCall: {
          methodName: "ft_transfer",
          args: new TextEncoder().encode(
            '{"receiver_id":"bob.near","amount":"100"}',
          ),
          gas: 30000000000000n,
          deposit: 0n,
        },
      },
    ])
  })

  test("should chain multiple actions", async () => {
    const transaction = await createBuilder()
      .transfer("bob.near", Amount.NEAR(1))
      .functionCall("token.near", "ft_transfer", {
        receiver_id: "carol.near",
        amount: "100",
      })
      .transfer("dave.near", Amount.NEAR(2))
      .build()
    expect(transaction.receiverId).toBe("bob.near")
    expect(transaction.actions).toEqual([
      { transfer: { deposit: 1000000000000000000000000n } },
      {
        functionCall: {
          methodName: "ft_transfer",
          args: new TextEncoder().encode(
            '{"receiver_id":"carol.near","amount":"100"}',
          ),
          gas: 30000000000000n,
          deposit: 0n,
        },
      },
      { transfer: { deposit: 2000000000000000000000000n } },
    ])
  })

  test("should chain createAccount action", async () => {
    const transaction = await createBuilder()
      .createAccount("new-account.near")
      .build()
    expect(transaction.actions).toEqual([{ createAccount: {} }])
  })

  test("should chain deleteAccount action", async () => {
    const transaction = await createBuilder()
      .deleteAccount({ beneficiary: "beneficiary.near" })
      .build()
    expect(transaction.receiverId).toBe("alice.near")
    expect(transaction.actions).toEqual([
      { deleteAccount: { beneficiaryId: "beneficiary.near" } },
    ])
  })

  test("should chain deployContract action", async () => {
    const transaction = await createBuilder()
      .deployContract("contract.near", new Uint8Array([1, 2, 3, 4]))
      .build()
    expect(transaction.actions).toEqual([
      { deployContract: { code: new Uint8Array([1, 2, 3, 4]) } },
    ])
  })

  test("should chain stake action", async () => {
    const transaction = await createBuilder()
      .stake(TEST_PUBLIC_KEY, Amount.NEAR(100))
      .build()
    expect(transaction.receiverId).toBe("alice.near")
    expect(transaction.actions).toEqual([
      { stake: { stake: 100000000000000000000000000n, publicKey: PUBLIC_KEY } },
    ])
  })

  test("should return same builder instance for chaining", async () => {
    const builder = createBuilder()
    const result1 = builder.transfer("bob.near", Amount.NEAR(1))
    const result2 = result1.functionCall("contract.near", "method", {})
    expect(result1).toBe(builder)
    expect(result2).toBe(builder)
    expect((await result2.build()).actions).toMatchObject([
      { transfer: { deposit: 1000000000000000000000000n } },
      { functionCall: { methodName: "method" } },
    ])
  })
})

describe("TransactionBuilder - Gas Parsing", () => {
  test.each([
    ["raw number string", "30000000000000", 30000000000000n],
    ["Gas.Tgas() output", Gas.Tgas(30), 30000000000000n],
    ["Tgas format", "30 Tgas", 30000000000000n],
    ["decimal Tgas", "1.5 Tgas", 1500000000000n],
  ] as const)("should parse gas as %s", async (_name, gas, expected) => {
    const transaction = await createBuilder()
      .functionCall("contract.near", "method", {}, { gas })
      .build()
    expect(transaction.actions).toMatchObject([
      { functionCall: { gas: expected } },
    ])
  })

  test("should parse Tgas with different case", async () => {
    for (const gas of ["30 TGas", "30 tgas", "30 Tgas"]) {
      const transaction = await createBuilder()
        .functionCall(
          "c.near",
          "m",
          {},
          {
            // @ts-expect-error - untyped callers may supply noncanonical casing.
            gas,
          },
        )
        .build()
      expect(transaction.actions).toMatchObject([
        { functionCall: { gas: 30000000000000n } },
      ])
    }
  })

  test("should use default gas when not specified", async () => {
    const transaction = await createBuilder()
      .functionCall("contract.near", "method", {})
      .build()
    expect(transaction.actions).toMatchObject([
      { functionCall: { gas: 30000000000000n } },
    ])
  })
})

describe("TransactionBuilder - Amount Parsing", () => {
  test.each([
    ["Amount.NEAR()", Amount.NEAR(10)],
    ["string format", "10 NEAR"],
  ] as const)("should parse transfer amount with %s", async (_name, amount) => {
    const transaction = await createBuilder()
      .transfer("bob.near", amount)
      .build()
    expect(transaction.actions).toEqual([
      { transfer: { deposit: 10000000000000000000000000n } },
    ])
  })

  test.each([
    ["Amount.NEAR()", Amount.NEAR(5)],
    ["string format", "5 NEAR"],
  ] as const)(
    "should parse attached deposit with %s",
    async (_name, attachedDeposit) => {
      const transaction = await createBuilder()
        .functionCall("contract.near", "method", {}, { attachedDeposit })
        .build()
      expect(transaction.actions).toMatchObject([
        { functionCall: { deposit: 5000000000000000000000000n } },
      ])
    },
  )

  test("should use zero deposit when not specified", async () => {
    const transaction = await createBuilder()
      .functionCall("contract.near", "method", {})
      .build()
    expect(transaction.actions).toMatchObject([
      { functionCall: { deposit: 0n } },
    ])
  })

  test("should parse stake amount with Amount.NEAR()", async () => {
    const transaction = await createBuilder()
      .stake(TEST_PUBLIC_KEY, Amount.NEAR(100))
      .build()
    expect(transaction.actions).toMatchObject([
      { stake: { stake: 100000000000000000000000000n } },
    ])
  })
})

describe("TransactionBuilder - Receiver ID Management", () => {
  test.each([
    [
      "transfer",
      "bob.near",
      (builder: TransactionBuilder) =>
        builder.transfer("bob.near", Amount.NEAR(1)),
    ],
    [
      "function call",
      "contract.near",
      (builder: TransactionBuilder) =>
        builder.functionCall("contract.near", "method", {}),
    ],
    [
      "createAccount",
      "new.near",
      (builder: TransactionBuilder) => builder.createAccount("new.near"),
    ],
    [
      "deployContract",
      "contract.near",
      (builder: TransactionBuilder) =>
        builder.deployContract("contract.near", new Uint8Array()),
    ],
  ] as const)(
    "should set receiver ID from %s",
    async (_name, receiverId, addAction) => {
      expect((await addAction(createBuilder()).build()).receiverId).toBe(
        receiverId,
      )
    },
  )

  test("should keep first receiver ID when chaining", async () => {
    const transaction = await createBuilder()
      .transfer("bob.near", Amount.NEAR(1))
      .functionCall("contract.near", "method", {})
      .build()
    expect(transaction.receiverId).toBe("bob.near")
  })

  test("should not override receiver ID", async () => {
    const transaction = await createBuilder()
      .functionCall("contract1.near", "method", {})
      .functionCall("contract2.near", "method", {})
      .transfer("alice.near", Amount.NEAR(1))
      .build()
    expect(transaction.receiverId).toBe("contract1.near")
  })
})

describe("TransactionBuilder - Action Arguments", () => {
  test("should encode function call arguments as JSON", async () => {
    const transaction = await createBuilder()
      .functionCall("contract.near", "method", {
        receiver_id: "bob.near",
        amount: "100",
        memo: "test",
      })
      .build()
    expect(transaction.actions).toMatchObject([
      {
        functionCall: {
          args: new TextEncoder().encode(
            '{"receiver_id":"bob.near","amount":"100","memo":"test"}',
          ),
        },
      },
    ])
  })

  test("should handle empty arguments", async () => {
    const transaction = await createBuilder()
      .functionCall("contract.near", "method")
      .build()
    expect(transaction.actions).toMatchObject([
      { functionCall: { args: new Uint8Array([123, 125]) } },
    ])
  })

  test("should handle complex nested arguments", async () => {
    const transaction = await createBuilder()
      .functionCall("contract.near", "method", {
        data: { nested: { value: 123, array: [1, 2, 3] } },
      })
      .build()
    expect(transaction.actions).toMatchObject([
      {
        functionCall: {
          args: new TextEncoder().encode(
            '{"data":{"nested":{"value":123,"array":[1,2,3]}}}',
          ),
        },
      },
    ])
  })

  test("should accept Uint8Array arguments directly (e.g., Borsh-serialized)", async () => {
    const transaction = await createBuilder()
      .functionCall("contract.near", "method", new Uint8Array([1, 2, 3, 4, 5]))
      .build()
    expect(transaction.actions).toMatchObject([
      { functionCall: { args: new Uint8Array([1, 2, 3, 4, 5]) } },
    ])
    expect(transaction.actions).toMatchObject([
      { functionCall: { args: expect.any(Uint8Array) } },
    ])
  })

  test("should pass through Uint8Array without modification", async () => {
    const transaction = await createBuilder()
      .functionCall(
        "contract.near",
        "borsh_method",
        new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
      )
      .build()
    expect(transaction.actions).toMatchObject([
      { functionCall: { args: new Uint8Array([0xde, 0xad, 0xbe, 0xef]) } },
    ])
  })
})

describe("TransactionBuilder - Complex Scenarios", () => {
  test("should build multi-action transaction", async () => {
    const transaction = await createBuilder()
      .createAccount("new.near")
      .transfer("new.near", Amount.NEAR(10))
      .deployContract("new.near", new Uint8Array([1, 2, 3]))
      .functionCall("new.near", "init", { owner: "alice.near" })
      .build()
    expect(transaction.receiverId).toBe("new.near")
    expect(transaction.actions).toEqual([
      { createAccount: {} },
      { transfer: { deposit: 10000000000000000000000000n } },
      { deployContract: { code: new Uint8Array([1, 2, 3]) } },
      {
        functionCall: {
          methodName: "init",
          args: new TextEncoder().encode('{"owner":"alice.near"}'),
          gas: 30000000000000n,
          deposit: 0n,
        },
      },
    ])
  })

  test("should handle transaction with gas and deposit", async () => {
    const transaction = await createBuilder()
      .functionCall(
        "contract.near",
        "method1",
        { arg: "value1" },
        {
          gas: "50 Tgas",
          attachedDeposit: Amount.NEAR(1),
        },
      )
      .functionCall(
        "contract.near",
        "method2",
        { arg: "value2" },
        {
          gas: "100 Tgas",
          attachedDeposit: Amount.NEAR(2),
        },
      )
      .build()
    expect(transaction.actions).toEqual([
      {
        functionCall: {
          methodName: "method1",
          args: new TextEncoder().encode('{"arg":"value1"}'),
          gas: 50000000000000n,
          deposit: 1000000000000000000000000n,
        },
      },
      {
        functionCall: {
          methodName: "method2",
          args: new TextEncoder().encode('{"arg":"value2"}'),
          gas: 100000000000000n,
          deposit: 2000000000000000000000000n,
        },
      },
    ])
  })

  test("should build transaction with mixed action types", async () => {
    const transaction = await createBuilder()
      .createAccount("new.near")
      .transfer("new.near", Amount.NEAR(10))
      .deployContract("new.near", new Uint8Array())
      .functionCall("new.near", "init", {})
      .stake(TEST_PUBLIC_KEY, Amount.NEAR(100))
      .deleteAccount({ beneficiary: "beneficiary.near" })
      .build()
    expect(transaction.actions).toEqual([
      { createAccount: {} },
      { transfer: { deposit: 10000000000000000000000000n } },
      { deployContract: { code: new Uint8Array() } },
      {
        functionCall: {
          methodName: "init",
          args: new Uint8Array([123, 125]),
          gas: 30000000000000n,
          deposit: 0n,
        },
      },
      { stake: { stake: 100000000000000000000000000n, publicKey: PUBLIC_KEY } },
      { deleteAccount: { beneficiaryId: "beneficiary.near" } },
    ])
  })
})

describe("TransactionBuilder - Edge Cases", () => {
  test("should handle zero amounts", async () => {
    const transaction = await createBuilder()
      .transfer("bob.near", Amount.NEAR(0))
      .functionCall(
        "contract.near",
        "method",
        {},
        { attachedDeposit: Amount.NEAR(0) },
      )
      .build()
    expect(transaction.actions).toMatchObject([
      { transfer: { deposit: 0n } },
      { functionCall: { deposit: 0n } },
    ])
  })

  test("should handle very large amounts with yocto", async () => {
    const transaction = await createBuilder()
      .transfer("bob.near", Amount.yocto("999999999999999999999999"))
      .build()
    expect(transaction.actions).toEqual([
      { transfer: { deposit: 999999999999999999999999n } },
    ])
  })

  test("should handle very large gas values", async () => {
    const transaction = await createBuilder()
      .functionCall("contract.near", "method", {}, { gas: "300000000000000" })
      .build()
    expect(transaction.actions).toMatchObject([
      { functionCall: { gas: 300000000000000n } },
    ])
  })

  test("should reject an empty transaction without a receiver", async () => {
    const { builder, requests } = createFixture()
    await expect(builder.build()).rejects.toThrow(
      "No receiver ID set for transaction",
    )
    expect(requests).toEqual([])
  })
})

describe("TransactionBuilder - Gas Keys (NEAR 2.13)", () => {
  test("should chain transferToGasKey action and default receiver to signer", async () => {
    const transaction = await createBuilder()
      .transferToGasKey(TEST_PUBLIC_KEY, Amount.NEAR(1))
      .build()
    expect(transaction.receiverId).toBe("alice.near")
    expect(transaction.actions).toEqual([
      {
        transferToGasKey: {
          publicKey: PUBLIC_KEY,
          deposit: 1000000000000000000000000n,
        },
      },
    ])
  })

  test("should chain withdrawFromGasKey action", async () => {
    const transaction = await createBuilder()
      .withdrawFromGasKey(TEST_PUBLIC_KEY, "2 NEAR")
      .build()
    expect(transaction.receiverId).toBe("alice.near")
    expect(transaction.actions).toEqual([
      {
        withdrawFromGasKey: {
          publicKey: PUBLIC_KEY,
          amount: 2000000000000000000000000n,
        },
      },
    ])
  })

  test("addKey with gasKeyFullAccess permission starts with a zero balance", async () => {
    const transaction = await createBuilder()
      .addKey(TEST_PUBLIC_KEY, {
        type: "gasKeyFullAccess",
        numNonces: 8,
      })
      .build()
    expect(transaction.actions).toEqual([
      {
        addKey: {
          publicKey: PUBLIC_KEY,
          accessKey: {
            nonce: 0n,
            permission: {
              gasKeyFullAccess: { gasKeyInfo: { balance: 0n, numNonces: 8 } },
            },
          },
        },
      },
    ])
  })

  test("addKey with gasKeyFunctionCall permission omits allowance", async () => {
    const transaction = await createBuilder()
      .addKey(TEST_PUBLIC_KEY, {
        type: "gasKeyFunctionCall",
        numNonces: 3,
        receiverId: "contract.near",
        methodNames: ["m1", "m2"],
      })
      .build()
    expect(transaction.actions).toEqual([
      {
        addKey: {
          publicKey: PUBLIC_KEY,
          accessKey: {
            nonce: 0n,
            permission: {
              gasKeyFunctionCall: {
                gasKeyInfo: { balance: 0n, numNonces: 3 },
                functionCall: {
                  allowance: null,
                  receiverId: "contract.near",
                  methodNames: ["m1", "m2"],
                },
              },
            },
          },
        },
      },
    ])
  })

  test("rejects an out-of-range gas key nonce count", () => {
    for (const numNonces of [0, 1025, 1.5]) {
      expect(() =>
        createBuilder().addKey(TEST_PUBLIC_KEY, {
          type: "gasKeyFullAccess",
          numNonces,
        }),
      ).toThrow(/1\.\.=1024/)
    }
  })

  test("rejects an unknown access key permission type (JS callers)", () => {
    expect(() =>
      createBuilder().addKey(TEST_PUBLIC_KEY, {
        // @ts-expect-error - Simulate a malformed permission from an untyped JS caller.
        type: "bogusPermission",
      }),
    ).toThrow(/Unknown access key permission type/)
  })
})

describe("TransactionBuilder - V1 nonce options (NEAR 2.13)", () => {
  test("useGasKey signs a V1 transaction with the requested nonce slot", async () => {
    const { builder, requests } = createFixture()
    const transaction = await signedV1(
      builder.useGasKey(2).transfer("bob.near", "1 NEAR"),
    )
    expect(transaction.nonce).toEqual({
      gasKeyNonce: { nonce: 42n, nonceIndex: 2 },
    })
    expect(transaction.nonceMode).toEqual({ monotonic: {} })
    expect(transaction.receiverId).toBe("bob.near")
    expect(requests[0]).toEqual({
      method: "EXPERIMENTAL_view_gas_key_nonces",
      params: {
        finality: "optimistic",
        account_id: "alice.near",
        public_key: SIGNING_PUBLIC_KEY,
      },
    })
  })

  test("strictNonceMode signs a V1 transaction with strict nonce mode", async () => {
    const transaction = await signedV1(
      createBuilder().strictNonceMode().transfer("bob.near", "1 NEAR"),
    )
    expect(transaction.nonce).toEqual({ nonce: { nonce: 42n } })
    expect(transaction.nonceMode).toEqual({ strict: {} })
  })

  test("an ordinary transaction stays V0", async () => {
    const builder = createBuilder().transfer("bob.near", Amount.NEAR(1))
    await builder.sign()
    const wire = builder.serialize()
    expect(wire.slice(0, 4)).toEqual(new Uint8Array([10, 0, 0, 0]))
    expect(SignedTransactionSchema.deserialize(wire).transaction).toMatchObject(
      {
        signerId: "alice.near",
        receiverId: "bob.near",
        nonce: 42n,
        actions: [{ transfer: { deposit: 1000000000000000000000000n } }],
      },
    )
  })

  test("rejects an out-of-range gas key nonce index", () => {
    for (const index of [-1, 70000, 1.5]) {
      expect(() => createBuilder().useGasKey(index)).toThrow(/0\.\.=65535/)
    }
  })

  test("validates gas slot existence even with an explicit nonce", async () => {
    const { builder, requests } = createFixture({ gasKeyNonces: [10, 20] })
    await expect(
      builder.useGasKey(2).transfer("bob.near", "1 NEAR").sign(),
    ).rejects.toThrow(/has no nonce slot 2/)
    expect(requests.map(({ method }) => method)).toEqual([
      "EXPERIMENTAL_view_gas_key_nonces",
    ])
    expect(builder.getHash()).toBeNull()
  })

  test("delegateV2 rejects an out-of-range gas key nonce index", async () => {
    const { builder, requests } = createFixture({ nonce: null })
    builder.signWith(TEST_PRIVATE_KEY).transfer("bob.near", Amount.NEAR(1))
    await expect(builder.delegateV2({ nonceIndex: -1 })).rejects.toThrow(
      /0\.\.=65535/,
    )
    expect(requests).toEqual([])
  })
})

describe("TransactionBuilder - NEP-616 StateInit", () => {
  test("should chain stateInit action with account ID reference", async () => {
    const builder = createBuilder().stateInit({
      code: { accountId: "publisher.near" },
      deposit: "5 NEAR",
    })
    expect(builder).toBeInstanceOf(TransactionBuilder)
    expect((await builder.build()).actions).toEqual([
      {
        deterministicStateInit: {
          stateInit: {
            V1: { code: { AccountId: "publisher.near" }, data: new Map() },
          },
          deposit: 5000000000000000000000000n,
        },
      },
    ])
  })

  test("should chain stateInit action with code hash (Uint8Array)", async () => {
    const transaction = await createBuilder()
      .stateInit({
        code: { codeHash: new Uint8Array(32).fill(0xab) },
        deposit: "10 NEAR",
      })
      .build()
    expect(transaction.actions).toEqual([
      {
        deterministicStateInit: {
          stateInit: {
            V1: { code: { CodeHash: Array(32).fill(0xab) }, data: new Map() },
          },
          deposit: 10000000000000000000000000n,
        },
      },
    ])
  })

  test("should chain stateInit action with code hash (base58 string)", async () => {
    const transaction = await createBuilder()
      .stateInit({
        code: { codeHash: "11111111111111111111111111111111" },
        deposit: "3 NEAR",
      })
      .build()
    expect(transaction.actions).toEqual([
      {
        deterministicStateInit: {
          stateInit: {
            V1: { code: { CodeHash: Array(32).fill(0) }, data: new Map() },
          },
          deposit: 3000000000000000000000000n,
        },
      },
    ])
  })

  test("should chain stateInit action with initial data", async () => {
    const transaction = await createBuilder()
      .stateInit({
        code: { accountId: "publisher.near" },
        deposit: "5 NEAR",
        data: new Map([
          [
            new TextEncoder().encode("key1"),
            new TextEncoder().encode("value1"),
          ],
        ]),
      })
      .build()
    expect(transaction.actions).toEqual([
      {
        deterministicStateInit: {
          stateInit: {
            V1: {
              code: { AccountId: "publisher.near" },
              data: new Map([
                [
                  new Uint8Array([107, 101, 121, 49]),
                  new Uint8Array([118, 97, 108, 117, 101, 49]),
                ],
              ]),
            },
          },
          deposit: 5000000000000000000000000n,
        },
      },
    ])
  })

  test("should set receiver ID to deterministic account ID", async () => {
    const transaction = await createBuilder()
      .stateInit({
        code: { accountId: "publisher.near" },
        deposit: "5 NEAR",
      })
      .build()
    expect(transaction.receiverId).toBe(STATE_INIT_RECEIVER)
  })

  test("should throw error for invalid base58 code hash", () => {
    expect(() =>
      createBuilder().stateInit({
        code: { codeHash: "invalid-base58-!@#" },
        deposit: "5 NEAR",
      }),
    ).toThrow("Invalid base58 code hash")
  })

  test("should throw error for wrong-length code hash (Uint8Array)", () => {
    expect(() =>
      createBuilder().stateInit({
        code: { codeHash: new Uint8Array(16).fill(0xab) },
        deposit: "5 NEAR",
      }),
    ).toThrow("Code hash must be 32 bytes")
  })

  test("should throw error for wrong-length code hash (base58)", () => {
    expect(() =>
      createBuilder().stateInit({
        code: { codeHash: "111111111111111111111111" },
        deposit: "5 NEAR",
      }),
    ).toThrow("Code hash must be 32 bytes")
  })

  test("should chain stateInit with other actions", async () => {
    const transaction = await createBuilder()
      .stateInit({ code: { accountId: "publisher.near" }, deposit: "5 NEAR" })
      .functionCall(
        "contract.near",
        "callback",
        {},
        { attachedDeposit: "1 NEAR" },
      )
      .build()
    expect(transaction.receiverId).toBe(STATE_INIT_RECEIVER)
    expect(transaction.actions).toEqual([
      {
        deterministicStateInit: {
          stateInit: {
            V1: { code: { AccountId: "publisher.near" }, data: new Map() },
          },
          deposit: 5000000000000000000000000n,
        },
      },
      {
        functionCall: {
          methodName: "callback",
          args: new Uint8Array([123, 125]),
          gas: 30000000000000n,
          deposit: 1000000000000000000000000n,
        },
      },
    ])
  })
})
