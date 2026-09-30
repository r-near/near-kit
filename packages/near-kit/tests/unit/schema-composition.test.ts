import { describe, expect, expectTypeOf, test } from "vitest"
import { z } from "zod"
import { AccountIdSchema, AmountSchema } from "near-kit/schemas"

const TransferForm = z
  .object({
    senderId: AccountIdSchema,
    amount: AmountSchema,
  })
  .extend({ memo: z.string().optional() })

describe("near-kit/schemas composition", () => {
  test("composes genuine Zod schemas with input/output inference and amount conversion", () => {
    expectTypeOf<z.input<typeof TransferForm>>().toEqualTypeOf<{
      senderId: string
      amount: string | bigint
      memo?: string | undefined
    }>()
    expectTypeOf<z.output<typeof TransferForm>>().toEqualTypeOf<{
      senderId: string
      amount: string
      memo?: string | undefined
    }>()
    expect(
      TransferForm.array().parse([
        { senderId: "alice.near", amount: "1.25 NEAR", memo: "coffee" },
        { senderId: "bob.near", amount: 7n },
      ]),
    ).toEqual([
      {
        senderId: "alice.near",
        amount: "1250000000000000000000000",
        memo: "coffee",
      },
      { senderId: "bob.near", amount: "7" },
    ])
  })

  test("retains Zod errors and nested issue paths when composed by a consumer", () => {
    const result = TransferForm.safeParse({ senderId: "ALICE", amount: 1n })
    expect(result.success).toBe(false)
    if (result.success) throw new Error("expected an invalid account")
    expect(result.error).toBeInstanceOf(z.ZodError)
    expect(result.error.issues).toEqual([
      expect.objectContaining({ path: ["senderId"], code: "invalid_format" }),
    ])
  })
})
