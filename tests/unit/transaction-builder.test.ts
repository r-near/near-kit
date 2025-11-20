/**
 * Tests for TransactionBuilder fluent API
 * Note: build() and send() are not tested here as they require RPC access
 */

import { describe, expect, test } from "vitest"
import { RpcClient } from "../../src/core/rpc/rpc.js"
import { TransactionBuilder } from "../../src/core/transaction.js"
import { InMemoryKeyStore } from "../../src/keys/index.js"
import { Amount } from "../../src/utils/amount.js"
import { Gas } from "../../src/utils/gas.js"

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
    const builder = createBuilder().transfer("bob.near", Amount.NEAR(1))

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
      .transfer("bob.near", Amount.NEAR(1))
      .functionCall("token.near", "ft_transfer", {
        receiver_id: "carol.near",
        amount: "100",
      })
      .transfer("dave.near", Amount.NEAR(2))

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
    const builder = createBuilder().stake(TEST_PUBLIC_KEY, Amount.NEAR(100))

    // @ts-expect-error - accessing private field for testing
    expect(builder.actions.length).toBe(1)
    // @ts-expect-error - accessing private field for testing
    expect(builder.actions[0].stake).toBeDefined()
  })

  test("should return same builder instance for chaining", () => {
    const builder = createBuilder()
    const result1 = builder.transfer("bob.near", Amount.NEAR(1))
    const result2 = result1.functionCall("contract.near", "method", {})

    expect(result1).toBe(builder)
    expect(result2).toBe(builder)
  })
})

describe("TransactionBuilder - Gas Parsing", () => {
  test("should parse gas as raw number string", () => {
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

  test("should parse Gas.Tgas() output", () => {
    const builder = createBuilder().functionCall(
      "contract.near",
      "method",
      {},
      { gas: Gas.Tgas(30) },
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
      createBuilder().functionCall(
        "c.near",
        "m",
        {},
        // biome-ignore lint/suspicious/noExplicitAny: testing different casing
        { gas: "30 TGas" as any },
      ),
      createBuilder().functionCall(
        "c.near",
        "m",
        {},
        // biome-ignore lint/suspicious/noExplicitAny: testing different casing
        { gas: "30 tgas" as any },
      ),
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
  test("should parse transfer amount with Amount.NEAR()", () => {
    const builder = createBuilder().transfer("bob.near", Amount.NEAR(10))

    // @ts-expect-error - accessing private field for testing
    const action = builder.actions[0].transfer
    expect(action.deposit).toBe(10000000000000000000000000n)
  })

  test("should parse transfer amount with string format", () => {
    const builder = createBuilder().transfer("bob.near", "10 NEAR")

    // @ts-expect-error - accessing private field for testing
    const action = builder.actions[0].transfer
    expect(action.deposit).toBe(10000000000000000000000000n)
  })

  test("should parse attached deposit with Amount.NEAR()", () => {
    const builder = createBuilder().functionCall(
      "contract.near",
      "method",
      {},
      { attachedDeposit: Amount.NEAR(5) },
    )

    // @ts-expect-error - accessing private field for testing
    const action = builder.actions[0].functionCall
    expect(action.deposit).toBe(5000000000000000000000000n)
  })

  test("should parse attached deposit with string format", () => {
    const builder = createBuilder().functionCall(
      "contract.near",
      "method",
      {},
      { attachedDeposit: "5 NEAR" },
    )

    // @ts-expect-error - accessing private field for testing
    const action = builder.actions[0].functionCall
    expect(action.deposit).toBe(5000000000000000000000000n)
  })

  test("should use zero deposit when not specified", () => {
    const builder = createBuilder().functionCall("contract.near", "method", {})

    // @ts-expect-error - accessing private field for testing
    const action = builder.actions[0].functionCall
    expect(action.deposit).toBe(0n)
  })

  test("should parse stake amount with Amount.NEAR()", () => {
    const builder = createBuilder().stake(TEST_PUBLIC_KEY, Amount.NEAR(100))

    // @ts-expect-error - accessing private field for testing
    const action = builder.actions[0].stake
    expect(action.stake).toBe(100000000000000000000000000n)
  })
})

describe("TransactionBuilder - Receiver ID Management", () => {
  test("should set receiver ID from transfer", () => {
    const builder = createBuilder().transfer("bob.near", Amount.NEAR(1))

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
      .transfer("bob.near", Amount.NEAR(1))
      .functionCall("contract.near", "method", {})

    // @ts-expect-error - accessing private field for testing
    expect(builder.receiverId).toBe("bob.near")
  })

  test("should not override receiver ID", () => {
    const builder = createBuilder()
      .functionCall("contract1.near", "method", {})
      .functionCall("contract2.near", "method", {})
      .transfer("alice.near", Amount.NEAR(1))

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

  test("should accept Uint8Array arguments directly (e.g., Borsh-serialized)", () => {
    // Simulate pre-serialized bytes (e.g., from Borsh)
    const argsBytes = new Uint8Array([1, 2, 3, 4, 5])
    const builder = createBuilder().functionCall(
      "contract.near",
      "method",
      argsBytes,
    )

    // @ts-expect-error - accessing private field for testing
    const action = builder.actions[0].functionCall
    expect(action.args).toEqual(argsBytes)
    expect(action.args).toBeInstanceOf(Uint8Array)
  })

  test("should pass through Uint8Array without modification", () => {
    // Create a specific byte sequence
    const customBytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef])
    const builder = createBuilder().functionCall(
      "contract.near",
      "borsh_method",
      customBytes,
    )

    // @ts-expect-error - accessing private field for testing
    const action = builder.actions[0].functionCall
    // Verify bytes are identical (not JSON-encoded)
    expect(action.args).toEqual(customBytes)
    expect(action.args[0]).toBe(0xde)
    expect(action.args[1]).toBe(0xad)
    expect(action.args[2]).toBe(0xbe)
    expect(action.args[3]).toBe(0xef)
  })
})

describe("TransactionBuilder - Complex Scenarios", () => {
  test("should build multi-action transaction", () => {
    const builder = createBuilder()
      .createAccount("new.near")
      .transfer("new.near", Amount.NEAR(10))
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
        { gas: "50 Tgas", attachedDeposit: Amount.NEAR(1) },
      )
      .functionCall(
        "contract.near",
        "method2",
        { arg: "value2" },
        { gas: "100 Tgas", attachedDeposit: Amount.NEAR(2) },
      )

    // @ts-expect-error - accessing private field for testing
    expect(builder.actions.length).toBe(2)
    // @ts-expect-error - accessing private field for testing
    expect(builder.actions[0].functionCall.gas).toBe(50000000000000n)
    // @ts-expect-error - accessing private field for testing
    expect(builder.actions[0].functionCall.deposit).toBe(
      1000000000000000000000000n,
    )
    // @ts-expect-error - accessing private field for testing
    expect(builder.actions[1].functionCall.gas).toBe(100000000000000n)
    // @ts-expect-error - accessing private field for testing
    expect(builder.actions[1].functionCall.deposit).toBe(
      2000000000000000000000000n,
    )
  })

  test("should build transaction with all action types", () => {
    const builder = createBuilder()
      .createAccount("new.near")
      .transfer("new.near", Amount.NEAR(10))
      .deployContract("new.near", new Uint8Array())
      .functionCall("new.near", "init", {})
      .stake(TEST_PUBLIC_KEY, Amount.NEAR(100))
      .deleteAccount("beneficiary.near")

    // @ts-expect-error - accessing private field for testing
    expect(builder.actions.length).toBe(6)
  })
})

describe("TransactionBuilder - Edge Cases", () => {
  test("should handle zero amounts", () => {
    const builder = createBuilder()
      .transfer("bob.near", Amount.NEAR(0))
      .functionCall(
        "contract.near",
        "method",
        {},
        {
          attachedDeposit: Amount.NEAR(0),
        },
      )

    // @ts-expect-error - accessing private field for testing
    expect(builder.actions[0].transfer.deposit).toBe(0n)
    // @ts-expect-error - accessing private field for testing
    expect(builder.actions[1].functionCall.deposit).toBe(0n)
  })

  test("should handle very large amounts with yocto", () => {
    const largeYocto = "999999999999999999999999"
    const builder = createBuilder().transfer(
      "bob.near",
      Amount.yocto(largeYocto),
    )

    // @ts-expect-error - accessing private field for testing
    expect(builder.actions[0].transfer.deposit).toBe(BigInt(largeYocto))
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
