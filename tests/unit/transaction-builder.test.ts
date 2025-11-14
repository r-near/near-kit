/**
 * Tests for TransactionBuilder fluent API
 * Note: build() and send() are not tested here as they require RPC access
 */

import { describe, expect, test } from "bun:test"
import { RpcClient } from "../../src/core/rpc/rpc.js"
import { TransactionBuilder } from "../../src/core/transaction.js"
import { InMemoryKeyStore } from "../../src/keys/keystore.js"

// Valid test public key for testing
const TEST_PUBLIC_KEY = "ed25519:DcA2MzgpJbrUATQLLceocVckhhAqrkingax4oJ9kZ847"

// Helper to create a transaction builder for testing
function createBuilder(): TransactionBuilder {
  const rpc = new RpcClient("https://rpc.testnet.fastnear.com")
  const keyStore = new InMemoryKeyStore()

  return new TransactionBuilder("alice.near", rpc, keyStore)
}

describe("TransactionBuilder - Fluent API", () => {
  test("should chain transfer action", () => {
    const builder = createBuilder().transfer("bob.near", "1")

    expect(builder).toBeInstanceOf(TransactionBuilder)
    // @ts-expect-error - accessing private field for testing
    expect(builder.actions.length).toBe(1)
    // @ts-expect-error - accessing private field for testing
    expect(builder.actions[0].transfer).toBeDefined()
  })

  test("should chain function call action", () => {
    const builder = createBuilder().functionCall("token.near", "ft_transfer", {
      receiver_id: "bob.near",
      amount: "100",
    })

    expect(builder).toBeInstanceOf(TransactionBuilder)
    // @ts-expect-error - accessing private field for testing
    expect(builder.actions.length).toBe(1)
    // @ts-expect-error - accessing private field for testing
    expect(builder.actions[0].functionCall).toBeDefined()
  })

  test("should chain multiple actions", () => {
    const builder = createBuilder()
      .transfer("bob.near", "1")
      .functionCall("token.near", "ft_transfer", {
        receiver_id: "carol.near",
        amount: "100",
      })
      .transfer("dave.near", "2")

    // @ts-expect-error - accessing private field for testing
    expect(builder.actions.length).toBe(3)
  })

  test("should chain createAccount action", () => {
    const builder = createBuilder().createAccount("new-account.near")

    // @ts-expect-error - accessing private field for testing
    expect(builder.actions.length).toBe(1)
    // @ts-expect-error - accessing private field for testing
    expect(builder.actions[0].createAccount).toBeDefined()
  })

  test("should chain deleteAccount action", () => {
    const builder = createBuilder().deleteAccount("beneficiary.near")

    // @ts-expect-error - accessing private field for testing
    expect(builder.actions.length).toBe(1)
    // @ts-expect-error - accessing private field for testing
    expect(builder.actions[0].deleteAccount).toBeDefined()
  })

  test("should chain deployContract action", () => {
    const code = new Uint8Array([1, 2, 3, 4])
    const builder = createBuilder().deployContract("contract.near", code)

    // @ts-expect-error - accessing private field for testing
    expect(builder.actions.length).toBe(1)
    // @ts-expect-error - accessing private field for testing
    expect(builder.actions[0].deployContract).toBeDefined()
  })

  test("should chain stake action", () => {
    const builder = createBuilder().stake(TEST_PUBLIC_KEY, "100")

    // @ts-expect-error - accessing private field for testing
    expect(builder.actions.length).toBe(1)
    // @ts-expect-error - accessing private field for testing
    expect(builder.actions[0].stake).toBeDefined()
  })

  test("should return same builder instance for chaining", () => {
    const builder = createBuilder()
    const result1 = builder.transfer("bob.near", "1")
    const result2 = result1.functionCall("contract.near", "method", {})

    expect(result1).toBe(builder)
    expect(result2).toBe(builder)
  })
})

describe("TransactionBuilder - Gas Parsing", () => {
  test("should parse gas as string", () => {
    const builder = createBuilder().functionCall(
      "contract.near",
      "method",
      {},
      { gas: "30000000000000" },
    )

    // @ts-expect-error - accessing private field for testing
    const action = builder.actions[0].functionCall
    expect(action.gas).toBe(30000000000000n)
  })

  test("should parse gas as number", () => {
    const builder = createBuilder().functionCall(
      "contract.near",
      "method",
      {},
      { gas: 30000000000000 },
    )

    // @ts-expect-error - accessing private field for testing
    const action = builder.actions[0].functionCall
    expect(action.gas).toBe(30000000000000n)
  })

  test("should parse Tgas format", () => {
    const builder = createBuilder().functionCall(
      "contract.near",
      "method",
      {},
      { gas: "30 Tgas" },
    )

    // @ts-expect-error - accessing private field for testing
    const action = builder.actions[0].functionCall
    expect(action.gas).toBe(30000000000000n)
  })

  test("should parse Tgas with different case", () => {
    const builders = [
      createBuilder().functionCall("c.near", "m", {}, { gas: "30 TGas" }),
      createBuilder().functionCall("c.near", "m", {}, { gas: "30 tgas" }),
      createBuilder().functionCall("c.near", "m", {}, { gas: "30 Tgas" }),
    ]

    for (const builder of builders) {
      // @ts-expect-error - accessing private field for testing

      const action = builder.actions[0].functionCall
      expect(action.gas).toBe(30000000000000n)
    }
  })

  test("should parse decimal Tgas", () => {
    const builder = createBuilder().functionCall(
      "contract.near",
      "method",
      {},
      { gas: "1.5 Tgas" },
    )

    // @ts-expect-error - accessing private field for testing
    const action = builder.actions[0].functionCall
    expect(action.gas).toBe(1500000000000n)
  })

  test("should use default gas when not specified", () => {
    const builder = createBuilder().functionCall("contract.near", "method", {})

    // @ts-expect-error - accessing private field for testing
    const action = builder.actions[0].functionCall
    expect(action.gas).toBe(30000000000000n) // DEFAULT_FUNCTION_CALL_GAS
  })
})

describe("TransactionBuilder - Amount Parsing", () => {
  test("should parse transfer amount as string", () => {
    const builder = createBuilder().transfer("bob.near", "10")

    // @ts-expect-error - accessing private field for testing
    const action = builder.actions[0].transfer
    expect(action.deposit).toBe(10n)
  })

  test("should parse transfer amount as number", () => {
    const builder = createBuilder().transfer("bob.near", 10)

    // @ts-expect-error - accessing private field for testing
    const action = builder.actions[0].transfer
    expect(action.deposit).toBe(10n)
  })

  test("should parse attached deposit as string", () => {
    const builder = createBuilder().functionCall(
      "contract.near",
      "method",
      {},
      { attachedDeposit: "5" },
    )

    // @ts-expect-error - accessing private field for testing
    const action = builder.actions[0].functionCall
    expect(action.deposit).toBe(5n)
  })

  test("should parse attached deposit as number", () => {
    const builder = createBuilder().functionCall(
      "contract.near",
      "method",
      {},
      { attachedDeposit: 5 },
    )

    // @ts-expect-error - accessing private field for testing
    const action = builder.actions[0].functionCall
    expect(action.deposit).toBe(5n)
  })

  test("should use zero deposit when not specified", () => {
    const builder = createBuilder().functionCall("contract.near", "method", {})

    // @ts-expect-error - accessing private field for testing
    const action = builder.actions[0].functionCall
    expect(action.deposit).toBe(0n)
  })

  test("should parse stake amount", () => {
    const builder = createBuilder().stake(TEST_PUBLIC_KEY, "100")

    // @ts-expect-error - accessing private field for testing
    const action = builder.actions[0].stake
    expect(action.stake).toBe(100n)
  })
})

describe("TransactionBuilder - Receiver ID Management", () => {
  test("should set receiver ID from transfer", () => {
    const builder = createBuilder().transfer("bob.near", "1")

    // @ts-expect-error - accessing private field for testing
    expect(builder.receiverId).toBe("bob.near")
  })

  test("should set receiver ID from function call", () => {
    const builder = createBuilder().functionCall("contract.near", "method", {})

    // @ts-expect-error - accessing private field for testing
    expect(builder.receiverId).toBe("contract.near")
  })

  test("should set receiver ID from createAccount", () => {
    const builder = createBuilder().createAccount("new.near")

    // @ts-expect-error - accessing private field for testing
    expect(builder.receiverId).toBe("new.near")
  })

  test("should set receiver ID from deployContract", () => {
    const builder = createBuilder().deployContract(
      "contract.near",
      new Uint8Array(),
    )

    // @ts-expect-error - accessing private field for testing
    expect(builder.receiverId).toBe("contract.near")
  })

  test("should keep first receiver ID when chaining", () => {
    const builder = createBuilder()
      .transfer("bob.near", "1")
      .functionCall("contract.near", "method", {})

    // @ts-expect-error - accessing private field for testing
    expect(builder.receiverId).toBe("bob.near")
  })

  test("should not override receiver ID", () => {
    const builder = createBuilder()
      .functionCall("contract1.near", "method", {})
      .functionCall("contract2.near", "method", {})
      .transfer("alice.near", "1")

    // @ts-expect-error - accessing private field for testing
    expect(builder.receiverId).toBe("contract1.near")
  })
})

describe("TransactionBuilder - Action Arguments", () => {
  test("should encode function call arguments as JSON", () => {
    const args = {
      receiver_id: "bob.near",
      amount: "100",
      memo: "test",
    }
    const builder = createBuilder().functionCall(
      "contract.near",
      "method",
      args,
    )

    // @ts-expect-error - accessing private field for testing
    const action = builder.actions[0].functionCall
    const decodedArgs = JSON.parse(new TextDecoder().decode(action.args))
    expect(decodedArgs).toEqual(args)
  })

  test("should handle empty arguments", () => {
    const builder = createBuilder().functionCall("contract.near", "method")

    // @ts-expect-error - accessing private field for testing
    const action = builder.actions[0].functionCall
    const decodedArgs = JSON.parse(new TextDecoder().decode(action.args))
    expect(decodedArgs).toEqual({})
  })

  test("should handle complex nested arguments", () => {
    const args = {
      data: {
        nested: {
          value: 123,
          array: [1, 2, 3],
        },
      },
    }
    const builder = createBuilder().functionCall(
      "contract.near",
      "method",
      args,
    )

    // @ts-expect-error - accessing private field for testing
    const action = builder.actions[0].functionCall
    const decodedArgs = JSON.parse(new TextDecoder().decode(action.args))
    expect(decodedArgs).toEqual(args)
  })
})

describe("TransactionBuilder - Complex Scenarios", () => {
  test("should build multi-action transaction", () => {
    const builder = createBuilder()
      .createAccount("new.near")
      .transfer("new.near", "10")
      .deployContract("new.near", new Uint8Array([1, 2, 3]))
      .functionCall("new.near", "init", { owner: "alice.near" })

    // @ts-expect-error - accessing private field for testing
    expect(builder.actions.length).toBe(4)
    // @ts-expect-error - accessing private field for testing
    expect(builder.actions[0].createAccount).toBeDefined()
    // @ts-expect-error - accessing private field for testing
    expect(builder.actions[1].transfer).toBeDefined()
    // @ts-expect-error - accessing private field for testing
    expect(builder.actions[2].deployContract).toBeDefined()
    // @ts-expect-error - accessing private field for testing
    expect(builder.actions[3].functionCall).toBeDefined()
  })

  test("should handle transaction with gas and deposit", () => {
    const builder = createBuilder()
      .functionCall(
        "contract.near",
        "method1",
        { arg: "value1" },
        { gas: "50 Tgas", attachedDeposit: "1" },
      )
      .functionCall(
        "contract.near",
        "method2",
        { arg: "value2" },
        { gas: 100000000000000, attachedDeposit: 2 },
      )

    // @ts-expect-error - accessing private field for testing
    expect(builder.actions.length).toBe(2)
    // @ts-expect-error - accessing private field for testing
    expect(builder.actions[0].functionCall.gas).toBe(50000000000000n)
    // @ts-expect-error - accessing private field for testing
    expect(builder.actions[0].functionCall.deposit).toBe(1n)
    // @ts-expect-error - accessing private field for testing
    expect(builder.actions[1].functionCall.gas).toBe(100000000000000n)
    // @ts-expect-error - accessing private field for testing
    expect(builder.actions[1].functionCall.deposit).toBe(2n)
  })

  test("should build transaction with all action types", () => {
    const builder = createBuilder()
      .createAccount("new.near")
      .transfer("new.near", "10")
      .deployContract("new.near", new Uint8Array())
      .functionCall("new.near", "init", {})
      .stake(TEST_PUBLIC_KEY, "100")
      .deleteAccount("beneficiary.near")

    // @ts-expect-error - accessing private field for testing
    expect(builder.actions.length).toBe(6)
  })
})

describe("TransactionBuilder - Edge Cases", () => {
  test("should handle zero amounts", () => {
    const builder = createBuilder()
      .transfer("bob.near", "0")
      .functionCall("contract.near", "method", {}, { attachedDeposit: "0" })

    // @ts-expect-error - accessing private field for testing
    expect(builder.actions[0].transfer.deposit).toBe(0n)
    // @ts-expect-error - accessing private field for testing
    expect(builder.actions[1].functionCall.deposit).toBe(0n)
  })

  test("should handle very large amounts", () => {
    const largeAmount = "999999999999999999999999"
    const builder = createBuilder().transfer("bob.near", largeAmount)

    // @ts-expect-error - accessing private field for testing
    expect(builder.actions[0].transfer.deposit).toBe(BigInt(largeAmount))
  })

  test("should handle very large gas values", () => {
    const largeGas = "300000000000000" // 300 Tgas
    const builder = createBuilder().functionCall(
      "contract.near",
      "method",
      {},
      { gas: largeGas },
    )

    // @ts-expect-error - accessing private field for testing
    expect(builder.actions[0].functionCall.gas).toBe(BigInt(largeGas))
  })

  test("should create empty transaction", () => {
    const builder = createBuilder()

    // @ts-expect-error - accessing private field for testing
    expect(builder.actions.length).toBe(0)
    // @ts-expect-error - accessing private field for testing
    expect(builder.signerId).toBe("alice.near")
  })
})
