import { expect, test, type APIRequestContext, type Page } from "@playwright/test"

type Observation = { id: number; accountId: string; network: string; amount: string; aborted: boolean; released: boolean }
const state = async (request: APIRequestContext): Promise<Observation[]> => (await request.get("/control/state")).json()
const latest = async (request: APIRequestContext, accountId = "a.testnet", afterId = 0) => {
  await expect.poll(async () => (await state(request)).filter((row) => row.id > afterId && row.accountId === accountId && !row.aborted && !row.released).length).toBe(1)
  const row = (await state(request)).findLast((value) => value.id > afterId && value.accountId === accountId && !value.aborted && !value.released)
  if (!row) throw new Error("Missing pending read")
  return row
}

const beginPending = async (page: Page, request: APIRequestContext) => {
  await page.goto("/")
  await expect(page.getByText(/^[0-9]+ yoctoNEAR$/)).toBeVisible()
  await request.post("/control/hold")
  await page.evaluate(() => window.readDemo.select("a.testnet"))
  return latest(request)
}

test.beforeEach(async ({ request }) => { await request.post("/control/reset") })

test("packaged reads and mixed view codecs work in a real browser", async ({ page, request }) => {
  const row = await beginPending(page, request)
  await request.post(`/control/release?id=${row.id}`)
  await expect(page.getByText(`${row.amount} yoctoNEAR`, { exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.readDemo.views())).toEqual({ count: 7, bytes: [0, 255, 1] })
})

test("account replacement aborts old body and does not show its data", async ({ page, request }) => {
  const old = await beginPending(page, request)
  await page.evaluate(() => window.readDemo.select("b.testnet"))
  const current = await latest(request, "b.testnet")
  await expect.poll(async () => (await state(request)).find((row) => row.id === old.id)?.aborted).toBe(true)
  await request.post(`/control/release?id=${current.id}`)
  await expect(page.getByText(`${current.amount} yoctoNEAR`, { exact: true })).toBeVisible()
  await expect(page.getByText(`${old.amount} yoctoNEAR`, { exact: true })).toHaveCount(0)
})

test("batched A to B to A invalidates a previous successful A result", async ({ page, request }) => {
  const old = await beginPending(page, request)
  await request.post(`/control/release?id=${old.id}`)
  await expect(page.getByText(`${old.amount} yoctoNEAR`, { exact: true })).toBeVisible()
  await page.evaluate(() => window.readDemo.batchABA())
  const current = await latest(request, "a.testnet", old.id)
  expect(current.id).toBeGreaterThan(old.id)
  await expect(page.getByText("Reading account…", { exact: true })).toBeVisible()
  await request.post(`/control/release?id=${current.id}`)
  await expect(page.getByText(`${current.amount} yoctoNEAR`, { exact: true })).toBeVisible()
})

test("network replacement and disconnect keep wallet and read state distinct", async ({ page, request }) => {
  const old = await beginPending(page, request)
  await page.evaluate(() => window.readDemo.select("a.testnet", "two"))
  const next = await latest(request, "a.testnet", old.id)
  expect(next.network).toBe("/rpc/two")
  await expect.poll(async () => (await state(request)).find((row) => row.id === old.id)?.aborted).toBe(true)
  await page.evaluate(() => window.readDemo.select(null))
  await expect(page.getByText("Choose a wallet account", { exact: true })).toBeVisible()
  await expect.poll(async () => (await state(request)).find((row) => row.id === next.id)?.aborted).toBe(true)
  await page.evaluate(() => window.readDemo.select("a.testnet", "failure"))
  await expect(page.getByText("Could not read this account.", { exact: true })).toBeVisible()
  await expect(page.getByText("Choose a wallet account", { exact: true })).toHaveCount(0)
})
