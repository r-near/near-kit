import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import { Actions, Client } from "near-kit/effect"
import {
  workflowItems,
  type WorkflowInput,
  type WorkflowResult,
} from "./workflow-common.js"

/** Provide one Client.layer graph around this whole application workflow. */
export const nativeWorkflow = Effect.fn("Example.workflow")(function* (
  input: WorkflowInput,
) {
  const { service: near } = yield* Client
  const items = workflowItems(input)
  const state = yield* Stream.fromIterable(input.accounts).pipe(
    Stream.flatMap(
      (accountId) =>
        near
          .viewStateAll(accountId, { limit: input.pageSize })
          .pipe(Stream.map((item) => ({ ...item, accountId }))),
      { concurrency: input.concurrency },
    ),
    Stream.runCollect,
  )
  const reads = yield* Stream.fromIterable(items.reads).pipe(
    Stream.mapEffect(
      ({ accountId, index }) => near.view(accountId, "get_status", { index }),
      { concurrency: input.concurrency },
    ),
    Stream.runCollect,
  )
  const transactions = yield* Stream.fromIterable(items.transfers).pipe(
    Stream.mapEffect(
      (signerId) =>
        near.transactions.send(
          {
            signerId,
            receiverId: input.receiverId,
            actions: [Actions.transfer(1n)],
          },
          { waitUntil: "NONE" },
        ),
      { concurrency: input.concurrency },
    ),
    Stream.runCollect,
  )
  return { state, reads, transactions } satisfies WorkflowResult
})
