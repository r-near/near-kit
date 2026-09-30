import { test, expect } from "./test.js"
import { inspectSignedTransaction, verifyMessage } from "./wire-oracle.js"

// These tests cross built package exports, native browser crypto/fetch, and HTTP.
// The local node records bytes and admission; it does not implement SDK retry policy.
test("root and native package exports read through real HTTP and injected RPC", async ({
  page,
  rpc,
}, testInfo) => {
  expect(await page.evaluate(() => window.kit.environment())).toEqual({
    buffer: "undefined",
    process: "undefined",
    secure: true,
    reactVersion: testInfo.project.name.endsWith("react18")
      ? "18.0.0-fc46dba67-20220329"
      : "19.2.7",
  })
  expect(await page.evaluate((url) => window.kit.reads(url), rpc.url)).toEqual({
    publicBalance: "2.00",
    publicView: 7,
    native: { balance: "2.00", view: 7 },
  })
  const state = await rpc.snapshot()
  expect(state.methods).toEqual(["query", "query", "query", "query"])
  expect(state.headers).toEqual([null, null, "injected", "injected"])
})

test("injected native key store and nonce reservation determine the signed commitment", async ({
  page,
  rpc,
}) => {
  const result = await page.evaluate(
    (url) => window.kit.injectedSigning(url),
    rpc.url,
  )
  expect(inspectSignedTransaction(result.bytes)).toMatchObject({
    signatureValid: true,
    nonce: 1002,
    publicKey: result.publicKey,
    signerId: "alice.near",
    receiverId: "bob.near",
    actions: [{ kind: "transfer", deposit: "9" }],
  })
})

for (const mode of ["classic", "strict", "gas", "strict-gas"] as const) {
  test(`${mode}: public and native signatures match independently decoded NEAR wire bytes`, async ({
    page,
    rpc,
  }) => {
    const result = await page.evaluate(
      ({ url, mode }) => window.kit.signing(url, mode),
      { url: rpc.url, mode },
    )
    expect(result.publicBytes).toBe(result.nativeBytes)
    const transaction = inspectSignedTransaction(result.nativeBytes)
    expect(transaction).toMatchObject({
      version: mode === "classic" ? 0 : 1,
      signatureValid: true,
      publicKey: result.publicKey,
      nonce: 42,
      strict: mode.includes("strict"),
      signerId: "alice.near",
      receiverId: "bob.near",
      blockHash: "11111111111111111111111111111111",
      hash: result.nativeHash,
      actions: [{ kind: "transfer", deposit: "1000000000000000000000000" }],
    })
    expect(transaction.nonceIndex).toBe(mode.includes("gas") ? 1 : undefined)
    expect((await rpc.snapshot()).submissions).toHaveLength(0)
  })
}

test("real browser NEP-413 signatures verify independently and reject a changed recipient", async ({
  page,
  rpc,
}) => {
  const result = await page.evaluate((url) => window.kit.message(url), rpc.url)
  expect(result.publicValid).toBe(true)
  expect(result.nativeValid).toBe(true)
  expect(result.tampered).toBe(false)
  expect(verifyMessage(result.signed, result.params)).toBe(true)
  expect(
    verifyMessage(result.signed, {
      ...result.params,
      message: "a different message",
    }),
  ).toBe(false)
  expect((await rpc.snapshot()).submissions).toHaveLength(0)
})

for (const native of [false, true]) {
  const api = native ? "native" : "Promise"
  for (const scenario of [
    "lost-known",
    "lost-unknown",
    "stale-id",
    "stale-nonce",
    "contradictory-nonce",
  ]) {
    test(`${api}: ${scenario} never authorizes a second economic operation`, async ({
      page,
      rpc,
    }) => {
      await rpc.configure(scenario)
      const results = await page.evaluate(
        ({ url, native }) => window.kit.submit(url, native),
        { url: rpc.url, native },
      )
      const state = await rpc.snapshot()
      expect(state.accepted).toBe(1)
      expect(new Set(state.submissions.map((tx) => tx.bytes)).size).toBe(1)
      const first = state.submissions[0]
      expect(first).toBeDefined()
      expect(state.statusHashes).toContain(first?.hash)
      if (scenario === "lost-known")
        expect(results).toEqual([{ ok: true, hash: first?.hash }])
      else
        expect(results).toMatchObject([
          {
            ok: false,
            error: {
              code: "TRANSACTION_OUTCOME_UNKNOWN",
              retryable: false,
              data: { hash: first?.hash },
            },
          },
        ])
      if (scenario.startsWith("lost-")) {
        expect(state.submissions.length).toBeGreaterThanOrEqual(2)
        const delivered = state.deliveries.filter(
          (item) => item.method === "send_tx",
        )
        expect(delivered[0]).toMatchObject({
          responseKind: "dropped",
          serverFinished: false,
          hash: first?.hash,
        })
        expect(
          delivered.some((item) => item.responseKind === "nonce-error"),
        ).toBe(true)
      }
    })
  }
  test(`${api}: a matching nonce rejection never authorizes a freshly signed submission`, async ({
    page,
    rpc,
  }) => {
    await rpc.configure("nonce-rejected")
    const results = await page.evaluate(
      ({ url, native }) => window.kit.submit(url, native),
      { url: rpc.url, native },
    )
    const state = await rpc.snapshot()
    const first = state.submissions[0]
    expect(first).toBeDefined()
    expect(results).toMatchObject([
      {
        ok: false,
        error: {
          code: "TRANSACTION_OUTCOME_UNKNOWN",
          retryable: false,
          data: { hash: first?.hash },
        },
      },
    ])
    expect(state.accepted).toBe(0)
    expect(state.submissions).toHaveLength(2)
    expect(
      state.submissions.every((tx) => !tx.accepted && tx.nonce === 2),
    ).toBe(true)
    expect(new Set(state.submissions.map((tx) => tx.bytes)).size).toBe(1)
    expect(state.statusHashes).toContain(first?.hash)
  })
  test(`${api}: malformed HTTP RPC data fails without retrying or submitting`, async ({
    page,
    rpc,
  }) => {
    await rpc.configure("malformed")
    expect(
      await page.evaluate(
        ({ url, native }) => window.kit.malformed(url, native),
        { url: rpc.url, native },
      ),
    ).toMatchObject({ resolved: false, name: "SchemaError" })
    const state = await rpc.snapshot()
    expect(state.reads).toHaveLength(1)
    expect(state.submissions).toHaveLength(0)
  })
}

test("repeating the same ambiguous public builder preserves its signed commitment", async ({
  page,
  rpc,
}) => {
  await rpc.configure("lost-unknown")
  expect(
    await page.evaluate((url) => window.kit.submit(url, false, 2), rpc.url),
  ).toMatchObject([
    { ok: false, error: { code: "TRANSACTION_OUTCOME_UNKNOWN" } },
    { ok: false, error: { code: "TRANSACTION_OUTCOME_UNKNOWN" } },
  ])
  const state = await rpc.snapshot()
  expect(state.accepted).toBe(1)
  expect(new Set(state.submissions.map((tx) => tx.bytes)).size).toBe(1)
  expect(new Set(state.statusHashes).size).toBe(1)
})

for (const strict of [false, true]) {
  test(`V${strict ? 1 : 0}: async signer completion and caller byte edits cannot replace a captured commitment`, async ({
    page,
    rpc,
  }) => {
    const result = await page.evaluate(
      ({ url, strict }) => window.kit.commitmentOwnership(url, strict),
      { url: rpc.url, strict },
    )
    const state = await rpc.snapshot()
    expect(result.staleHash).toBeNull()
    expect(result.invalidated).toBe(true)
    expect(result.signerCalls).toBe(2)
    expect(state.accepted).toBe(2)
    expect(state.submissions).toHaveLength(2)
    expect(state.submissions[0]).toMatchObject({
      version: strict ? 1 : 0,
      nonce: 42,
      hash: result.firstHash,
      signatureValid: true,
      publicKey: result.publicKey,
      actions: [{ kind: "transfer", deposit: "1" }],
    })
    expect(state.submissions[1]?.bytes).toBe(result.bytes)
    expect(inspectSignedTransaction(result.bytes)).toMatchObject({
      version: strict ? 1 : 0,
      nonce: 43,
      hash: result.secondHash,
      signatureValid: true,
      publicKey: result.publicKey,
      actions: [
        { kind: "transfer", deposit: "1" },
        { kind: "transfer", deposit: "2" },
      ],
    })
    expect(result.firstHash).not.toBe(result.secondHash)
  })
}

test("concurrent sends of one initially unsigned public builder share one commitment", async ({
  page,
  rpc,
}) => {
  await rpc.configure("lost-known")
  const results = await page.evaluate(
    (url) => window.kit.concurrentBuilder(url),
    rpc.url,
  )
  const state = await rpc.snapshot()
  expect(state.accepted).toBe(1)
  expect(new Set(state.submissions.map((tx) => tx.bytes)).size).toBe(1)
  const first = state.submissions[0]
  if (!first) throw new Error("Expected an observed signed commitment")
  expect(results).toEqual(
    Array.from({ length: 3 }, () => ({ ok: true, hash: first.hash })),
  )
})

test("concurrent broadcasts of one native commitment admit only one transfer", async ({
  page,
  rpc,
}) => {
  await rpc.configure("lost-known")
  const results = await page.evaluate(
    (url) => window.kit.concurrentBroadcast(url),
    rpc.url,
  )
  const state = await rpc.snapshot()
  const first = state.submissions[0]
  expect(first).toBeDefined()
  expect(state.accepted).toBe(1)
  expect(new Set(state.submissions.map((tx) => tx.bytes)).size).toBe(1)
  expect(results).toEqual(
    Array.from({ length: 3 }, () => ({ ok: true, hash: first?.hash })),
  )
})

test("replaying a successful public builder retains the first admitted hash", async ({
  page,
  rpc,
}) => {
  await rpc.configure("accepted-known")
  const results = await page.evaluate(
    (url) => window.kit.submit(url, false, 2),
    rpc.url,
  )
  const state = await rpc.snapshot()
  expect(state.accepted).toBe(1)
  expect(new Set(state.submissions.map((tx) => tx.bytes)).size).toBe(1)
  expect(results).toEqual(
    Array.from({ length: 2 }, () => ({
      ok: true,
      hash: state.submissions[0]?.hash,
    })),
  )
})

for (const native of [false, true]) {
  test(`${native ? "native" : "Promise"}: concurrent fresh sends admit every distinct intent once`, async ({
    page,
    rpc,
  }) => {
    const hashes = await page.evaluate(
      ({ url, native }) => window.kit.freshConcurrentSends(url, native),
      { url: rpc.url, native },
    )
    const state = await rpc.snapshot()
    expect(state.accepted).toBe(4)
    expect(state.submissions).toHaveLength(4)
    const transactions = state.submissions.map((sent) =>
      inspectSignedTransaction(sent.bytes),
    )
    expect(new Set(transactions.map((tx) => tx.publicKey)).size).toBe(1)
    expect(new Set(transactions.map((tx) => tx.nonce)).size).toBe(4)
    expect(new Set(transactions.map((tx) => tx.hash)).size).toBe(4)
    expect(new Set(transactions.map((tx) => tx.actions[0]?.deposit))).toEqual(
      new Set(["1", "2", "3", "4"]),
    )
    expect(new Set(hashes)).toEqual(new Set(transactions.map((tx) => tx.hash)))
    for (const transaction of transactions) {
      expect(transaction).toMatchObject({
        signerId: "alice.near",
        receiverId: "bob.near",
        signatureValid: true,
        actions: [{ kind: "transfer" }],
      })
      expect(transaction.actions).toHaveLength(1)
    }
  })
}

test("concurrent native browser signing reserves unique nonces for one real key", async ({
  page,
  rpc,
}) => {
  const results = await page.evaluate(
    (url) => window.kit.concurrent(url, 12),
    rpc.url,
  )
  const state = await rpc.snapshot()
  expect(state.accepted).toBe(12)
  expect(new Set(results).size).toBe(12)
  expect(new Set(state.submissions.map((tx) => tx.nonce)).size).toBe(12)
  expect(state.submissions.every((tx) => tx.signatureValid)).toBe(true)
})

for (const boundary of ["signer", "keyStore", "wallet"] as const) {
  test(`${boundary} callback rejection retains identity and never broadcasts`, async ({
    page,
    rpc,
  }) => {
    expect(
      await page.evaluate(
        ({ url, boundary }) => window.kit.callbackFailure(url, boundary),
        { url: rpc.url, boundary },
      ),
    ).toBe(true)
    expect((await rpc.snapshot()).submissions).toHaveLength(0)
  })
}

for (const scenario of ["held-reads", "stream-read"]) {
  test(`native interruption aborts the real ${scenario} HTTP request`, async ({
    page,
    rpc,
  }) => {
    await rpc.configure(scenario)
    const headers =
      scenario === "stream-read"
        ? page.waitForResponse((response) => response.url() === rpc.url)
        : undefined
    await page.evaluate((url) => window.kit.startRead(url, "slow"), rpc.url)
    if (headers) expect((await headers).status()).toBe(200)
    await expect.poll(async () => (await rpc.snapshot()).reads.length).toBe(1)
    await page.evaluate(() => window.kit.abortRead("slow"))
    expect(
      await page.evaluate(() => window.kit.waitRead("slow")),
    ).toMatchObject({ resolved: false })
    await expect
      .poll(async () => (await rpc.snapshot()).reads[0]?.aborted)
      .toBe(true)
    await rpc.release("slow")
    expect((await rpc.snapshot()).submissions).toHaveLength(0)
  })
}
