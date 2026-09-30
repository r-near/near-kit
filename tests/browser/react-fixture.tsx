import { StrictMode, useCallback, useMemo, useState } from "react"
import { createRoot } from "react-dom/client"
import { NearProvider, useCall, useNear, useView } from "@near-kit/react"
import {
  generateKey,
  InMemoryKeyStore,
  RotatingKeyStore,
  verifyNep413Signature,
  type FinalExecutionOutcome,
  type NearConfig,
  type SignMessageParams,
  type WalletConnection,
} from "near-kit"

const message: SignMessageParams = {
  message: "Disposable browser fixture login",
  recipient: "fixture.near",
  nonce: new Uint8Array(32),
}

function errorText(error: unknown): string {
  return error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error)
}

function ReadPanel() {
  const [id, setId] = useState("fast")
  const [enabled, setEnabled] = useState(true)
  const query = useView<{ id: string }, string>({
    contractId: "contract.near",
    method: "read",
    args: { id },
    enabled,
  })
  return (
    <section aria-label="Read workflow">
      <button onClick={() => setId("slow")}>Read slow</button>
      <button onClick={() => setId("fast")}>Read fast</button>
      <button onClick={() => setEnabled((value) => !value)}>Toggle read</button>
      <button
        onClick={() => {
          void query.refetch()
        }}
      >
        Refetch
      </button>
      <output data-testid="read-state">
        {JSON.stringify({
          data: query.data,
          loading: query.isLoading,
          error: query.error?.message,
        })}
      </output>
    </section>
  )
}

interface Outcome {
  id: string
  hash?: string | undefined
  error?: string | undefined
}

function MutationPanel({
  onOutcome,
}: {
  onOutcome: (outcome: Outcome) => void
}) {
  const mutation = useCall<{ id: string }, FinalExecutionOutcome>({
    contractId: "contract.near",
    method: "write",
  })
  const start = (id: string) => {
    void mutation.mutate({ id }).then(
      (result) => onOutcome({ id, hash: result.transaction?.hash }),
      (error: unknown) => onOutcome({ id, error: errorText(error) }),
    )
  }
  return (
    <section aria-label="Mutation workflow">
      <button onClick={() => start("first")}>Mutate first</button>
      <button onClick={() => start("second")}>Mutate second</button>
      <button onClick={mutation.reset}>Reset mutation</button>
      <output data-testid="mutation-state">
        {JSON.stringify({
          hash: mutation.data?.transaction?.hash,
          pending: mutation.isPending,
          success: mutation.isSuccess,
          error: mutation.error?.message,
        })}
      </output>
    </section>
  )
}

function AuthorityPanel() {
  const near = useNear()
  const [signed, setSigned] = useState("")
  const [failure, setFailure] = useState("")
  const signMessage = () => {
    void near
      .signMessage(message)
      .then(async (result) => {
        const verified = await verifyNep413Signature(result, message, {
          nonceValidation: "none",
        })
        setSigned(JSON.stringify({ publicKey: result.publicKey, verified }))
      })
      .catch((error: unknown) => setFailure(errorText(error)))
  }
  const signTransaction = () => {
    void near
      .transaction("alice.near")
      .nonce(42n)
      .transfer("bob.near", "1 yocto")
      .sign()
      .then((transaction) =>
        setSigned(JSON.stringify({ hash: transaction.getHash() })),
      )
      .catch((error: unknown) => setFailure(errorText(error)))
  }
  return (
    <section aria-label="Signing authority">
      <button onClick={signMessage}>Sign message</button>
      <button onClick={signTransaction}>Sign transaction</button>
      <output data-testid="signed-result">{signed}</output>
      <output data-testid="signing-error">{failure}</output>
    </section>
  )
}

function ReactFixture({ rpcUrl }: { rpcUrl: string }) {
  const [mode, setMode] = useState<
    "keyStore" | "wallet" | "signer" | "rotating"
  >("keyStore")
  const [authority, setAuthority] = useState<0 | 1>(0)
  const [readMounted, setReadMounted] = useState(true)
  const [mutationMounted, setMutationMounted] = useState(true)
  const [outcomes, setOutcomes] = useState<Outcome[]>([])
  const [signerCalls, setSignerCalls] = useState<string[]>([])
  const resources = useMemo(() => {
    const keys = [generateKey(), generateKey()] as const
    const stores = keys.map(
      (key) => new InMemoryKeyStore({ "alice.near": key.secretKey }),
    )
    const wallets: WalletConnection[] = keys.map((key) => ({
      getAccounts: async () => [{ accountId: "alice.near" }],
      signAndSendTransaction: async () => {
        throw new Error("Message signing must not broadcast")
      },
      signMessage: async (params) => {
        if (!key.signNep413Message)
          throw new Error("Expected disposable Ed25519 key")
        return key.signNep413Message("alice.near", params)
      },
    }))
    const rotatingStore = new RotatingKeyStore({
      "alice.near": keys.map((key) => key.secretKey),
    })
    return { keys, stores, wallets, rotatingStore }
  }, [])
  const signers = useMemo(
    () =>
      [
        async (digest: Uint8Array) => {
          setSignerCalls((calls) => [...calls, "original"])
          return resources.keys[0].sign(digest)
        },
        async (digest: Uint8Array) => {
          setSignerCalls((calls) => [...calls, "replacement"])
          return resources.keys[0].sign(digest)
        },
      ] as const,
    [resources],
  )
  const config: NearConfig = {
    rpcUrl,
    defaultSignerId: "alice.near",
    defaultWaitUntil: "NONE",
    retryConfig: { maxRetries: 0, initialDelayMs: 0 },
    ...(mode === "wallet"
      ? { wallet: resources.wallets[authority] }
      : {
          keyStore:
            mode === "rotating"
              ? resources.rotatingStore
              : resources.stores[mode === "signer" ? 0 : authority],
        }),
    ...(mode === "signer" ? { signer: signers[authority] } : {}),
  }
  const onOutcome = useCallback(
    (outcome: Outcome) => setOutcomes((current) => [...current, outcome]),
    [],
  )
  return (
    <>
      <h1>Real near-kit React browser fixture</h1>
      <select
        aria-label="Authority mode"
        value={mode}
        onChange={(event) => {
          const value = event.target.value
          if (
            value === "keyStore" ||
            value === "wallet" ||
            value === "signer" ||
            value === "rotating"
          ) {
            setMode(value)
            setAuthority(0)
          }
        }}
      >
        <option value="keyStore">Key store</option>
        <option value="wallet">Wallet</option>
        <option value="signer">Signer</option>
        <option value="rotating">Rotating keys</option>
      </select>
      <button onClick={() => setAuthority(1)}>Replace authority</button>
      <output data-testid="expected-original-key">
        {resources.keys[0].publicKey.toString()}
      </output>
      <output data-testid="expected-replacement-key">
        {resources.keys[1].publicKey.toString()}
      </output>
      <output data-testid="signer-calls">{JSON.stringify(signerCalls)}</output>
      <button onClick={() => setReadMounted((value) => !value)}>
        {readMounted ? "Unmount read" : "Remount read"}
      </button>
      <button onClick={() => setMutationMounted((value) => !value)}>
        {mutationMounted ? "Unmount mutation" : "Remount mutation"}
      </button>
      <output data-testid="mutation-outcomes">
        {JSON.stringify(outcomes)}
      </output>
      <NearProvider config={config}>
        {readMounted && <ReadPanel />}
        {mutationMounted && <MutationPanel onOutcome={onOutcome} />}
        <AuthorityPanel />
      </NearProvider>
    </>
  )
}

export function mountReactFixture(rpcUrl: string, strict = false): void {
  const element = document.createElement("main")
  element.id = "react-fixture"
  document.body.append(element)
  const fixture = <ReactFixture rpcUrl={rpcUrl} />
  createRoot(element).render(
    strict ? <StrictMode>{fixture}</StrictMode> : fixture,
  )
}
