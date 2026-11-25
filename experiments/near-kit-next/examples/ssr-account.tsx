/** Public account page recipe. The application owns sources, QueryClient and routing. */
import * as Near from "@near-kit/next"
import { isAccountId, parseHash } from "@near-kit/next/data"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import * as Effect from "effect/Effect"

export interface AccountSource {
  // One key identifies one immutable endpoint/configuration, on server and browser.
  readonly key: string
  readonly client: Near.Client
}
export interface AccountIdentity {
  readonly requestId: string
  readonly sourceKey: string
  readonly accountId: string
}
export interface AccountSnapshot extends AccountIdentity {
  readonly amount: bigint
  readonly blockHeight: bigint
  readonly blockHash: string
}
const invalid = () => new TypeError("Invalid SSR account payload")
function identity(value: AccountIdentity): AccountIdentity {
  for (const text of [value.requestId, value.sourceKey]) {
    if (
      typeof text !== "string" ||
      text.length < 1 ||
      text.length > 80 ||
      /[^a-zA-Z0-9._-]/.test(text)
    )
      throw invalid()
  }
  if (!isAccountId(value.accountId)) throw invalid()
  return Object.freeze({
    requestId: value.requestId,
    sourceKey: value.sourceKey,
    accountId: value.accountId,
  })
}
function decimal(value: unknown, max: bigint): bigint {
  if (
    typeof value !== "string" ||
    value.length > max.toString().length ||
    /^(0|[1-9][0-9]*)$/.exec(value)?.[0] !== value
  )
    throw invalid()
  const result = BigInt(value)
  if (result > max) throw invalid()
  return result
}

/**
 * Expect the current route/document identity, never the incoming payload's identity.
 * This detects accidental swaps; matching attributes do not authenticate a viewer.
 */
export function parseSsrAccount(
  json: string,
  expected: AccountIdentity,
): AccountSnapshot {
  const selected = identity(expected)
  if (typeof json !== "string" || json.length > 2048) throw invalid()
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch {
    throw invalid()
  }
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw invalid()
  const wire = value as Record<string, unknown>
  const keys = [
    "version",
    "requestId",
    "sourceKey",
    "accountId",
    "amount",
    "blockHeight",
    "blockHash",
  ]
  if (
    Object.keys(wire).length !== keys.length ||
    !keys.every((key) => Object.hasOwn(wire, key)) ||
    wire.version !== 1 ||
    wire.requestId !== selected.requestId ||
    wire.sourceKey !== selected.sourceKey ||
    wire.accountId !== selected.accountId ||
    typeof wire.blockHash !== "string"
  )
    throw invalid()
  try {
    parseHash(wire.blockHash) // Canonical base58 encoding of exactly 32 bytes.
  } catch {
    throw invalid()
  }
  return Object.freeze({
    ...selected,
    amount: decimal(wire.amount, 340282366920938463463374607431768211455n),
    blockHeight: decimal(wire.blockHeight, 18446744073709551615n),
    blockHash: wire.blockHash,
  })
}

/** Safe as application/json script text; HTML attributes need separate escaping. */
export function serializeSsrAccount(value: AccountSnapshot): string {
  const json = JSON.stringify({
    version: 1,
    ...identity(value),
    amount: value.amount.toString(),
    blockHeight: value.blockHeight.toString(),
    blockHash: value.blockHash,
  })
  parseSsrAccount(json, value)
  return json.replace(/</g, "\\u003c")
}

/** No runtime/cache is retained. Abort belongs to the incoming request or query. */
export async function readSsrAccount(
  source: AccountSource,
  expected: AccountIdentity,
  signal: AbortSignal,
): Promise<AccountSnapshot> {
  signal.throwIfAborted()
  const selected = identity(expected)
  if (source.key !== selected.sourceKey) throw invalid()
  const account = await Effect.runPromise(
    Near.account(source.client, selected.accountId, { at: "final" }).pipe(
      Effect.provide(Near.fetchLayer),
    ),
    { signal },
  )
  signal.throwIfAborted()
  return Object.freeze({
    ...selected,
    amount: account.amount,
    blockHeight: account.blockHeight,
    blockHash: account.blockHash,
  })
}

export function ssrAccountQueryOptions(
  source: AccountSource,
  initial: AccountSnapshot,
) {
  const selected = identity(initial)
  if (source.key !== selected.sourceKey) throw invalid()
  const copiedSource = { key: source.key, client: source.client }
  return {
    queryKey: [
      "ssr-account",
      selected.requestId,
      selected.sourceKey,
      selected.accountId,
    ] as const,
    queryFn: ({ signal }: { readonly signal: AbortSignal }) =>
      readSsrAccount(copiedSource, selected, signal),
    initialData: initial,
    // This page shows a snapshot. Only the explicit Refresh button starts a read.
    staleTime: Infinity,
    retry: false as const,
    retryOnMount: false as const,
    refetchOnMount: false as const,
    refetchOnWindowFocus: false as const,
    refetchOnReconnect: false as const,
    refetchInterval: false as const,
    gcTime: 0,
    placeholderData: () => undefined,
  }
}

export function SsrAccount({
  source,
  initial,
}: {
  readonly source: AccountSource
  readonly initial: AccountSnapshot
}) {
  const client = useQueryClient()
  const options = ssrAccountQueryOptions(source, initial)
  const query = useQuery(options)
  return (
    <section aria-label="Account snapshot">
      <p>
        {initial.accountId} · {initial.sourceKey}
      </p>
      <p>{query.data.amount.toString()} yoctoNEAR</p>
      <p>
        Block {query.data.blockHeight.toString()} · {query.data.blockHash}
      </p>
      {query.isError && <p role="alert">Could not refresh this account.</p>}
      <button
        type="button"
        onClick={() => void query.refetch()}
        disabled={query.isFetching}
      >
        Refresh
      </button>
      <button
        type="button"
        onClick={() =>
          void client.cancelQueries({ queryKey: options.queryKey, exact: true })
        }
        disabled={!query.isFetching}
      >
        Cancel refresh
      </button>
    </section>
  )
}
