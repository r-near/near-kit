/**
 * @tanstack/react-query v5 application recipe. Supply a caller-owned QueryClient
 * through QueryClientProvider. React Query alone owns freshness/retries here;
 * the read Effect has no retries, runtime, polling service or background fiber.
 */
import type * as Near from "@near-kit/next"
import { useQuery } from "@tanstack/react-query"
import {
  blockIdentity,
  readWalletAccount,
  useWalletObservation,
  type WalletAccountProps,
  walletNotice,
} from "./wallet-account.js"
import type { WalletSnapshot } from "./wallet-selector-observation.js"

export function walletAccountQueryOptions(
  wallet: WalletSnapshot,
  enabled = true,
  at: Near.At = "final",
) {
  const canRead =
    enabled && wallet.status === "connected" && !wallet.network.mismatch
  const copiedAt = typeof at === "string" ? at : Object.freeze({ ...at })
  return {
    queryKey: [
      "near.account",
      wallet.source.sourceKey,
      wallet.source.revision,
      wallet.source.networkId,
      wallet.status === "connected" ? wallet.accountId : null,
      blockIdentity(copiedAt),
      wallet.observerId,
      wallet.sessionRevision,
      wallet.revision,
      // Moving to a disabled key detaches the old observer and cancels its read.
      canRead ? "enabled" : "disabled",
    ] as const,
    enabled: canRead,
    queryFn: ({ signal }: { readonly signal: AbortSignal }) => {
      signal.throwIfAborted()
      if (!canRead || wallet.status !== "connected")
        throw new Error("Account read is disabled")
      return readWalletAccount(
        wallet.source.client,
        wallet.accountId,
        copiedAt,
        signal,
      )
    },
    retry: false as const,
    retryOnMount: false as const,
    refetchInterval: false as const,
    staleTime: Infinity,
    // No previous identity data survives logout, disable or selection replacement.
    gcTime: 0,
    refetchOnWindowFocus: false as const,
    refetchOnReconnect: false as const,
    refetchOnMount: false as const,
    // Explicitly override any client-wide keepPreviousData/default placeholder.
    placeholderData: () => undefined,
  }
}

export function WalletQueryAccount({
  setup,
  source,
  enabled = true,
  at = "final",
}: WalletAccountProps) {
  const wallet = useWalletObservation(setup, source)
  const notice = walletNotice(wallet, enabled)
  if (notice !== undefined) return <p>{notice}</p>
  // A separate component keeps hook order stable while avoiding even a disabled
  // query/cache entry during SSR or initialization. Disable/logout unmounts this
  // query observer, consuming its AbortSignal and cancelling any pending read.
  return <ObservedAccountQuery wallet={wallet} at={at} />
}

function ObservedAccountQuery({
  wallet,
  at,
}: {
  readonly wallet: WalletSnapshot
  readonly at: Near.At
}) {
  const query = useQuery(walletAccountQueryOptions(wallet, true, at))
  if (query.isError) throw query.error // Interruption/defects remain runtime causes.
  if (query.data === undefined) return <p>Reading account…</p>
  if (query.data.status === "failed") return <p>Could not read this account.</p>
  return <p>{query.data.account.amount.toString()} yoctoNEAR</p>
}
