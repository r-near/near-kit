import { describe, expect, it } from "vitest"
import * as contractsExports from "../../src/contracts/index.js"
import * as rootExports from "../../src/index.js"
import * as sandboxExports from "../../src/sandbox/index.js"

describe("barrel exports", () => {
  it("exposes public API from root index", () => {
    expect(rootExports.Near).toBeDefined()
    expect(rootExports.TransactionBuilder).toBeDefined()
    expect(rootExports.Amount).toBeDefined()
    expect(rootExports.generateKey).toBeTypeOf("function")
  })

  it("re-exports contract helpers", () => {
    expect(contractsExports.createContract).toBeTypeOf("function")
  })

  it("includes sandbox barrel without side effects", () => {
    expect(sandboxExports.Sandbox).toBeDefined()
  })
})
