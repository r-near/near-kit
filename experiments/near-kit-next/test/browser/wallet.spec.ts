import { type APIRequestContext, expect, test } from "@playwright/test"

type Row = {
  id: number
  amount: string
  network: string
  aborted: boolean
  released: boolean
}
const rows = async (request: APIRequestContext): Promise<Row[]> =>
  (await request.get("/control/state")).json()
async function pending(request: APIRequestContext, after = 0) {
  await expect
    .poll(
      async () =>
        (await rows(request)).filter(
          (row) => row.id > after && !row.aborted && !row.released,
        ).length,
    )
    .toBe(1)
  const row = (await rows(request)).findLast(
    (row) => row.id > after && !row.aborted && !row.released,
  )
  if (!row) throw new Error("Missing pending read")
  return row
}
const aborted = (request: APIRequestContext, id: number) =>
  expect
    .poll(
      async () => (await rows(request)).find((row) => row.id === id)?.aborted,
    )
    .toBe(true)
test.beforeEach(async ({ request }) => {
  await request.post("/control/reset")
})
for (const mode of ["plain", "query"]) {
  test(`${mode}: batched account replacement suppresses stale results and aborts`, async ({
    page,
    request,
  }) => {
    await page.goto(`/wallet?mode=${mode}`)
    await expect(page.getByText(/^[0-9]+ yoctoNEAR$/)).toBeVisible()
    await request.post("/control/hold")
    await page.evaluate(() => window.walletDemo.select("a.testnet"))
    const old = await pending(request)
    await page.evaluate(() => window.walletDemo.batchABA())
    const current = await pending(request, old.id)
    await aborted(request, old.id)
    await expect(page.getByText("Reading account…")).toBeVisible()
    await request.post(`/control/release?id=${current.id}`)
    await expect(
      page.getByText(`${current.amount} yoctoNEAR`, { exact: true }),
    ).toBeVisible()
    await expect(
      page.getByText(`${old.amount} yoctoNEAR`, { exact: true }),
    ).toHaveCount(0)
  })
  test(`${mode}: selected network mismatch, source replacement and disable cancel reads`, async ({
    page,
    request,
  }) => {
    await page.goto(`/wallet?mode=${mode}`)
    await expect(page.getByText(/^[0-9]+ yoctoNEAR$/)).toBeVisible()
    await request.post("/control/hold")
    await page.evaluate(() => window.walletDemo.select("a.testnet"))
    const old = await pending(request)
    await page.evaluate(() =>
      window.walletDemo.network("mainnet", "unselected-wallet"),
    )
    expect(
      (await rows(request)).find((row) => row.id === old.id)?.aborted,
    ).toBe(false)
    await page.evaluate(() => window.walletDemo.network("mainnet"))
    await expect(
      page.getByText("Wallet network differs from the configured read source"),
    ).toBeVisible()
    await aborted(request, old.id)
    await page.evaluate(() => window.walletDemo.network("testnet"))
    const matching = await pending(request, old.id)
    await page.evaluate(() => window.walletDemo.source("two"))
    const moved = await pending(request, matching.id)
    expect(moved.network).toBe("/rpc/two")
    await aborted(request, matching.id)
    await page.evaluate(() => window.walletDemo.enabled(false))
    await expect(page.getByText("Account reads are disabled")).toBeVisible()
    await aborted(request, moved.id)
    await page.evaluate(() => window.walletDemo.enabled(true))
    const enabled = await pending(request, moved.id)
    await request.post(`/control/release?id=${enabled.id}`)
    await expect(
      page.getByText(`${enabled.amount} yoctoNEAR`, { exact: true }),
    ).toBeVisible()
  })
  test(`${mode}: logout, setup failure, read failure and unmount stay distinct`, async ({
    page,
    request,
  }) => {
    await page.goto(`/wallet?mode=${mode}`)
    await expect(page.getByText(/^[0-9]+ yoctoNEAR$/)).toBeVisible()
    await request.post("/control/hold")
    await page.evaluate(() => window.walletDemo.select("a.testnet"))
    const old = await pending(request)
    await page.evaluate(() => window.walletDemo.select(null))
    await expect(page.getByText("Choose a wallet account")).toBeVisible()
    await aborted(request, old.id)
    await page.evaluate(() => window.walletDemo.setup("failed"))
    await expect(page.getByText("Wallet observation failed")).toBeVisible()
    await page.evaluate(() => {
      window.walletDemo.setup("ready")
      window.walletDemo.source("failure")
      window.walletDemo.select("a.testnet")
    })
    await expect(page.getByText("Could not read this account.")).toBeVisible()
    await page.evaluate(() => window.walletDemo.source("one"))
    const current = await pending(request, old.id)
    await page.evaluate(() => window.walletDemo.unmount())
    await aborted(request, current.id)
    expect(await page.evaluate(() => window.walletDemo.subscriptions())).toBe(0)
  })
}
