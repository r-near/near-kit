import { Schema } from "effect"
import { describe, expect, test } from "vitest"
import { ActionSchema } from "../../src/effect/protocol-schemas.js"

describe("empty CreateAccount wire payload", () => {
  test("strips unknown object fields without accepting arrays as objects", () => {
    const decode = Schema.decodeUnknownSync(ActionSchema)
    expect(decode({ CreateAccount: { extra: 1 } })).toEqual({
      CreateAccount: {},
    })
    expect(() => decode({ CreateAccount: [] })).toThrow()
    expect(() => decode({ CreateAccount: null })).toThrow()
    expect(decode({ CreateAccount: {} })).toEqual({ CreateAccount: {} })
  })
})
