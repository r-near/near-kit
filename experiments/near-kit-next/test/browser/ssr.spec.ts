import { type APIRequestContext, expect, test } from "@playwright/test"

const MAX = 340282366920938463463374607431768211455n
type Observation = {
  id: number
  accountId: string
  network: string
  amount: string
  aborted: boolean
  released: boolean
}
const state = async (request: APIRequestContext): Promise<Observation[]> =>
  (await request.get("/control/state")).json()
const pending = async (request: APIRequestContext) => {
  await expect
    .poll(
      async () =>
        (await state(request)).filter((row) => !row.released && !row.aborted)
          .length,
    )
    .toBe(1)
  const row = (await state(request)).find(
    (value) => !value.released && !value.aborted,
  )
  if (!row) throw new Error("Missing pending SSR fixture read")
  return row
}
test.beforeEach(async ({ request }) => {
  await request.post("/control/reset")
})

test("renders exact server data before JavaScript and hydrates without another read", async ({
  browser,
  page,
  request,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  try {
    const serverOnly = await context.newPage()
    await serverOnly.goto("http://127.0.0.1:4177/ssr")
    await expect(
      serverOnly.getByText(`${MAX} yoctoNEAR`, { exact: true }),
    ).toBeVisible()
    await expect(
      serverOnly.getByText(/Block 18446744073709551615/),
    ).toBeVisible()
  } finally {
    await context.close()
  }
  await request.post("/control/reset")
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.goto("/ssr")
  await page.waitForFunction(() => window.ssrDemo?.hydrated)
  await expect(
    page.getByText(`${MAX} yoctoNEAR`, { exact: true }),
  ).toBeVisible()
  expect(await page.evaluate(() => window.ssrDemo.recoverable)).toEqual([])
  expect(errors).toEqual([])
  expect(await state(request)).toMatchObject([
    {
      accountId: "alice.testnet",
      network: "/rpc/ssr-one",
      amount: MAX.toString(),
      released: true,
    },
  ])
})

test("two simultaneously hydrated documents isolate accounts, source and request IDs", async ({
  context,
  request,
}) => {
  const alice = await context.newPage()
  const bob = await context.newPage()
  await Promise.all([
    alice.goto("/ssr?account=alice.testnet&source=one"),
    bob.goto("/ssr?account=bob.testnet&source=two"),
  ])
  await Promise.all(
    [alice, bob].map((page) =>
      page.waitForFunction(() => window.ssrDemo?.hydrated),
    ),
  )
  await expect(
    alice.getByText(`${MAX} yoctoNEAR`, { exact: true }),
  ).toBeVisible()
  await expect(
    bob.getByText(`${MAX - 3n} yoctoNEAR`, { exact: true }),
  ).toBeVisible()
  expect(
    await alice.locator("#account-root").getAttribute("data-request-id"),
  ).not.toBe(await bob.locator("#account-root").getAttribute("data-request-id"))
  expect(await state(request)).toHaveLength(2)
})

test("explicit Cancel aborts a refresh body and retains the same account snapshot", async ({
  page,
  request,
}) => {
  await page.goto("/ssr")
  await page.waitForFunction(() => window.ssrDemo?.hydrated)
  await request.post("/control/hold")
  await page.getByRole("button", { name: "Refresh", exact: true }).click()
  const old = await pending(request)
  await page
    .getByRole("button", { name: "Cancel refresh", exact: true })
    .click()
  await expect
    .poll(
      async () =>
        (await state(request)).find((row) => row.id === old.id)?.aborted,
    )
    .toBe(true)
  await expect(
    page.getByText(`${MAX} yoctoNEAR`, { exact: true }),
  ).toBeVisible()
  await expect(page.getByRole("alert")).toHaveCount(0)
  await expect(
    page.getByRole("button", { name: "Refresh", exact: true }),
  ).toBeEnabled()
})

for (const account of ["alice.testnet", "bob.testnet"]) {
  test(`source/account replacement cancels the old observer for ${account}`, async ({
    page,
    request,
  }) => {
    await page.goto("/ssr")
    await page.waitForFunction(() => window.ssrDemo?.hydrated)
    await request.post("/control/hold")
    await page.getByRole("button", { name: "Refresh", exact: true }).click()
    const old = await pending(request)
    await request.post("/control/resume") // New server route can complete; old body remains held.
    await page.evaluate(
      (accountId) =>
        window.ssrDemo.navigate(`/ssr?account=${accountId}&source=two`),
      account,
    )
    const amount = MAX - (account === "bob.testnet" ? 3n : 2n)
    await expect(
      page.getByText(`${account} · ssr-two`, { exact: true }),
    ).toBeVisible()
    await expect(
      page.getByText(`${amount} yoctoNEAR`, { exact: true }),
    ).toBeVisible()
    await expect
      .poll(
        async () =>
          (await state(request)).find((row) => row.id === old.id)?.aborted,
      )
      .toBe(true)
    const release = await request.post(`/control/release?id=${old.id}`)
    expect(await release.json()).toEqual({ released: false })
    await expect(
      page.getByText(`${MAX} yoctoNEAR`, { exact: true }),
    ).toHaveCount(0)
    expect(await state(request)).toHaveLength(3) // SSR one, refresh one, SSR two. No hydration duplicate.
    await request.post("/control/hold")
    await page.getByRole("button", { name: "Refresh", exact: true }).click()
    const current = await pending(request)
    await page.evaluate(() => window.ssrDemo.dispose())
    await expect
      .poll(
        async () =>
          (await state(request)).find((row) => row.id === current.id)?.aborted,
      )
      .toBe(true)
    await expect(
      page.getByRole("region", { name: "Account snapshot" }),
    ).toHaveCount(0)
  })
}

for (const invalid of ["amount", "sourceKey"]) {
  test(`rejects invalid ${invalid} before hydrating`, async ({
    page,
    request,
  }) => {
    await page.route("**/ssr", async (route) => {
      const response = await route.fetch()
      const html = (await response.text()).replace(
        /(<script id="account-data" type="application\/json">)(.*?)(<\/script>)/,
        (_match, before, json, after) => {
          const wire = JSON.parse(json)
          wire[invalid] = invalid === "amount" ? "1e10" : "ssr-two"
          return `${before}${JSON.stringify(wire)}${after}`
        },
      )
      await route.fulfill({ response, body: html })
    })
    await page.goto("/ssr")
    await expect(
      page.getByText("Invalid account page data", { exact: true }),
    ).toBeVisible()
    expect(await page.evaluate(() => window.ssrDemo.hydrated)).toBe(false)
    expect(await state(request)).toHaveLength(1)
  })
}

test("disconnecting an incoming HTTP request cancels its unfinished server read", async ({
  request,
}) => {
  await request.post("/control/hold")
  const controller = new AbortController()
  const response = fetch("http://127.0.0.1:4177/ssr", {
    signal: controller.signal,
  })
  const rejected = expect(response).rejects.toBeDefined()
  const old = await pending(request)
  controller.abort()
  await rejected
  await expect
    .poll(
      async () =>
        (await state(request)).find((row) => row.id === old.id)?.aborted,
    )
    .toBe(true)
})
