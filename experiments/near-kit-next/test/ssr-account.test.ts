import * as Near from "@near-kit/next"
import {
  keepPreviousData,
  QueryClient,
  QueryObserver,
} from "@tanstack/react-query"
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import {
  type AccountIdentity,
  type AccountSnapshot,
  parseSsrAccount,
  readSsrAccount,
  serializeSsrAccount,
  ssrAccountQueryOptions,
} from "../examples/ssr-account.js"
import { accountPageResponse } from "../examples/ssr-account-server.js"
import { accountWire, HASH } from "./fixtures.js"

const MAX = 340282366920938463463374607431768211455n
const selected: AccountIdentity = {
  requestId: "document-1",
  sourceKey: "one",
  accountId: "alice.testnet",
}
const snapshot: AccountSnapshot = {
  ...selected,
  amount: MAX,
  blockHeight: 18446744073709551615n,
  blockHash: HASH,
}
const source = (key = "one") => ({
  key,
  client: Near.make({ url: `https://${key}.example.test` }),
})
const successFetch: typeof fetch = async (input, init) => {
  const rpc = JSON.parse(String(init?.body))
  const amount =
    MAX -
    (String(input).includes("two") ? 2n : 0n) -
    (rpc.params.account_id === "bob.testnet" ? 1n : 0n)
  const raw = (JSON as typeof JSON & { rawJSON: (text: string) => unknown })
    .rawJSON
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id: rpc.id,
      result: {
        ...accountWire,
        amount: amount.toString(),
        block_height: raw("18446744073709551615"),
      },
    }),
  )
}
let currentFetch: typeof fetch = successFetch
beforeAll(() =>
  vi.stubGlobal("fetch", (...args: Parameters<typeof fetch>) =>
    currentFetch(...args),
  ),
)
afterEach(() => {
  currentFetch = successFetch
  vi.restoreAllMocks()
})
afterAll(() => vi.unstubAllGlobals())
const request = (signal?: AbortSignal) =>
  new Request("https://app.example.test/account", signal ? { signal } : {})
const options = (accountId = "alice.testnet", key = "one") => ({
  source: source(key),
  accountId,
  browserModule: "/account.js",
})
const payload = (html: string) => {
  const match =
    /<script id="account-data" type="application\/json">(.*?)<\/script>/.exec(
      html,
    )
  if (!match?.[1]) throw new Error("Missing serialized account")
  return match[1]
}
function pendingFetch(aborted: boolean[]) {
  return vi.fn<typeof fetch>(
    async (_input, init) =>
      new Promise((_resolve, reject) => {
        const index = aborted.push(false) - 1
        init?.signal?.addEventListener(
          "abort",
          () => {
            aborted[index] = true
            reject(new DOMException("Aborted", "AbortError"))
          },
          { once: true },
        )
      }),
  )
}

describe("bounded SSR application payload", () => {
  it("round trips exact u128/u64 quantities and validates a canonical 32-byte hash", () => {
    const json = serializeSsrAccount(snapshot)
    expect(json).toContain(`"amount":"${MAX}"`)
    expect(parseSsrAccount(json, selected)).toEqual(snapshot)
    expect(Object.isFrozen(parseSsrAccount(json, selected))).toBe(true)
  })

  it.each([
    ["amount", "-1"],
    ["amount", "1e3"],
    ["amount", "01"],
    ["amount", "1\n"],
    ["amount", 123],
    ["amount", (MAX + 1n).toString()],
    ["amount", "1".repeat(100)],
    ["blockHeight", "18446744073709551616"],
    ["blockHeight", "01"],
    ["blockHash", "1".repeat(31)],
    ["blockHash", `${HASH}\n`],
    ["version", 2],
    ["sourceKey", "two"],
    ["accountId", "bob.testnet"],
    ["requestId", "document-2"],
    ["unexpected", "value"],
  ])("rejects an invalid %s field", (key, value) => {
    const wire = JSON.parse(serializeSsrAccount(snapshot))
    wire[key] = value
    expect(() => parseSsrAccount(JSON.stringify(wire), selected)).toThrow(
      "Invalid SSR account payload",
    )
  })

  it("rejects missing fields, malformed/overlong JSON, and invalid expected identities", () => {
    const wire = JSON.parse(serializeSsrAccount(snapshot))
    delete wire.amount
    for (const json of [
      JSON.stringify(wire),
      "null",
      "[]",
      "{",
      " ".repeat(2049),
    ])
      expect(() => parseSsrAccount(json, selected)).toThrow(
        "Invalid SSR account payload",
      )
    for (const replacement of [
      "",
      "a".repeat(81),
      "document-1\n",
      "</script><script>alert(1)</script>",
    ])
      expect(() =>
        parseSsrAccount(serializeSsrAccount(snapshot), {
          ...selected,
          requestId: replacement,
        }),
      ).toThrow("Invalid SSR account payload")
    expect(() =>
      parseSsrAccount(serializeSsrAccount(snapshot), {
        ...selected,
        accountId: "<script>",
      }),
    ).toThrow("Invalid SSR account payload")
  })
})

describe("request-scoped server read and render", () => {
  it("isolates concurrent accounts and sources, exact amounts, and rendering caches", async () => {
    expect(typeof window).toBe("undefined")
    expect(typeof document).toBe("undefined")
    const fetch = vi.fn(successFetch)
    currentFetch = fetch
    const clients: QueryClient[] = []
    const original = QueryClient.prototype.clear
    vi.spyOn(QueryClient.prototype, "clear").mockImplementation(function (
      this: QueryClient,
    ) {
      clients.push(this)
      expect(this.getQueryCache().getAll()).toHaveLength(1)
      original.call(this)
      expect(this.getQueryCache().getAll()).toHaveLength(0)
    })
    const responses = await Promise.all([
      accountPageResponse(request(), options()),
      accountPageResponse(request(), options("bob.testnet", "two")),
      accountPageResponse(request(), options("alice.testnet", "two")),
    ])
    const html = await Promise.all(responses.map((response) => response.text()))
    const wire = html.map((text) => JSON.parse(payload(text)))
    expect(wire.map((value) => value.amount)).toEqual(
      [MAX, MAX - 3n, MAX - 2n].map(String),
    )
    expect(new Set(wire.map((value) => value.requestId)).size).toBe(3)
    expect(new Set(clients).size).toBe(3)
    expect(fetch).toHaveBeenCalledTimes(3)
    responses.forEach((response) => {
      expect(response.headers.get("cache-control")).toBe("private, no-store")
    })
    html.forEach((text) => {
      expect(text).toContain("18446744073709551615")
      expect(text).toContain('src="/account.js"')
    })
    const alice = wire[0]
    const bobHtml = html[1]
    const otherSourceHtml = html[2]
    if (bobHtml === undefined || otherSourceHtml === undefined)
      throw new Error("Missing concurrent response")
    expect(() =>
      parseSsrAccount(payload(bobHtml), {
        requestId: alice.requestId,
        accountId: "alice.testnet",
        sourceKey: "one",
      }),
    ).toThrow()
    expect(() =>
      parseSsrAccount(payload(otherSourceHtml), {
        requestId: wire[2].requestId,
        accountId: "alice.testnet",
        sourceKey: "one",
      }),
    ).toThrow()
  })

  it.each([
    "//evil.test/app.js",
    '/app.js" onload="evil',
    "/app.js\n",
    "/../app.js",
    "javascript:alert(1)",
    `/${"a".repeat(257)}.js`,
  ])("rejects unsafe module attribute %s before reading", async (browserModule) => {
    const fetch = vi.fn(successFetch)
    currentFetch = fetch
    await expect(
      accountPageResponse(request(), { ...options(), browserModule }),
    ).rejects.toThrow("application-owned")
    expect(fetch).not.toHaveBeenCalled()
  })

  it("rejects a pre-aborted request without acquiring HTTP", async () => {
    const fetch = vi.fn(successFetch)
    currentFetch = fetch
    const controller = new AbortController()
    controller.abort()
    await expect(
      accountPageResponse(request(controller.signal), options()),
    ).rejects.toBeDefined()
    await expect(
      readSsrAccount(source(), selected, controller.signal),
    ).rejects.toBeDefined()
    expect(fetch).not.toHaveBeenCalled()
  })

  it("propagates incoming request cancellation to a pending read", async () => {
    const aborted: boolean[] = []
    const fetch = pendingFetch(aborted)
    currentFetch = fetch
    const controller = new AbortController()
    const result = accountPageResponse(request(controller.signal), options())
    const rejection = expect(result).rejects.toBeDefined()
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    controller.abort()
    await rejection
    expect(aborted).toEqual([true])
  })

  it("suppresses success when the request aborts after the read, during rendering", async () => {
    const controller = new AbortController()
    const fetch = vi.fn(successFetch)
    currentFetch = fetch
    const getCache = QueryClient.prototype.getQueryCache
    vi.spyOn(QueryClient.prototype, "getQueryCache").mockImplementation(
      function (this: QueryClient) {
        controller.abort()
        return getCache.call(this)
      },
    )
    await expect(
      accountPageResponse(request(controller.signal), options()),
    ).rejects.toMatchObject({ name: "AbortError" })
    expect(fetch).toHaveBeenCalledOnce()
  })
})

describe("hydrated document query ownership", () => {
  it("does not refetch initialData and cancels on account/source replacement and unmount", async () => {
    const aborted: boolean[] = []
    const fetch = pendingFetch(aborted)
    currentFetch = fetch
    const client = new QueryClient({
      defaultOptions: { queries: { placeholderData: keepPreviousData } },
    })
    const query = new QueryObserver(
      client,
      ssrAccountQueryOptions(source(), snapshot),
    )
    const unsubscribe = query.subscribe(() => {})
    expect(query.getCurrentResult().data).toEqual(snapshot)
    expect(fetch).not.toHaveBeenCalled()
    const first = query.refetch()
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    const next: AccountSnapshot = {
      ...snapshot,
      sourceKey: "two",
      accountId: "bob.testnet",
      amount: MAX - 3n,
    }
    query.setOptions(ssrAccountQueryOptions(source("two"), next))
    await vi.waitFor(() => expect(aborted).toEqual([true]))
    expect(query.getCurrentResult().data).toEqual(next)
    expect(fetch).toHaveBeenCalledTimes(1)
    const second = query.refetch()
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    unsubscribe()
    await vi.waitFor(() => expect(aborted).toEqual([true, true]))
    await Promise.all([first, second])
    client.clear()
  })

  it("Cancel retains only the prior snapshot for the same identity", async () => {
    const aborted: boolean[] = []
    currentFetch = pendingFetch(aborted)
    const client = new QueryClient()
    const settings = ssrAccountQueryOptions(source(), snapshot)
    const query = new QueryObserver(client, settings)
    const unsubscribe = query.subscribe(() => {})
    const refresh = query.refetch()
    await vi.waitFor(() => expect(aborted).toEqual([false]))
    await client.cancelQueries({ queryKey: settings.queryKey, exact: true })
    await refresh
    expect(aborted).toEqual([true])
    expect(query.getCurrentResult().data).toEqual(snapshot)
    expect(query.getCurrentResult().isError).toBe(false)
    unsubscribe()
    client.clear()
  })

  it("rejects a source mismatch and partitions different documents", () => {
    expect(() => ssrAccountQueryOptions(source("two"), snapshot)).toThrow(
      "Invalid SSR",
    )
    expect(ssrAccountQueryOptions(source(), snapshot).queryKey).not.toEqual(
      ssrAccountQueryOptions(source(), { ...snapshot, requestId: "document-2" })
        .queryKey,
    )
  })
})
