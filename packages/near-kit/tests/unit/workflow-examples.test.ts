import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Tracer from "effect/Tracer"
import { generateKey } from "near-kit"
import { describe, expect, test } from "vitest"
import { nativeWorkflow } from "../../../../examples/workflow-native.js"
import { runPromiseWorkflow } from "../../../../examples/workflow-promise.js"
import { WorkflowIdentity, workflowFixture } from "./workflow-fixture.js"

describe("paired application workflow examples", () => {
  test("native signer, RPC, nonce and reconciliation spans keep application context", async () => {
    const fixture = await workflowFixture([generateKey()], { trace: true })
    const spans: Tracer.NativeSpan[] = []
    const tracer = Tracer.make({
      span(options) {
        const span = new Tracer.NativeSpan(options)
        spans.push(span)
        return span
      },
    })
    await Effect.runPromise(
      nativeWorkflow({
        accounts: fixture.accounts,
        receiverId: "receiver.fixture.testnet",
        readCount: 2,
        transfersPerAccount: 2,
        pageSize: 8,
        concurrency: 2,
      }).pipe(
        Effect.provide(fixture.layer),
        Effect.withSpan("App.workflow"),
        Effect.provideService(WorkflowIdentity, "workflow-42"),
        Effect.provideService(Tracer.Tracer, tracer),
      ),
    )
    const root = spans.find((span) => span.name === "App.workflow")
    expect(root).toBeDefined()
    for (const name of [
      "Example.workflow",
      "Near.view",
      "NonceReservation.reserve",
      "Transaction.sign",
      "Transaction.reconcile",
      "Rpc.request",
    ]) {
      const matches = spans.filter((span) => span.name === name)
      expect(matches.length, name).toBeGreaterThan(0)
      for (const span of matches) {
        expect(span.traceId, name).toBe(root?.traceId)
        expect(ancestors(span), name).toContain("App.workflow")
        expect(span.status._tag, name).toBe("Ended")
      }
    }
    expect(fixture.observations.some((entry) => entry.kind === "rpc")).toBe(
      true,
    )
    expect(
      fixture.observations.filter((entry) => entry.kind === "signer"),
    ).toHaveLength(2)
    for (const observation of fixture.observations) {
      expect(observation.identity).toBe("workflow-42")
      expect(ancestors(observation.span)).toContain("Example.workflow")
      expect(observation.span.traceId).toBe(root?.traceId)
      if (observation.kind === "signer")
        expect(ancestors(observation.span)).toContain("Transaction.sign")
    }
    expect(fixture.snapshot()).toMatchObject({ signatures: 2, active: 0 })
    expect([...fixture.released].sort()).toEqual([...fixture.acquired].sort())
  })
  test("streams bounded work and reconciles the same real signed commitments", async () => {
    const keys = Array.from({ length: 4 }, () => generateKey())
    const commitments: string[][] = []
    for (const mode of ["native", "promise"] as const) {
      const fixture = await workflowFixture(keys)
      const input = {
        accounts: fixture.accounts,
        receiverId: "receiver.fixture.testnet",
        readCount: 24,
        transfersPerAccount: 4,
        pageSize: 8,
        concurrency: 4,
      }
      const result =
        mode === "native"
          ? await Effect.runPromise(
              nativeWorkflow(input).pipe(Effect.provide(fixture.layer)),
            )
          : await runPromiseWorkflow(fixture.layer, input)
      expect(result.state).toHaveLength(128)
      expect(new Set(result.state.map((item) => item.key)).size).toBe(128)
      expect(result.reads).toEqual(
        Array.from({ length: 24 }, (_, index) => ({
          accountId: fixture.accounts[index % 4],
          index,
        })),
      )
      expect(result.transactions).toHaveLength(16)
      expect(fixture.submissions).toHaveLength(16)
      expect(fixture.statusHashes).toEqual([fixture.submissions[0]?.hash])
      for (const account of fixture.accounts) {
        expect(
          fixture.submissions
            .filter((tx) => tx.signerId === account)
            .map((tx) => tx.nonce),
        ).toEqual([101, 102, 103, 104])
      }
      expect(
        fixture.submissions.every(
          (tx) =>
            tx.signatureValid &&
            tx.receiverId === input.receiverId &&
            tx.actions.length === 1 &&
            tx.actions[0]?.kind === "transfer" &&
            tx.actions[0].deposit === "1",
        ),
      ).toBe(true)
      const snapshot = fixture.snapshot()
      expect(snapshot.signatures).toBe(16)
      expect(snapshot.maximum).toBeGreaterThan(1)
      expect(snapshot.maximum).toBeLessThanOrEqual(input.concurrency)
      expect(snapshot.active).toBe(0)
      expect([...fixture.acquired].sort()).toEqual([
        "keys",
        "nonces",
        "rpc",
        "transport",
      ])
      expect([...fixture.released].sort()).toEqual([...fixture.acquired].sort())
      commitments.push(fixture.submissions.map((tx) => tx.hash).sort())
    }
    expect(commitments[0]).toEqual(commitments[1])
  })

  test.each(["native", "promise"] as const)(
    "%s workflow exposes transport failure and releases its resources",
    async (mode) => {
      const fixture = await workflowFixture([generateKey(), generateKey()], {
        failRead: true,
      })
      const input = {
        accounts: fixture.accounts,
        receiverId: "receiver.fixture.testnet",
        readCount: 4,
        transfersPerAccount: 1,
        pageSize: 8,
        concurrency: 2,
      }
      const work =
        mode === "native"
          ? Effect.runPromise(
              nativeWorkflow(input).pipe(Effect.provide(fixture.layer)),
            )
          : runPromiseWorkflow(fixture.layer, input)
      let settled = false
      const completion = work.then(
        (value) => {
          settled = true
          return { value, error: undefined }
        },
        (error: unknown) => {
          settled = true
          return { value: undefined, error }
        },
      )
      try {
        await fixture.readFailure.blocked
        const failure = await fixture.readFailure.observed
        if (mode === "promise") {
          // Drain rejection handlers at the next task boundary without a timed
          // sleep. The first request can only finish when this test opens it.
          await new Promise<void>((resolve) => setImmediate(resolve))
          expect(settled).toBe(false)
          expect(fixture.readFailure.state()).toEqual({
            blockedStatus: "pending",
            releasedRead: false,
          })
          expect(fixture.snapshot().active).toBe(1)
          expect(fixture.released).toEqual([])
          fixture.readFailure.release()
        }
        const outcome = await completion
        expect(outcome.error).toBe(failure)
        expect(outcome.error).toMatchObject({
          code: "NETWORK_ERROR",
          statusCode: 400,
          retryable: false,
        })
        expect(fixture.readFailure.state()).toEqual(
          mode === "native"
            ? { blockedStatus: "aborted", releasedRead: false }
            : { blockedStatus: "released", releasedRead: true },
        )
        expect(fixture.submissions).toEqual([])
        expect(fixture.snapshot().active).toBe(0)
        expect([...fixture.released].sort()).toEqual(
          [...fixture.acquired].sort(),
        )
      } finally {
        fixture.readFailure.release()
      }
    },
  )
})

function ancestors(span: Tracer.Span): string[] {
  const names: string[] = []
  let parent = Option.getOrUndefined(span.parent)
  while (parent?._tag === "Span") {
    names.push(parent.name)
    parent = Option.getOrUndefined(parent.parent)
  }
  return names
}
