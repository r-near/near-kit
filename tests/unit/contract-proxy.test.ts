/**
 * Unit tests for contract proxy functionality
 *
 * Tests createContract() and addContractMethod() functions from src/contracts/contract.ts
 * Coverage targets: lines 67-101, 108-112
 */

import { describe, expect, test, vi } from "vitest"
import {
  addContractMethod,
  type ContractMethods,
  createContract,
} from "../../src/contracts/contract.js"
import type {
  BlockReference,
  CallOptions,
} from "../../src/core/config-schemas.js"
import { Near } from "../../src/core/near.js"

describe("createContract()", () => {
  describe("view proxy", () => {
    test("should create proxy with view methods that call near.view()", async () => {
      interface TestContract extends ContractMethods {
        view: {
          getBalance: (args: { account_id: string }) => Promise<string>
        }
        call: Record<string, never>
      }

      const mockNear = {
        view: vi.fn(async () => "view-result"),
        call: vi.fn(async () => ({ status: "success" })),
      }

      const contract = createContract<TestContract>(
        mockNear as unknown as Near,
        "contract.near",
      )

      const result = await contract.view.getBalance({
        account_id: "alice.near",
      })

      expect(result).toBe("view-result")
      expect(mockNear.view).toHaveBeenCalledTimes(1)
      expect(mockNear.view).toHaveBeenCalledWith(
        "contract.near",
        "getBalance",
        { account_id: "alice.near" },
        undefined,
      )
    })

    test("should call view method with no args", async () => {
      interface TestContract extends ContractMethods {
        view: {
          getTotalSupply: () => Promise<number>
        }
        call: Record<string, never>
      }

      const mockNear = {
        view: vi.fn(async () => 42),
        call: vi.fn(),
      }

      const contract = createContract<TestContract>(
        mockNear as unknown as Near,
        "contract.near",
      )

      const result = await contract.view.getTotalSupply()

      expect(result).toBe(42)
      expect(mockNear.view).toHaveBeenCalledWith(
        "contract.near",
        "getTotalSupply",
        {},
        undefined,
      )
    })

    test("should call view method with undefined args", async () => {
      interface TestContract extends ContractMethods {
        view: {
          getMetadata: (args?: undefined) => Promise<string>
        }
        call: Record<string, never>
      }

      const mockNear = {
        view: vi.fn(async () => "result"),
        call: vi.fn(),
      }

      const contract = createContract<TestContract>(
        mockNear as unknown as Near,
        "contract.near",
      )

      const result = await contract.view.getMetadata(undefined)

      expect(result).toBe("result")
      expect(mockNear.view).toHaveBeenCalledWith(
        "contract.near",
        "getMetadata",
        {},
        undefined,
      )
    })

    test("should call view method with empty object args", async () => {
      interface TestContract extends ContractMethods {
        view: {
          getAll: (args?: Record<string, never>) => Promise<string>
        }
        call: Record<string, never>
      }

      const mockNear = {
        view: vi.fn(async () => "result"),
        call: vi.fn(),
      }

      const contract = createContract<TestContract>(
        mockNear as unknown as Near,
        "contract.near",
      )

      const result = await contract.view.getAll({})

      expect(result).toBe("result")
      expect(mockNear.view).toHaveBeenCalledWith(
        "contract.near",
        "getAll",
        {},
        undefined,
      )
    })

    test("should call view method with Uint8Array args", async () => {
      interface TestContract extends ContractMethods {
        view: {
          decodeData: (args: Uint8Array) => Promise<string>
        }
        call: Record<string, never>
      }

      const mockNear = {
        view: vi.fn(async () => "result"),
        call: vi.fn(),
      }

      const contract = createContract<TestContract>(
        mockNear as unknown as Near,
        "contract.near",
      )
      const binaryArgs = new Uint8Array([1, 2, 3, 4])

      const result = await contract.view.decodeData(binaryArgs)

      expect(result).toBe("result")
      expect(mockNear.view).toHaveBeenCalledWith(
        "contract.near",
        "decodeData",
        binaryArgs,
        undefined,
      )
    })

    test("should call view method with BlockReference options", async () => {
      interface TestContract extends ContractMethods {
        view: {
          getBalance: (
            args: { account_id: string },
            blockRef?: BlockReference,
          ) => Promise<string>
        }
        call: Record<string, never>
      }

      const mockNear = {
        view: vi.fn(async () => "result"),
        call: vi.fn(),
      }

      const contract = createContract<TestContract>(
        mockNear as unknown as Near,
        "contract.near",
      )
      const blockRef: BlockReference = { blockId: "12345" }

      const result = await contract.view.getBalance(
        { account_id: "alice.near" },
        blockRef,
      )

      expect(result).toBe("result")
      expect(mockNear.view).toHaveBeenCalledWith(
        "contract.near",
        "getBalance",
        { account_id: "alice.near" },
        blockRef,
      )
    })

    test("should call view method with finality options", async () => {
      interface TestContract extends ContractMethods {
        view: {
          getBalance: (
            args: { account_id: string },
            blockRef?: BlockReference,
          ) => Promise<string>
        }
        call: Record<string, never>
      }

      const mockNear = {
        view: vi.fn(async () => "result"),
        call: vi.fn(),
      }

      const contract = createContract<TestContract>(
        mockNear as unknown as Near,
        "contract.near",
      )
      const blockRef: BlockReference = { finality: "final" }

      const result = await contract.view.getBalance(
        { account_id: "alice.near" },
        blockRef,
      )

      expect(result).toBe("result")
      expect(mockNear.view).toHaveBeenCalledWith(
        "contract.near",
        "getBalance",
        { account_id: "alice.near" },
        blockRef,
      )
    })

    test("should handle multiple sequential view calls", async () => {
      interface TestContract extends ContractMethods {
        view: {
          method1: (args: { arg: string }) => Promise<string>
          method2: (args: { arg: string }) => Promise<string>
          method3: (args: { arg: string }) => Promise<string>
        }
        call: Record<string, never>
      }

      const mockNear = {
        view: vi.fn(async () => "result"),
        call: vi.fn(),
      }

      const contract = createContract<TestContract>(
        mockNear as unknown as Near,
        "contract.near",
      )

      await contract.view.method1({ arg: "a" })
      await contract.view.method2({ arg: "b" })
      await contract.view.method3({ arg: "c" })

      expect(mockNear.view).toHaveBeenCalledTimes(3)
      expect(mockNear.view).toHaveBeenNthCalledWith(
        1,
        "contract.near",
        "method1",
        { arg: "a" },
        undefined,
      )
      expect(mockNear.view).toHaveBeenNthCalledWith(
        2,
        "contract.near",
        "method2",
        { arg: "b" },
        undefined,
      )
      expect(mockNear.view).toHaveBeenNthCalledWith(
        3,
        "contract.near",
        "method3",
        { arg: "c" },
        undefined,
      )
    })

    test("should work with different method names", async () => {
      interface TestContract extends ContractMethods {
        view: {
          get_balance: () => Promise<string>
          ft_balance_of: (args: { account_id: string }) => Promise<string>
          nft_token: (args: { token_id: string }) => Promise<string>
        }
        call: Record<string, never>
      }

      const mockNear = {
        view: vi.fn(async () => "result"),
        call: vi.fn(),
      }

      const contract = createContract<TestContract>(
        mockNear as unknown as Near,
        "contract.near",
      )

      await contract.view.get_balance()
      await contract.view.ft_balance_of({ account_id: "alice.near" })
      await contract.view.nft_token({ token_id: "1" })

      expect(mockNear.view).toHaveBeenCalledTimes(3)
      expect(mockNear.view).toHaveBeenNthCalledWith(
        1,
        "contract.near",
        "get_balance",
        {},
        undefined,
      )
      expect(mockNear.view).toHaveBeenNthCalledWith(
        2,
        "contract.near",
        "ft_balance_of",
        { account_id: "alice.near" },
        undefined,
      )
      expect(mockNear.view).toHaveBeenNthCalledWith(
        3,
        "contract.near",
        "nft_token",
        { token_id: "1" },
        undefined,
      )
    })
  })

  describe("call proxy", () => {
    test("should create proxy with call methods that call near.call()", async () => {
      interface TestContract extends ContractMethods {
        view: Record<string, never>
        call: {
          transfer: (args: {
            receiver_id: string
            amount: string
          }) => Promise<{ status: string }>
        }
      }

      const mockNear = {
        view: vi.fn(),
        call: vi.fn(async () => ({ status: "success" })),
      }

      const contract = createContract<TestContract>(
        mockNear as unknown as Near,
        "contract.near",
      )

      const result = await contract.call.transfer({
        receiver_id: "bob.near",
        amount: "100",
      })

      expect(result).toEqual({ status: "success" })
      expect(mockNear.call).toHaveBeenCalledTimes(1)
      expect(mockNear.call).toHaveBeenCalledWith(
        "contract.near",
        "transfer",
        { receiver_id: "bob.near", amount: "100" },
        {},
      )
    })

    test("should call method with no args", async () => {
      interface TestContract extends ContractMethods {
        view: Record<string, never>
        call: {
          initialize: () => Promise<{ status: string }>
        }
      }

      const mockNear = {
        view: vi.fn(),
        call: vi.fn(async () => ({ status: "success" })),
      }

      const contract = createContract<TestContract>(
        mockNear as unknown as Near,
        "contract.near",
      )

      const result = await contract.call.initialize()

      expect(result).toEqual({ status: "success" })
      expect(mockNear.call).toHaveBeenCalledWith(
        "contract.near",
        "initialize",
        {},
        {},
      )
    })

    test("should call method with undefined args", async () => {
      interface TestContract extends ContractMethods {
        view: Record<string, never>
        call: {
          reset: (args?: undefined) => Promise<{ status: string }>
        }
      }

      const mockNear = {
        view: vi.fn(),
        call: vi.fn(async () => ({ status: "success" })),
      }

      const contract = createContract<TestContract>(
        mockNear as unknown as Near,
        "contract.near",
      )

      const result = await contract.call.reset(undefined)

      expect(result).toEqual({ status: "success" })
      expect(mockNear.call).toHaveBeenCalledWith(
        "contract.near",
        "reset",
        {},
        {},
      )
    })

    test("should call method with empty object args", async () => {
      interface TestContract extends ContractMethods {
        view: Record<string, never>
        call: {
          clearAll: (
            args?: Record<string, never>,
          ) => Promise<{ status: string }>
        }
      }

      const mockNear = {
        view: vi.fn(),
        call: vi.fn(async () => ({ status: "success" })),
      }

      const contract = createContract<TestContract>(
        mockNear as unknown as Near,
        "contract.near",
      )

      const result = await contract.call.clearAll({})

      expect(result).toEqual({ status: "success" })
      expect(mockNear.call).toHaveBeenCalledWith(
        "contract.near",
        "clearAll",
        {},
        {},
      )
    })

    test("should call method with Uint8Array args", async () => {
      interface TestContract extends ContractMethods {
        view: Record<string, never>
        call: {
          uploadData: (args: Uint8Array) => Promise<{ status: string }>
        }
      }

      const mockNear = {
        view: vi.fn(),
        call: vi.fn(async () => ({ status: "success" })),
      }

      const contract = createContract<TestContract>(
        mockNear as unknown as Near,
        "contract.near",
      )
      const binaryArgs = new Uint8Array([10, 20, 30])

      const result = await contract.call.uploadData(binaryArgs)

      expect(result).toEqual({ status: "success" })
      expect(mockNear.call).toHaveBeenCalledWith(
        "contract.near",
        "uploadData",
        binaryArgs,
        {},
      )
    })

    test("should call method with CallOptions", async () => {
      interface TestContract extends ContractMethods {
        view: Record<string, never>
        call: {
          stakeTokens: (
            args: { amount: string },
            options?: CallOptions,
          ) => Promise<{ status: string }>
        }
      }

      const mockNear = {
        view: vi.fn(),
        call: vi.fn(async () => ({ status: "success" })),
      }

      const contract = createContract<TestContract>(
        mockNear as unknown as Near,
        "contract.near",
      )
      const options: CallOptions = {
        gas: "100 Tgas",
        attachedDeposit: "1 NEAR",
      }

      const result = await contract.call.stakeTokens({ amount: "10" }, options)

      expect(result).toEqual({ status: "success" })
      expect(mockNear.call).toHaveBeenCalledWith(
        "contract.near",
        "stakeTokens",
        { amount: "10" },
        options,
      )
    })

    test("should call method with all CallOptions properties", async () => {
      interface TestContract extends ContractMethods {
        view: Record<string, never>
        call: {
          complexOperation: (
            args: { param: string },
            options?: CallOptions,
          ) => Promise<{ status: string }>
        }
      }

      const mockNear = {
        view: vi.fn(),
        call: vi.fn(async () => ({ status: "success" })),
      }

      const contract = createContract<TestContract>(
        mockNear as unknown as Near,
        "contract.near",
      )
      const options: CallOptions = {
        gas: "200 Tgas",
        attachedDeposit: "5 NEAR",
        signerId: "alice.near",
        waitUntil: "FINAL",
      }

      const result = await contract.call.complexOperation(
        { param: "value" },
        options,
      )

      expect(result).toEqual({ status: "success" })
      expect(mockNear.call).toHaveBeenCalledWith(
        "contract.near",
        "complexOperation",
        { param: "value" },
        options,
      )
    })

    test("should call method with undefined options (uses empty object)", async () => {
      interface TestContract extends ContractMethods {
        view: Record<string, never>
        call: {
          doSomething: (
            args: { value: number },
            options?: CallOptions,
          ) => Promise<{ status: string }>
        }
      }

      const mockNear = {
        view: vi.fn(),
        call: vi.fn(async () => ({ status: "success" })),
      }

      const contract = createContract<TestContract>(
        mockNear as unknown as Near,
        "contract.near",
      )

      const result = await contract.call.doSomething({ value: 123 }, undefined)

      expect(result).toEqual({ status: "success" })
      expect(mockNear.call).toHaveBeenCalledWith(
        "contract.near",
        "doSomething",
        { value: 123 },
        {},
      )
    })

    test("should handle multiple sequential call operations", async () => {
      interface TestContract extends ContractMethods {
        view: Record<string, never>
        call: {
          method1: (args: { arg: string }) => Promise<{ status: string }>
          method2: (args: { arg: string }) => Promise<{ status: string }>
          method3: (args: { arg: string }) => Promise<{ status: string }>
        }
      }

      const mockNear = {
        view: vi.fn(),
        call: vi.fn(async () => ({ status: "success" })),
      }

      const contract = createContract<TestContract>(
        mockNear as unknown as Near,
        "contract.near",
      )

      await contract.call.method1({ arg: "a" })
      await contract.call.method2({ arg: "b" })
      await contract.call.method3({ arg: "c" })

      expect(mockNear.call).toHaveBeenCalledTimes(3)
      expect(mockNear.call).toHaveBeenNthCalledWith(
        1,
        "contract.near",
        "method1",
        { arg: "a" },
        {},
      )
      expect(mockNear.call).toHaveBeenNthCalledWith(
        2,
        "contract.near",
        "method2",
        { arg: "b" },
        {},
      )
      expect(mockNear.call).toHaveBeenNthCalledWith(
        3,
        "contract.near",
        "method3",
        { arg: "c" },
        {},
      )
    })

    test("should work with different method names", async () => {
      interface TestContract extends ContractMethods {
        view: Record<string, never>
        call: {
          ft_transfer: (args: {
            receiver_id: string
            amount: string
          }) => Promise<{ status: string }>
          nft_mint: (args: {
            token_id: string
            receiver_id: string
          }) => Promise<{ status: string }>
          storage_deposit: (args: {
            account_id: string
          }) => Promise<{ status: string }>
        }
      }

      const mockNear = {
        view: vi.fn(),
        call: vi.fn(async () => ({ status: "success" })),
      }

      const contract = createContract<TestContract>(
        mockNear as unknown as Near,
        "contract.near",
      )

      await contract.call.ft_transfer({
        receiver_id: "bob.near",
        amount: "100",
      })
      await contract.call.nft_mint({
        token_id: "1",
        receiver_id: "alice.near",
      })
      await contract.call.storage_deposit({ account_id: "charlie.near" })

      expect(mockNear.call).toHaveBeenCalledTimes(3)
    })
  })

  describe("contract with different contract IDs", () => {
    test("should create contracts for different contract IDs", async () => {
      interface TestContract extends ContractMethods {
        view: {
          getData: () => Promise<string>
        }
        call: Record<string, never>
      }

      const mockNear = {
        view: vi.fn(async () => "result"),
        call: vi.fn(async () => ({ status: "success" })),
      }

      const contract1 = createContract<TestContract>(
        mockNear as unknown as Near,
        "contract1.near",
      )
      const contract2 = createContract<TestContract>(
        mockNear as unknown as Near,
        "contract2.testnet",
      )
      const contract3 = createContract<TestContract>(
        mockNear as unknown as Near,
        "my-contract.near",
      )

      await contract1.view.getData()
      await contract2.view.getData()
      await contract3.view.getData()

      expect(mockNear.view).toHaveBeenNthCalledWith(
        1,
        "contract1.near",
        "getData",
        {},
        undefined,
      )
      expect(mockNear.view).toHaveBeenNthCalledWith(
        2,
        "contract2.testnet",
        "getData",
        {},
        undefined,
      )
      expect(mockNear.view).toHaveBeenNthCalledWith(
        3,
        "my-contract.near",
        "getData",
        {},
        undefined,
      )
    })
  })

  describe("type safety", () => {
    test("should support typed contract interfaces", async () => {
      interface MyContract extends ContractMethods {
        view: {
          getBalance: (args: { account_id: string }) => Promise<string>
          getTotalSupply: () => Promise<number>
        }
        call: {
          transfer: (args: {
            receiver_id: string
            amount: string
          }) => Promise<void>
        }
      }

      const mockNear = {
        view: vi.fn(async () => "100"),
        call: vi.fn(async () => undefined),
      }

      const contract = createContract<MyContract>(
        mockNear as unknown as Near,
        "ft.near",
      )

      // TypeScript should enforce correct types
      const balance = await contract.view.getBalance({
        account_id: "alice.near",
      })
      expect(typeof balance).toBe("string")

      await contract.call.transfer({
        receiver_id: "bob.near",
        amount: "50",
      })

      expect(mockNear.view).toHaveBeenCalled()
      expect(mockNear.call).toHaveBeenCalled()
    })
  })

  describe("edge cases", () => {
    test("should handle special characters in method names", async () => {
      interface TestContract extends ContractMethods {
        view: {
          "method-with-dashes": () => Promise<string>
          method_with_underscores: () => Promise<string>
          methodWithCamelCase: () => Promise<string>
        }
        call: Record<string, never>
      }

      const mockNear = {
        view: vi.fn(async () => "result"),
        call: vi.fn(async () => ({ status: "success" })),
      }

      const contract = createContract<TestContract>(
        mockNear as unknown as Near,
        "contract.near",
      )

      await contract.view["method-with-dashes"]()
      await contract.view.method_with_underscores()
      await contract.view.methodWithCamelCase()

      expect(mockNear.view).toHaveBeenCalledTimes(3)
    })

    test("should handle numeric method names", async () => {
      interface TestContract extends ContractMethods {
        view: {
          method123: () => Promise<string>
        }
        call: Record<string, never>
      }

      const mockNear = {
        view: vi.fn(async () => "result"),
        call: vi.fn(async () => ({ status: "success" })),
      }

      const contract = createContract<TestContract>(
        mockNear as unknown as Near,
        "contract.near",
      )

      await contract.view.method123()

      expect(mockNear.view).toHaveBeenCalledWith(
        "contract.near",
        "method123",
        {},
        undefined,
      )
    })

    test("should handle complex nested args", async () => {
      interface TestContract extends ContractMethods {
        view: {
          getComplexData: (args: {
            user: {
              name: string
              account: { id: string; balance: string }
            }
            metadata: {
              tags: string[]
              properties: { color: string; size: number }
            }
          }) => Promise<string>
        }
        call: Record<string, never>
      }

      const mockNear = {
        view: vi.fn(async () => "result"),
        call: vi.fn(async () => ({ status: "success" })),
      }

      const contract = createContract<TestContract>(
        mockNear as unknown as Near,
        "contract.near",
      )

      const complexArgs = {
        user: {
          name: "Alice",
          account: { id: "alice.near", balance: "100" },
        },
        metadata: {
          tags: ["tag1", "tag2"],
          properties: { color: "blue", size: 42 },
        },
      }

      await contract.view.getComplexData(complexArgs)

      expect(mockNear.view).toHaveBeenCalledWith(
        "contract.near",
        "getComplexData",
        complexArgs,
        undefined,
      )
    })

    test("should handle array args", async () => {
      interface TestContract extends ContractMethods {
        view: Record<string, never>
        call: {
          batchProcess: (args: {
            ids: string[]
            amounts: number[]
          }) => Promise<{ status: string }>
        }
      }

      const mockNear = {
        view: vi.fn(async () => "result"),
        call: vi.fn(async () => ({ status: "success" })),
      }

      const contract = createContract<TestContract>(
        mockNear as unknown as Near,
        "contract.near",
      )

      const arrayArgs = {
        ids: ["1", "2", "3"],
        amounts: [100, 200, 300],
      }

      await contract.call.batchProcess(arrayArgs)

      expect(mockNear.call).toHaveBeenCalledWith(
        "contract.near",
        "batchProcess",
        arrayArgs,
        {},
      )
    })
  })
})

describe("addContractMethod()", () => {
  test("should add contract() method to Near prototype", () => {
    // Create a mock Near class for testing
    class MockNear {
      view = vi.fn(async () => "view-result")
      call = vi.fn(async () => ({ status: "success" }))
    }

    // Add contract method to prototype
    addContractMethod(MockNear.prototype as unknown as typeof Near.prototype)

    // Verify the method exists
    expect(MockNear.prototype).toHaveProperty("contract")
    expect(
      typeof (MockNear.prototype as unknown as typeof Near.prototype).contract,
    ).toBe("function")
  })

  test("should create contract proxy when calling near.contract()", () => {
    class MockNear {
      view = vi.fn(async () => "view-result")
      call = vi.fn(async () => ({ status: "success" }))
    }

    addContractMethod(MockNear.prototype as unknown as typeof Near.prototype)

    const near = new MockNear() as unknown as Near
    const contract = near.contract("contract.near")

    expect(contract).toHaveProperty("view")
    expect(contract).toHaveProperty("call")
  })

  test("should delegate to createContract() with correct parameters", async () => {
    interface TestContract extends ContractMethods {
      view: {
        getBalance: (args: { account_id: string }) => Promise<string>
      }
      call: Record<string, never>
    }

    class MockNear {
      view = vi.fn(async () => "view-result")
      call = vi.fn(async () => ({ status: "success" }))
    }

    addContractMethod(MockNear.prototype as unknown as typeof Near.prototype)

    const near = new MockNear() as unknown as Near
    const contract = near.contract<TestContract>("test.near")

    // Test that the proxy works correctly
    await contract.view.getBalance({ account_id: "alice.near" })

    expect(near.view).toHaveBeenCalledWith(
      "test.near",
      "getBalance",
      { account_id: "alice.near" },
      undefined,
    )
  })

  test("should create different proxies for different contract IDs", async () => {
    interface TestContract extends ContractMethods {
      view: {
        getData: () => Promise<string>
      }
      call: Record<string, never>
    }

    class MockNear {
      view = vi.fn(async () => "result")
      call = vi.fn(async () => ({ status: "success" }))
    }

    addContractMethod(MockNear.prototype as unknown as typeof Near.prototype)

    const near = new MockNear() as unknown as Near
    const contract1 = near.contract<TestContract>("contract1.near")
    const contract2 = near.contract<TestContract>("contract2.near")

    await contract1.view.getData()
    await contract2.view.getData()

    expect(near.view).toHaveBeenNthCalledWith(
      1,
      "contract1.near",
      "getData",
      {},
      undefined,
    )
    expect(near.view).toHaveBeenNthCalledWith(
      2,
      "contract2.near",
      "getData",
      {},
      undefined,
    )
  })

  test("should work with real Near class", async () => {
    // This test verifies integration with the actual Near class
    // We don't need to instantiate a real Near, just verify the prototype
    expect(Near.prototype).toHaveProperty("contract")
    expect(typeof Near.prototype.contract).toBe("function")
  })

  test("should maintain 'this' context correctly", async () => {
    interface TestContract extends ContractMethods {
      view: {
        getData: () => Promise<string>
      }
      call: Record<string, never>
    }

    class MockNear {
      private testProperty = "test-value"
      view = vi.fn(async (/* contractId: string */) => {
        // Verify 'this' context is preserved
        expect(this.testProperty).toBe("test-value")
        return "result"
      })
      call = vi.fn(async () => ({ status: "success" }))
    }

    addContractMethod(MockNear.prototype as unknown as typeof Near.prototype)

    const near = new MockNear() as unknown as Near
    const contract = near.contract<TestContract>("contract.near")

    await contract.view.getData()

    expect(near.view).toHaveBeenCalled()
  })

  test("should support TypeScript generic type parameter", () => {
    // Interface defined for type documentation purposes
    // @ts-expect-error - Type defined for documentation, not runtime use
    // biome-ignore lint/correctness/noUnusedVariables: Example type definition for documentation
    interface MyContract extends ContractMethods {
      view: {
        getBalance: (args: { account_id: string }) => Promise<string>
      }
      call: {
        transfer: (args: {
          receiver_id: string
          amount: string
        }) => Promise<void>
      }
    }

    class MockNear {
      view = vi.fn(async () => "100")
      call = vi.fn(async () => undefined)
    }

    addContractMethod(MockNear.prototype as unknown as typeof Near.prototype)

    const near = new MockNear() as unknown as Near
    const contract = near.contract("ft.near")

    // TypeScript should infer correct types
    expect(contract).toHaveProperty("view")
    expect(contract).toHaveProperty("call")
  })

  test("should allow multiple contract instances from same Near instance", async () => {
    interface FTContract extends ContractMethods {
      view: {
        ft_balance_of: (args: { account_id: string }) => Promise<string>
      }
      call: Record<string, never>
    }

    interface NFTContract extends ContractMethods {
      view: {
        nft_tokens: (args: { from_index: string }) => Promise<string>
      }
      call: Record<string, never>
    }

    interface DAOContract extends ContractMethods {
      view: {
        get_proposals: () => Promise<string>
      }
      call: Record<string, never>
    }

    class MockNear {
      view = vi.fn(async () => "result")
      call = vi.fn(async () => ({ status: "success" }))
    }

    addContractMethod(MockNear.prototype as unknown as typeof Near.prototype)

    const near = new MockNear() as unknown as Near
    const ftContract = near.contract<FTContract>("ft.near")
    const nftContract = near.contract<NFTContract>("nft.near")
    const daoContract = near.contract<DAOContract>("dao.near")

    await ftContract.view.ft_balance_of({ account_id: "alice.near" })
    await nftContract.view.nft_tokens({ from_index: "0" })
    await daoContract.view.get_proposals()

    expect(near.view).toHaveBeenCalledTimes(3)
    expect(near.view).toHaveBeenNthCalledWith(
      1,
      "ft.near",
      "ft_balance_of",
      { account_id: "alice.near" },
      undefined,
    )
    expect(near.view).toHaveBeenNthCalledWith(
      2,
      "nft.near",
      "nft_tokens",
      { from_index: "0" },
      undefined,
    )
    expect(near.view).toHaveBeenNthCalledWith(
      3,
      "dao.near",
      "get_proposals",
      {},
      undefined,
    )
  })
})
